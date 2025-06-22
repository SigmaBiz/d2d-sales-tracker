/**
 * Test GRIB indexing approach for faster OKC data extraction
 * Using grib_index_build to create searchable index
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

const GRIB_FILE = path.join(__dirname, 'temp/MESH_Max_1440min_00.50_20240925-000000.grib2');

async function testGribIndex() {
  console.log('=== Testing GRIB Index Approach ===\n');
  
  // Check file exists
  try {
    await fs.stat(GRIB_FILE);
    console.log(`✓ Test file exists: ${GRIB_FILE}\n`);
  } catch (e) {
    console.error('✗ Test file not found.');
    return;
  }

  // Method 1: Build index on lat/lon keys
  console.log('1. Building GRIB index on coordinates:');
  try {
    const indexFile = GRIB_FILE + '.idx';
    const start = Date.now();
    
    // Build index on latitude/longitude related keys
    await execPromise(
      `grib_index_build -k latitude,longitude,Ni,Nj -o ${indexFile} ${GRIB_FILE}`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    const elapsed = Date.now() - start;
    const stats = await fs.stat(indexFile);
    console.log(`✓ Created index in ${elapsed}ms, size: ${stats.size} bytes`);
    
    // Check what's in the index
    const { stdout: indexInfo } = await execPromise(`grib_dump ${indexFile} | head -50`);
    console.log('\nIndex structure sample:');
    console.log(indexInfo);
    
    await fs.unlink(indexFile);
  } catch (e) {
    console.error('Index building failed:', e.message);
  }

  // Method 2: Use grib_to_netcdf for spatial subsetting
  console.log('\n2. Testing grib_to_netcdf with area subset:');
  try {
    const ncFile = GRIB_FILE + '.nc';
    const start = Date.now();
    
    // Convert to NetCDF with area subset
    // Note: This requires netcdf support in ecCodes
    await execPromise(
      `grib_to_netcdf -S area:35.1/-97.8/35.7/-97.1 -o ${ncFile} ${GRIB_FILE}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    
    const elapsed = Date.now() - start;
    const stats = await fs.stat(ncFile);
    console.log(`✓ Created NetCDF subset in ${elapsed}ms, size: ${stats.size} bytes`);
    
    await fs.unlink(ncFile);
  } catch (e) {
    console.log('✗ NetCDF conversion failed (may need NetCDF support):', e.message);
  }

  // Method 3: Memory-mapped approach with custom binary search
  console.log('\n3. Testing custom spatial index approach:');
  try {
    const start = Date.now();
    let foundCount = 0;
    let totalLines = 0;
    let okcStartLine = -1;
    let okcEndLine = -1;
    
    // First pass: find where OKC data starts and ends
    const scanProcess = spawn('grib_get_data', [GRIB_FILE]);
    
    let buffer = '';
    let headerSkipped = false;
    
    await new Promise((resolve, reject) => {
      scanProcess.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          totalLines++;
          
          if (!headerSkipped) {
            if (line.includes('Latitude') || line.includes('lat')) {
              headerSkipped = true;
            }
            continue;
          }
          
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            
            if (!isNaN(lat) && !isNaN(lon)) {
              const adjustedLon = lon > 180 ? lon - 360 : lon;
              
              // Check if in OKC bounds
              if (lat >= 35.1 && lat <= 35.7 && 
                  adjustedLon >= -97.8 && adjustedLon <= -97.1) {
                
                if (okcStartLine === -1) {
                  okcStartLine = totalLines;
                  console.log(`✓ OKC data starts at line ${okcStartLine}`);
                }
                foundCount++;
              } else if (okcStartLine !== -1 && okcEndLine === -1) {
                // We've passed OKC area
                okcEndLine = totalLines - 1;
                console.log(`✓ OKC data ends at line ${okcEndLine}`);
                console.log(`✓ OKC span: ${okcEndLine - okcStartLine + 1} lines`);
                scanProcess.kill();
                resolve();
                return;
              }
            }
          }
          
          // Progress update
          if (totalLines % 1000000 === 0) {
            console.log(`  Scanned ${totalLines / 1000000}M lines...`);
          }
        }
      });
      
      scanProcess.on('close', () => {
        const elapsed = Date.now() - start;
        console.log(`\n✓ Full scan complete in ${elapsed}ms`);
        console.log(`  Total OKC points found: ${foundCount}`);
        console.log(`  OKC data location: lines ${okcStartLine} to ${okcEndLine}`);
        resolve();
      });
      
      scanProcess.on('error', reject);
    });
    
  } catch (e) {
    console.error('Spatial index failed:', e.message);
  }

  // Method 4: Test CDO (Climate Data Operators) if available
  console.log('\n4. Testing CDO sellonlatbox (if available):');
  try {
    // Check if CDO is installed
    await execPromise('which cdo');
    
    const cdoFile = GRIB_FILE + '.cdo';
    const start = Date.now();
    
    // Use CDO to extract box
    await execPromise(
      `cdo sellonlatbox,-97.8,-97.1,35.1,35.7 ${GRIB_FILE} ${cdoFile}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    
    const elapsed = Date.now() - start;
    const stats = await fs.stat(cdoFile);
    console.log(`✓ CDO extracted OKC box in ${elapsed}ms, size: ${stats.size} bytes`);
    
    // Check contents
    const { stdout: pointCount } = await execPromise(`grib_get_data ${cdoFile} | wc -l`);
    console.log(`  Points in extracted file: ${pointCount.trim()}`);
    
    await fs.unlink(cdoFile);
  } catch (e) {
    console.log('✗ CDO not available or failed:', e.message);
  }

  // Method 5: Optimized streaming with line number targeting
  console.log('\n5. Testing targeted line extraction:');
  try {
    // Based on previous runs, we know OKC is around line 13.6M
    // Let's create a more intelligent extraction
    const targetStart = 13500000;
    const targetEnd = 13700000;
    
    const start = Date.now();
    const { stdout } = await execPromise(
      `grib_get_data ${GRIB_FILE} | sed -n '${targetStart},${targetEnd}p' | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9' | wc -l`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    
    const elapsed = Date.now() - start;
    console.log(`✓ Found ${stdout.trim()} OKC points in target range (${elapsed}ms)`);
    console.log(`  Processed only ${targetEnd - targetStart} lines instead of 24.5M`);
    
  } catch (e) {
    console.error('Targeted extraction failed:', e.message);
  }
}

// Run tests
testGribIndex().catch(console.error);
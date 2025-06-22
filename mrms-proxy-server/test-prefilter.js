/**
 * Test different pre-filtering approaches with ecCodes
 * Goal: Extract only OKC area data without processing all 24.5M points
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

// Test file - should already exist from previous run
const GRIB_FILE = path.join(__dirname, 'temp/MESH_Max_1440min_00.50_20240925-000000.grib2');

async function testPrefiltering() {
  console.log('=== Testing ecCodes Pre-filtering Methods ===\n');
  
  // First check if test file exists
  try {
    await fs.stat(GRIB_FILE);
    console.log(`✓ Test file exists: ${GRIB_FILE}\n`);
  } catch (e) {
    console.error('✗ Test file not found. Run the optimized server first to download it.');
    return;
  }
  
  // Method 1: Test grib_ls to understand the data structure
  console.log('1. Examining GRIB2 structure with grib_ls:');
  try {
    const { stdout: structure } = await execPromise(
      `grib_ls -p shortName,name,units,Ni,Nj,latitudeOfFirstGridPoint,longitudeOfFirstGridPoint,latitudeOfLastGridPoint,longitudeOfLastGridPoint ${GRIB_FILE}`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    console.log(structure);
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Method 2: Try grib_copy with area filter
  console.log('\n2. Testing grib_copy with area filter:');
  try {
    const outputFile = GRIB_FILE + '.okc';
    // OKC bounds: N:35.7, S:35.1, W:-97.8, E:-97.1
    // In GRIB2: W:262.2, E:262.9 (0-360 format)
    const { stdout, stderr } = await execPromise(
      `grib_copy -w latitudeOfFirstGridPoint<=35700,latitudeOfFirstGridPoint>=35100,longitudeOfFirstGridPoint>=262200,longitudeOfFirstGridPoint<=262900 ${GRIB_FILE} ${outputFile} 2>&1`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    
    // Check if output file was created
    try {
      const stats = await fs.stat(outputFile);
      console.log(`✓ Created filtered file: ${stats.size} bytes`);
      
      // Count points in filtered file
      const { stdout: count } = await execPromise(`grib_get_data ${outputFile} | wc -l`);
      console.log(`✓ Filtered file has ${count.trim()} lines`);
      
      await fs.unlink(outputFile);
    } catch (e) {
      console.log('✗ No output file created - filter may be too restrictive');
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Method 3: Test grib_get_data with -w flag
  console.log('\n3. Testing grib_get_data with -w constraints:');
  
  const constraints = [
    // Try different coordinate formats
    { 
      name: 'lat/lon in degrees',
      filter: '-w latitude>=35.1,latitude<=35.7'
    },
    {
      name: 'shortName filter',
      filter: '-w shortName=MESH'
    },
    {
      name: 'combined shortName + count',
      filter: '-w shortName=MESH -n 1000' // First 1000 points only
    }
  ];
  
  for (const test of constraints) {
    console.log(`\n   Testing: ${test.name}`);
    try {
      const start = Date.now();
      const { stdout } = await execPromise(
        `grib_get_data ${test.filter} ${GRIB_FILE} | wc -l`,
        { maxBuffer: 5 * 1024 * 1024 }
      );
      const elapsed = Date.now() - start;
      console.log(`   ✓ Result: ${stdout.trim()} lines in ${elapsed}ms`);
    } catch (e) {
      console.log(`   ✗ Error: ${e.message}`);
    }
  }
  
  // Method 4: Use grib_filter for complex filtering
  console.log('\n4. Testing grib_filter (most flexible):');
  
  const filterRules = `# Extract only OKC area
print "Processing [centre] [dataDate] [dataTime]";
# Check if point is in OKC bounds
if (latitude >= 35.1 && latitude <= 35.7 && longitude >= 262.2 && longitude <= 262.9) {
  print "[latitude] [longitude] [value]";
}`;
  
  try {
    // Write filter rules to file
    const filterFile = path.join(__dirname, 'temp/okc_filter.rules');
    await fs.writeFile(filterFile, filterRules);
    
    const { stdout } = await execPromise(
      `grib_filter ${filterFile} ${GRIB_FILE} | grep -E "^[0-9]" | wc -l`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    console.log(`✓ grib_filter found ${stdout.trim()} points in OKC area`);
    
    await fs.unlink(filterFile);
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Method 5: Test if we can use bounding box with grib_get
  console.log('\n5. Testing grib_get with area selection:');
  try {
    const { stdout: areaTest } = await execPromise(
      `grib_get -p count,Ni,Nj ${GRIB_FILE} | head -5`,
      { maxBuffer: 1024 * 1024 }
    );
    console.log('Grid info:', areaTest.trim());
    
    // Calculate approximate indices for OKC area
    // CONUS grid is typically 7000x3500
    // OKC is roughly in the middle-south area
    console.log('\nOKC should be approximately:');
    console.log('- X indices: 3500-3600 (middle of US)');
    console.log('- Y indices: 2000-2100 (southern third)');
  } catch (e) {
    console.error('Error:', e.message);
  }
  
  // Method 6: Most efficient - use grib_get_data with pipe to head
  console.log('\n6. Testing early termination approach:');
  try {
    const start = Date.now();
    const { stdout } = await execPromise(
      `grib_get_data ${GRIB_FILE} | awk 'NR==1 || ($1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9)' | head -1000 | wc -l`,
      { maxBuffer: 5 * 1024 * 1024 }
    );
    const elapsed = Date.now() - start;
    console.log(`✓ Found ${stdout.trim()} OKC points in first batch (${elapsed}ms)`);
  } catch (e) {
    console.error('Error:', e.message);
  }
}

// Run tests
testPrefiltering().catch(console.error);
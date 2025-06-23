#!/usr/bin/env node

/**
 * Analyze GRIB2 data characteristics to find optimal extraction method
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

async function analyzeGribStructure() {
  console.log('=== GRIB2 Data Structure Analysis ===\n');
  
  // Find test file
  const files = await fs.readdir('.').catch(() => []);
  const gribFile = files.find(f => f.endsWith('.grib2'));
  
  if (!gribFile) {
    console.log('No GRIB2 file found in current directory');
    return;
  }
  
  console.log(`Analyzing: ${gribFile}\n`);
  
  // 1. File size analysis
  const stats = await fs.stat(gribFile);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  // 2. GRIB metadata
  console.log('\n--- GRIB Metadata ---');
  try {
    const { stdout } = await execPromise(`grib_ls -p centre,gridType,Ni,Nj,packingType ${gribFile}`);
    console.log(stdout);
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // 3. Find where different latitudes appear
  console.log('\n--- Latitude Distribution ---');
  console.log('Sampling every 1M lines to find latitude bands...\n');
  
  const samples = [];
  for (let lineNum = 1; lineNum < 25000000; lineNum += 1000000) {
    try {
      const { stdout } = await execPromise(
        `grib_get_data ${gribFile} | sed -n '${lineNum}p'`,
        { timeout: 5000 }
      );
      
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const val = parseFloat(parts[2]);
        samples.push({ line: lineNum, lat, lon, val });
        console.log(`Line ${lineNum}: lat=${lat.toFixed(2)}°, lon=${lon.toFixed(2)}°, value=${val}`);
      }
    } catch (e) {
      // Ignore errors
    }
  }
  
  // 4. Find OKC latitude band precisely
  console.log('\n--- Finding OKC Band (35.1-35.7°N) ---');
  
  // Binary search for start of OKC latitude
  let low = 10000000;
  let high = 15000000;
  let okcStart = 0;
  
  console.log('Binary searching for latitude 35.7°...');
  while (low < high - 1000) {
    const mid = Math.floor((low + high) / 2);
    try {
      const { stdout } = await execPromise(
        `grib_get_data ${gribFile} | sed -n '${mid}p'`,
        { timeout: 5000 }
      );
      
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        console.log(`Line ${mid}: lat=${lat.toFixed(3)}°`);
        
        if (lat > 35.7) {
          low = mid;
        } else {
          high = mid;
          if (lat <= 35.7 && lat >= 35.6) {
            okcStart = mid;
          }
        }
      }
    } catch (e) {
      break;
    }
  }
  
  console.log(`\nOKC data approximately starts at line: ${okcStart}`);
  
  // 5. Test different extraction methods
  console.log('\n--- Extraction Method Performance ---');
  
  // Method 1: Direct line range with sed
  console.log('\nMethod 1: sed line range');
  let start = Date.now();
  try {
    const { stdout } = await execPromise(
      `grib_get_data ${gribFile} | sed -n '13400000,13410000p' | wc -l`,
      { timeout: 10000 }
    );
    console.log(`Extracted ${stdout.trim()} lines in ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`Failed: ${e.message}`);
  }
  
  // Method 2: awk with line numbers
  console.log('\nMethod 2: awk line range');
  start = Date.now();
  try {
    const { stdout } = await execPromise(
      `grib_get_data ${gribFile} | awk 'NR >= 13400000 && NR <= 13410000' | wc -l`,
      { timeout: 10000 }
    );
    console.log(`Extracted ${stdout.trim()} lines in ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`Failed: ${e.message}`);
  }
  
  // Method 3: Direct coordinate filter
  console.log('\nMethod 3: awk coordinate filter (no line counting)');
  start = Date.now();
  try {
    const { stdout } = await execPromise(
      `grib_get_data ${gribFile} | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9' | wc -l`,
      { timeout: 30000 }
    );
    console.log(`Found ${stdout.trim()} OKC points in ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`Failed: ${e.message}`);
  }
  
  // 6. Memory-efficient streaming test
  console.log('\n--- Streaming Analysis ---');
  console.log('Testing memory usage with streaming...\n');
  
  const memBefore = process.memoryUsage();
  console.log(`Before: RSS=${Math.round(memBefore.rss/1024/1024)}MB`);
  
  await new Promise((resolve) => {
    let count = 0;
    const proc = spawn('sh', ['-c', `grib_get_data ${gribFile} | head -1000000`]);
    
    proc.stdout.on('data', (chunk) => {
      count += chunk.toString().split('\n').length;
    });
    
    proc.on('close', () => {
      const memAfter = process.memoryUsage();
      console.log(`After: RSS=${Math.round(memAfter.rss/1024/1024)}MB`);
      console.log(`Processed ${count} lines via streaming`);
      resolve();
    });
  });
  
  // 7. Find data density
  console.log('\n--- Data Density Analysis ---');
  console.log('Checking how many points have non-zero values...\n');
  
  try {
    const { stdout: totalLines } = await execPromise(
      `grib_get_data ${gribFile} | wc -l`,
      { timeout: 10000 }
    );
    console.log(`Total lines: ${totalLines.trim()}`);
    
    const { stdout: nonZero } = await execPromise(
      `grib_get_data ${gribFile} | awk '$3 > 0' | wc -l`,
      { timeout: 30000 }
    );
    console.log(`Non-zero values: ${nonZero.trim()}`);
    
    const percent = (parseInt(nonZero) / parseInt(totalLines) * 100).toFixed(2);
    console.log(`Data density: ${percent}% of points have hail data`);
  } catch (e) {
    console.log('Could not complete density analysis');
  }
}

// Run analysis
console.log('Starting GRIB2 data structure analysis...\n');
analyzeGribStructure().catch(console.error);
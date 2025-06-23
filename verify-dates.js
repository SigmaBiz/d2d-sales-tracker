#!/usr/bin/env node

// Quick script to verify which file contains which date's data

const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

async function checkFile(fileDate, description) {
  console.log(`\nChecking ${fileDate} file (${description}):`);
  
  const url = `https://mtarchive.geol.iastate.edu/${fileDate.replace(/-/g, '/')}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${fileDate.replace(/-/g, '')}-000000.grib2.gz`;
  
  try {
    await execPromise(`curl -s "${url}" -o temp.grib2.gz && gunzip -f temp.grib2.gz`);
    const { stdout } = await execPromise(`grib_get_data temp.grib2 | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 >= 19.05' | wc -l`);
    
    console.log(`  Reports found: ${stdout.trim()}`);
    
    // Get the actual data timestamp from GRIB metadata
    const { stdout: metadata } = await execPromise(`grib_get -p dataDate,dataTime,endStep temp.grib2 | head -1`);
    console.log(`  GRIB metadata: ${metadata.trim()}`);
    
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
}

async function main() {
  console.log("Verifying which file contains which date's storm data...");
  
  // Check a sequence of dates
  await checkFile('2025-05-17', 'Should contain May 16 data?');
  await checkFile('2025-05-18', 'Should contain May 17 data?');
  await checkFile('2025-05-19', 'Should contain May 18 data?');
  await checkFile('2025-05-20', 'Should contain May 19 data?');
  
  // Clean up
  await execPromise('rm -f temp.grib2 temp.grib2.gz');
}

main().catch(console.error);
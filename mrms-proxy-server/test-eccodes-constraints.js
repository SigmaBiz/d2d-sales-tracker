#!/usr/bin/env node

/**
 * Test ecCodes native constraint capabilities
 * This could be the solution - let ecCodes filter BEFORE loading data
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

async function testConstraints() {
  console.log('Testing ecCodes Native Constraints for OKC Extraction\n');
  
  // Find a test GRIB file
  const tempFiles = await fs.readdir('temp').catch(() => []);
  const gribFile = tempFiles.find(f => f.endsWith('.grib2'));
  
  if (!gribFile) {
    console.log('No GRIB2 file found. Please run the server first to download one.');
    return;
  }
  
  const gribPath = path.join('temp', gribFile);
  console.log(`Using test file: ${gribPath}\n`);
  
  // Test 1: Check what parameters are available
  console.log('Test 1: Available parameters in file');
  try {
    const { stdout } = await execPromise(`grib_ls -p shortName,name ${gribPath} | head -20`);
    console.log(stdout);
  } catch (error) {
    console.log('Error:', error.message);
  }
  
  // Test 2: Try geographic constraints with grib_get_data
  console.log('\nTest 2: Geographic constraints with grib_get_data');
  console.log('Command: grib_get_data -w "latitude>=35.1,latitude<=35.7" file.grib2');
  try {
    const start = Date.now();
    const { stdout } = await execPromise(
      `grib_get_data -w "latitude>=35.1,latitude<=35.7" ${gribPath} | wc -l`,
      { timeout: 30000 }
    );
    const elapsed = Date.now() - start;
    console.log(`Result: ${stdout.trim()} lines in ${elapsed}ms`);
  } catch (error) {
    console.log('Failed:', error.message);
  }
  
  // Test 3: Try with grib_copy to create subset file
  console.log('\nTest 3: Create subset with grib_copy');
  const subsetPath = path.join('temp', 'okc_subset.grib2');
  try {
    const start = Date.now();
    await execPromise(
      `grib_copy -w "latitude>=35.1,latitude<=35.7" ${gribPath} ${subsetPath}`
    );
    const elapsed = Date.now() - start;
    
    // Check subset file size
    const stats = await fs.stat(subsetPath);
    console.log(`Created subset: ${(stats.size / 1024 / 1024).toFixed(2)}MB in ${elapsed}ms`);
    
    // Count points in subset
    const { stdout } = await execPromise(`grib_get_data ${subsetPath} | wc -l`);
    console.log(`Subset contains: ${stdout.trim()} data points`);
    
  } catch (error) {
    console.log('Failed:', error.message);
  }
  
  // Test 4: Try grib_filter with rules file
  console.log('\nTest 4: Using grib_filter with rules');
  const rulesPath = path.join('temp', 'okc_rules.txt');
  const rules = `
# Extract only OKC Metro area
if (latitude >= 35.1 && latitude <= 35.7) {
  write;
}
  `.trim();
  
  await fs.writeFile(rulesPath, rules);
  
  try {
    const filteredPath = path.join('temp', 'okc_filtered.grib2');
    const start = Date.now();
    await execPromise(
      `grib_filter -o ${filteredPath} ${rulesPath} ${gribPath}`
    );
    const elapsed = Date.now() - start;
    
    const stats = await fs.stat(filteredPath);
    console.log(`Filtered file: ${(stats.size / 1024 / 1024).toFixed(2)}MB in ${elapsed}ms`);
    
  } catch (error) {
    console.log('Failed:', error.message);
  }
  
  // Test 5: Memory-efficient streaming with grib_get
  console.log('\nTest 5: Selective parameter extraction');
  try {
    // First, get count of messages
    const { stdout: count } = await execPromise(`grib_count ${gribPath}`);
    console.log(`File contains ${count.trim()} GRIB messages`);
    
    // Try to get specific data
    const { stdout: data } = await execPromise(
      `grib_get -p latitude,longitude,values ${gribPath} | head -100`
    );
    console.log('Sample output:', data.split('\n').slice(0, 5).join('\n'));
    
  } catch (error) {
    console.log('Failed:', error.message);
  }
  
  // Test 6: Find grid structure
  console.log('\nTest 6: Understanding grid structure');
  try {
    const { stdout } = await execPromise(
      `grib_ls -p Ni,Nj,latitudeOfFirstGridPoint,latitudeOfLastGridPoint,longitudeOfFirstGridPoint,longitudeOfLastGridPoint ${gribPath}`
    );
    console.log('Grid info:', stdout);
  } catch (error) {
    console.log('Error:', error.message);
  }
}

testConstraints().catch(console.error);
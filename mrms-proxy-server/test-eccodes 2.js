/**
 * Test script to verify ecCodes installation and functionality
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function testEccodes() {
  console.log('Testing ecCodes installation...\n');
  
  try {
    // Check if grib_get_data is available
    const { stdout: whichResult } = await execPromise('which grib_get_data');
    console.log('✓ grib_get_data found at:', whichResult.trim());
    
    // Check version
    const { stdout: versionResult } = await execPromise('grib_get_data -V 2>&1');
    console.log('✓ ecCodes version:', versionResult.trim());
    
    // List available tools
    const { stdout: toolsList } = await execPromise('ls /opt/homebrew/bin/grib_* | head -10');
    console.log('\n✓ Available ecCodes tools:');
    console.log(toolsList);
    
    console.log('\necCodes is properly installed and ready to use!');
    console.log('\nTo test with real GRIB2 data:');
    console.log('1. Run: node server-eccodes.js');
    console.log('2. Visit: http://localhost:3002/api/mesh/2024-09-24');
    
  } catch (error) {
    console.error('✗ Error:', error.message);
    console.error('\nPlease install ecCodes with: brew install eccodes');
  }
}

testEccodes();
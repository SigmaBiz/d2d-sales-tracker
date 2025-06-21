const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function testDirect() {
  const gribPath = '/Users/antoniomartinez/Desktop/d2d-sales-tracker/mrms-proxy-server/temp/test.grib2';
  
  console.log('Testing direct extraction...');
  
  try {
    // Extract only OKC area using grib_get_data with direct filtering
    const { stdout } = await execPromise(
      `grib_get_data ${gribPath} | head -10`,
      { maxBuffer: 1024 * 1024 }
    );
    
    console.log('First 10 lines:', stdout);
    
    // Count OKC area points
    const { stdout: count } = await execPromise(
      `grib_get_data ${gribPath} | awk 'NR > 1 && $1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 > 0' | wc -l`,
      { maxBuffer: 1024 * 1024 }
    );
    
    console.log('OKC area points with data:', count.trim());
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testDirect();
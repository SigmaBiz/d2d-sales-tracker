const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;

async function testSept24() {
  console.log('Testing Sept 24, 2024 data...\n');
  
  // For Sept 24, we need Sept 25 00:00 UTC file
  const url = 'https://mtarchive.geol.iastate.edu/2024/09/25/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_20240925-000000.grib2.gz';
  
  console.log('1. Downloading:', url);
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });
    
    const writer = require('fs').createWriteStream('test-sept24.grib2.gz');
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log('2. Download complete, decompressing...');
    await execPromise('gunzip -f test-sept24.grib2.gz');
    
    console.log('3. Extracting OKC data with ecCodes...');
    const { stdout } = await execPromise('grib_get_data test-sept24.grib2 | head -100000 | awk \'$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 >= 25.4\' | wc -l');
    
    console.log(`\n✅ SUCCESS: Found ${stdout.trim()} hail reports >= 1 inch in OKC Metro area`);
    
    // Clean up
    await fs.unlink('test-sept24.grib2');
    
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }
}

testSept24();
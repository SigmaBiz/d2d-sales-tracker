const axios = require('axios');
const fs = require('fs');
const { pipeline } = require('stream/promises');

async function testDownload() {
  const url = 'https://mtarchive.geol.iastate.edu/2024/09/25/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_20240925-000000.grib2.gz';
  
  console.log('Testing download with axios stream...');
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });
    
    console.log('Response status:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Content-Length:', response.headers['content-length']);
    
    await pipeline(response.data, fs.createWriteStream('test-stream.grib2.gz'));
    
    console.log('Download complete!');
    console.log('File size:', fs.statSync('test-stream.grib2.gz').size);
    
    // Clean up
    fs.unlinkSync('test-stream.grib2.gz');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }
  }
}

testDownload();
/**
 * Test script to diagnose Render production issues
 * Tests various dates and endpoints
 */

const axios = require('axios');

const PRODUCTION_URL = 'https://d2d-dynamic-server.onrender.com';

async function testProductionServer() {
  console.log('=== Testing D2D Dynamic Server on Render ===\n');
  
  const testDates = [
    '2024-09-24',  // Known storm date
    '2024-05-15',  // Spring storm season
    '2024-04-27',  // Another known storm
    '2025-06-21',  // Yesterday
    '2025-06-20',  // Two days ago
    '2025-03-15',  // Random spring date
  ];
  
  console.log('1. Testing multiple dates for hail data:\n');
  
  for (const date of testDates) {
    try {
      console.log(`Testing ${date}...`);
      const response = await axios.get(`${PRODUCTION_URL}/api/mesh/${date}`);
      const reportCount = response.data.reports.length;
      
      if (reportCount > 0) {
        console.log(`✓ ${date}: Found ${reportCount} hail reports!`);
        console.log(`  Max size: ${response.data.summary.maxSize}" at ${response.data.reports[0].city}`);
      } else {
        console.log(`✗ ${date}: No hail data found`);
      }
    } catch (error) {
      console.log(`✗ ${date}: Error - ${error.message}`);
    }
  }
  
  console.log('\n2. Testing local endpoint for timezone handling:\n');
  
  try {
    const localResponse = await axios.get(`${PRODUCTION_URL}/api/mesh/local/2024-09-24`);
    console.log('Local endpoint response:', {
      reports: localResponse.data.reports.length,
      note: localResponse.data.note
    });
  } catch (error) {
    console.log('Local endpoint error:', error.message);
  }
  
  console.log('\n3. Checking for any cached data:\n');
  
  // Try some dates that might be cached
  const cachedDates = ['2024-09-23', '2024-11-03', '2025-05-17'];
  
  for (const date of cachedDates) {
    try {
      const response = await axios.get(`${PRODUCTION_URL}/api/mesh/${date}`);
      if (response.data.reports.length > 0) {
        console.log(`✓ ${date}: ${response.data.reports.length} reports (possibly cached)`);
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  console.log('\n=== Analysis ===');
  console.log('If all dates return 0 reports, possible issues:');
  console.log('1. GRIB2 processing failing due to memory limits');
  console.log('2. ecCodes not finding data in the expected format');
  console.log('3. Coordinate filtering too restrictive');
  console.log('4. IEM Archive file structure changed');
  console.log('\nCheck Render logs for [DYNAMIC] messages during processing');
}

testProductionServer().catch(console.error);
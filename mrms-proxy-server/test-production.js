/**
 * Production Server Diagnostic Script
 * Tests the production server's ability to process GRIB2 data
 * Following NO MOCK DATA protocol - must show real failures
 */

const axios = require('axios');

const PRODUCTION_URL = 'https://d2d-dynamic-server.onrender.com';

async function runDiagnostics() {
  console.log('=== D2D Production Server Diagnostics ===\n');
  
  try {
    // Test 1: Basic health check
    console.log('1. Testing server health...');
    const healthResponse = await axios.get(`${PRODUCTION_URL}/health`);
    console.log('✓ Server is healthy:', healthResponse.data);
    console.log('');
    
    // Test 2: Check available dates
    console.log('2. Checking available storm dates...');
    const availableResponse = await axios.get(`${PRODUCTION_URL}/api/mesh/available`);
    console.log('✓ Available dates:', availableResponse.data.availableDates);
    console.log('');
    
    // Test 3: Try to fetch Sept 24, 2024 data
    console.log('3. Testing Sept 24, 2024 storm data...');
    const sept24Response = await axios.get(`${PRODUCTION_URL}/api/mesh/2024-09-24`);
    console.log('Response:', {
      date: sept24Response.data.date,
      reports: sept24Response.data.reports.length,
      summary: sept24Response.data.summary
    });
    
    if (sept24Response.data.reports.length === 0) {
      console.log('❌ PROBLEM: Server returned empty data instead of real storm data');
      console.log('   This violates our NO MOCK DATA protocol');
    } else {
      console.log('✓ Got', sept24Response.data.reports.length, 'real hail reports');
    }
    console.log('');
    
    // Test 4: Check a more recent date
    console.log('4. Testing a recent date (yesterday)...');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const recentResponse = await axios.get(`${PRODUCTION_URL}/api/mesh/${yesterdayStr}`);
    console.log('Response for', yesterdayStr + ':', {
      reports: recentResponse.data.reports.length
    });
    console.log('');
    
    // Test 5: Force a diagnostic check (if endpoint exists)
    console.log('5. Requesting detailed diagnostics...');
    try {
      const diagResponse = await axios.get(`${PRODUCTION_URL}/api/diagnostics`);
      console.log('Diagnostics:', diagResponse.data);
    } catch (error) {
      console.log('No diagnostics endpoint available');
    }
    
  } catch (error) {
    console.error('❌ Diagnostic failed:', error.message);
    if (error.response) {
      console.error('Server responded with:', error.response.status, error.response.data);
    }
  }
  
  console.log('\n=== Diagnosis Complete ===');
  console.log('\nRecommendations:');
  console.log('1. Check Render logs at: https://dashboard.render.com');
  console.log('2. Verify ecCodes is properly installed in Docker image');
  console.log('3. Check if server has enough memory to process GRIB2 files');
  console.log('4. Ensure IEM Archive URLs are accessible from Render servers');
}

// Run diagnostics
runDiagnostics().catch(console.error);
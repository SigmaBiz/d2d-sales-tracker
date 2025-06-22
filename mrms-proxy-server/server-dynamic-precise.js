/**
 * MRMS Dynamic Server with Precise Pre-filtering
 * Uses knowledge that OKC data is typically around line 13.5M-13.9M
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const { createWriteStream } = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { pipeline } = require('stream/promises');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  
  OKC_METRO_BOUNDS: {
    north: 35.7,
    south: 35.1,
    east: -97.1,
    west: -97.8
  },
  
  CACHE_DIR: path.join(__dirname, 'cache'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  CACHE_DURATION: 24 * 60 * 60 * 1000,
  MIN_HAIL_SIZE: 0.75,
  PORT: process.env.PORT || 3002,
  
  // Pre-filtering optimization based on testing
  // OKC data typically falls in this range
  OKC_LINE_RANGE: {
    start: 13400000,  // Start a bit early to be safe
    end: 14000000     // End a bit late to be safe
  }
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

/**
 * Extract OKC data using predetermined line range
 * Much faster than scanning or processing all data
 */
async function extractOKCMetroDataPrecise(gribPath, date) {
  const reports = [];
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    console.log(`[PRECISE] Extracting lines ${CONFIG.OKC_LINE_RANGE.start} to ${CONFIG.OKC_LINE_RANGE.end}...`);
    
    // Use awk for efficient line extraction (more compatible with Linux)
    const extractCommand = spawn('sh', ['-c', 
      `grib_get_data ${gribPath} | awk 'NR==1 || (NR>=${CONFIG.OKC_LINE_RANGE.start} && NR<=${CONFIG.OKC_LINE_RANGE.end})'`
    ]);
    
    // Add manual timeout
    const timeout = setTimeout(() => {
      extractCommand.kill('SIGTERM');
      reject(new Error('Extract command timed out after 30 seconds'));
    }, 30000);
    
    let buffer = '';
    let processedLines = 0;
    let headerSkipped = false;
    let inOKCArea = false;
    
    extractCommand.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        processedLines++;
        
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Handle header
        if (!headerSkipped) {
          if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
            headerSkipped = true;
            console.log('[PRECISE] Processing data...');
          }
          continue;
        }
        
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          const meshValue = parseFloat(parts[2]);
          
          if (isNaN(lat) || isNaN(lon) || isNaN(meshValue) || meshValue <= 0) {
            continue;
          }
          
          // Convert longitude if needed
          const adjustedLon = lon > 180 ? lon - 360 : lon;
          
          // Check OKC bounds
          if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
              lat <= CONFIG.OKC_METRO_BOUNDS.north &&
              adjustedLon >= CONFIG.OKC_METRO_BOUNDS.west && 
              adjustedLon <= CONFIG.OKC_METRO_BOUNDS.east) {
            
            if (!inOKCArea) {
              inOKCArea = true;
              console.log(`[PRECISE] Found OKC data at line ${CONFIG.OKC_LINE_RANGE.start + processedLines}`);
            }
            
            const sizeInches = meshValue / 25.4;
            
            if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
              reports.push({
                id: `mesh_${date.getTime()}_${reports.length}`,
                latitude: lat,
                longitude: adjustedLon,
                size: Math.round(sizeInches * 100) / 100,
                timestamp: date.toISOString(),
                confidence: calculateConfidence(sizeInches),
                city: getCityName(lat, adjustedLon),
                source: 'IEM MRMS Archive',
                meshValue: meshValue
              });
              
              if (reports.length <= 3) {
                console.log(`[PRECISE] Hail report #${reports.length}: ${sizeInches.toFixed(2)}" at ${lat},${adjustedLon}`);
              }
            }
          } else if (inOKCArea && lat < CONFIG.OKC_METRO_BOUNDS.south) {
            // We've passed OKC area, can stop early
            console.log('[PRECISE] Passed OKC area, terminating extraction');
            extractCommand.kill();
            break;
          }
        }
        
        // Progress update
        if (processedLines % 100000 === 0) {
          console.log(`[PRECISE] Processed ${processedLines} lines, found ${reports.length} reports`);
        }
      }
    });
    
    let stderrBuffer = '';
    extractCommand.stderr.on('data', (data) => {
      const error = data.toString();
      stderrBuffer += error;
      console.error('[PRECISE] Extract stderr:', error);
    });
    
    extractCommand.on('close', (code) => {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;
      console.log(`[PRECISE] Extraction complete in ${elapsed}ms`);
      console.log(`[PRECISE] Processed ${processedLines} lines, found ${reports.length} reports`);
      
      if (code !== 0 && code !== null) {
        reject(new Error(`Extract process exited with code ${code}. Stderr: ${stderrBuffer}`));
      } else {
        resolve(reports);
      }
    });
    
    extractCommand.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Comprehensive test endpoint for GRIB2 processing
app.get('/api/test/grib2/:date', async (req, res) => {
  const startTime = Date.now();
  const results = {
    date: req.params.date,
    steps: {},
    errors: [],
    memory: {}
  };
  
  try {
    // Step 1: Memory check
    results.memory.start = process.memoryUsage();
    results.steps.memoryCheck = { status: 'ok', rss: Math.round(results.memory.start.rss / 1024 / 1024) + ' MB' };
    
    // Step 2: Date validation
    const dateMatch = req.params.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      throw new Error('Invalid date format');
    }
    const requestedDate = new Date(req.params.date + 'T12:00:00Z');
    results.steps.dateValidation = { status: 'ok', date: requestedDate.toISOString() };
    
    // Step 3: Build URL
    const utcDate = new Date(requestedDate.toISOString().split('T')[0] + 'T00:00:00Z');
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    results.steps.urlBuild = { status: 'ok', url };
    
    // Step 4: Download test (HEAD request)
    const headResponse = await axios.head(url, { timeout: 10000 });
    results.steps.downloadCheck = { 
      status: 'ok', 
      contentLength: headResponse.headers['content-length'],
      contentType: headResponse.headers['content-type']
    };
    
    // Step 5: Temp directory check
    const tempStats = await fs.stat(CONFIG.TEMP_DIR);
    results.steps.tempDirCheck = { status: 'ok', exists: true, isDirectory: tempStats.isDirectory() };
    
    // Step 6: ecCodes check
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const { stdout: ecCodesVersion } = await execPromise('grib_get_data -V 2>&1 || echo "not found"');
    results.steps.ecCodesCheck = { status: 'ok', version: ecCodesVersion.trim() };
    
    // Step 7: Test extraction command
    const testCmd = `echo "lat lon value" | awk 'NR==1 || (NR>=13400000 && NR<=13400001)'`;
    const { stdout: awkTest } = await execPromise(testCmd);
    results.steps.awkTest = { status: 'ok', output: awkTest.trim() };
    
    // Final memory check
    results.memory.end = process.memoryUsage();
    results.steps.memoryDelta = { 
      status: 'ok', 
      rssDelta: Math.round((results.memory.end.rss - results.memory.start.rss) / 1024 / 1024) + ' MB' 
    };
    
    results.success = true;
    results.elapsed = Date.now() - startTime;
    
  } catch (error) {
    results.success = false;
    results.error = {
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }
  
  res.json(results);
});

// Test actual GRIB2 processing with minimal data
app.get('/api/test/process/:date', async (req, res) => {
  const testResults = {
    date: req.params.date,
    steps: [],
    memory: {},
    success: false
  };
  
  try {
    // Monitor memory
    testResults.memory.start = Math.round(process.memoryUsage().rss / 1024 / 1024);
    
    // Step 1: Download a small chunk
    testResults.steps.push({ step: 'download', status: 'starting' });
    
    const requestedDate = new Date(req.params.date + 'T12:00:00Z');
    const utcDate = new Date(requestedDate.toISOString().split('T')[0] + 'T00:00:00Z');
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    const fileName = path.basename(url);
    const gzPath = path.join(CONFIG.TEMP_DIR, 'test_' + fileName);
    const gribPath = gzPath.replace('.gz', '');
    
    // Download with size limit
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 20000,
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      headers: {
        'Range': 'bytes=0-524288' // Try to get first 512KB only
      }
    });
    
    const writer = createWriteStream(gzPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    
    testResults.steps.push({ 
      step: 'download', 
      status: 'complete',
      size: (await fs.stat(gzPath)).size
    });
    
    // Step 2: Extract
    await util.promisify(exec)(`gunzip -f ${gzPath}`);
    testResults.steps.push({ 
      step: 'extract', 
      status: 'complete',
      size: (await fs.stat(gribPath)).size
    });
    
    // Step 3: Test grib_get_data
    const { stdout: gribInfo } = await util.promisify(exec)(`grib_get_data ${gribPath} | head -n 5`);
    testResults.steps.push({ 
      step: 'grib_get_data', 
      status: 'complete',
      sample: gribInfo.trim().split('\n').slice(0, 3)
    });
    
    // Step 4: Test extraction
    const { stdout: extracted } = await util.promisify(exec)(
      `grib_get_data ${gribPath} | awk 'NR==1 || (NR>=100 && NR<=110)'`
    );
    testResults.steps.push({ 
      step: 'awk_extraction', 
      status: 'complete',
      lines: extracted.trim().split('\n').length
    });
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    testResults.memory.end = Math.round(process.memoryUsage().rss / 1024 / 1024);
    testResults.memory.delta = testResults.memory.end - testResults.memory.start;
    testResults.success = true;
    
  } catch (error) {
    testResults.error = {
      message: error.message,
      code: error.code,
      step: testResults.steps[testResults.steps.length - 1]?.step || 'unknown'
    };
  }
  
  res.json(testResults);
});

// Debug endpoint to test awk command
app.get('/api/debug/awk', async (req, res) => {
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  try {
    // Test basic awk functionality
    const { stdout: awkTest } = await execPromise('echo -e "line1\\nline2\\nline3" | awk "NR==1 || NR==3"');
    
    // Test awk version
    const { stdout: awkVersion } = await execPromise('awk --version 2>&1 || echo "awk version not available"');
    
    // Test with large numbers
    const { stdout: largeTest } = await execPromise('seq 1 5 | awk "NR==1 || (NR>=3 && NR<=4)"');
    
    res.json({
      awkTest: awkTest.trim().split('\n'),
      awkVersion: awkVersion.trim().split('\n')[0],
      largeNumberTest: largeTest.trim().split('\n'),
      extraction_command: `grib_get_data file.grib2 | awk 'NR==1 || (NR>=${CONFIG.OKC_LINE_RANGE.start} && NR<=${CONFIG.OKC_LINE_RANGE.end})'`
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'AWK test failed',
      message: error.message,
      stderr: error.stderr
    });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-precise',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    optimization: `Pre-filtered extraction (lines ${CONFIG.OKC_LINE_RANGE.start}-${CONFIG.OKC_LINE_RANGE.end})`
  });
});

// Main MESH endpoint
app.get('/api/mesh/:date', async (req, res) => {
  const memBefore = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[PRECISE] Memory before request: ${memBefore} MB`);
  
  try {
    const requestedDate = new Date(req.params.date + 'T00:00:00Z');
    
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    // Check cache first
    const cacheFile = path.join(CONFIG.CACHE_DIR, `okc_mesh_${req.params.date}.json`);
    try {
      const stats = await fs.stat(cacheFile);
      if (Date.now() - stats.mtime.getTime() < CONFIG.CACHE_DURATION) {
        console.log('[PRECISE] Serving from cache');
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      // Cache miss - continue
    }
    
    // Build URL for IEM archive
    const utcDate = new Date(requestedDate.toISOString().split('T')[0] + 'T00:00:00Z');
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    
    console.log(`[PRECISE] Fetching ${url}`);
    
    const fileName = path.basename(url);
    const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
    const gribPath = gzPath.replace('.gz', '');
    
    // Download file
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MRMS-Proxy/1.0)'
      }
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    console.log('[PRECISE] Download complete');
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    
    const memAfterDownload = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[PRECISE] Memory after decompress: ${memAfterDownload} MB`);
    
    // Extract with precise line range
    const reports = await extractOKCMetroDataPrecise(gribPath, requestedDate);
    
    // Sort reports by size (largest first)
    reports.sort((a, b) => b.size - a.size);
    
    const memAfterProcess = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[PRECISE] Memory after processing: ${memAfterProcess} MB`);
    console.log(`[PRECISE] Found ${reports.length} hail reports >= ${CONFIG.MIN_HAIL_SIZE}"`);
    
    if (reports.length > 0) {
      console.log(`[PRECISE] Largest hail: ${reports[0].size}" at ${reports[0].city}`);
    }
    
    // Prepare response
    const responseData = {
      date: requestedDate.toISOString().split('T')[0],
      source: 'IEM Archive MRMS',
      bounds: CONFIG.OKC_METRO_BOUNDS,
      reports: reports,
      summary: {
        totalReports: reports.length,
        maxSize: reports.length > 0 ? Math.max(...reports.map(r => r.size)) : 0,
        avgSize: reports.length > 0 ? 
          reports.reduce((sum, r) => sum + r.size, 0) / reports.length : 0
      }
    };
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(responseData, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    res.json(responseData);
    
  } catch (error) {
    console.error('[PRECISE] Error processing request:', error);
    
    // NO MOCK DATA - must fail explicitly
    throw error;
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[PRECISE] Server error:', err);
  res.status(500).json({ 
    error: 'Failed to process MESH data',
    details: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Helper functions
function calculateConfidence(sizeInches) {
  if (sizeInches >= 2.0) return 95;
  if (sizeInches >= 1.5) return 90;
  if (sizeInches >= 1.25) return 85;
  if (sizeInches >= 1.0) return 80;
  return 75;
}

function getCityName(lat, lon) {
  const cities = [
    { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164, radius: 0.15 },
    { name: 'Edmond', lat: 35.6529, lon: -97.4779, radius: 0.1 },
    { name: 'Moore', lat: 35.3395, lon: -97.4867, radius: 0.08 },
    { name: 'Norman', lat: 35.2226, lon: -97.4395, radius: 0.1 },
    { name: 'Midwest City', lat: 35.4495, lon: -97.3967, radius: 0.08 },
    { name: 'Yukon', lat: 35.5067, lon: -97.7625, radius: 0.08 },
    { name: 'Bethany', lat: 35.5184, lon: -97.6322, radius: 0.06 },
    { name: 'Del City', lat: 35.4420, lon: -97.4409, radius: 0.06 },
    { name: 'Mustang', lat: 35.3842, lon: -97.7245, radius: 0.08 },
    { name: 'Newcastle', lat: 35.2473, lon: -97.5997, radius: 0.06 }
  ];
  
  for (const city of cities) {
    const distance = Math.sqrt(
      Math.pow(lat - city.lat, 2) + 
      Math.pow(lon - city.lon, 2)
    );
    if (distance <= city.radius) {
      return city.name;
    }
  }
  
  return 'OKC Metro';
}

// Start server
async function start() {
  await ensureDirectories();
  
  app.listen(CONFIG.PORT, () => {
    console.log(`[PRECISE] MRMS Precise Pre-filtered Server running on port ${CONFIG.PORT}`);
    console.log(`[PRECISE] Extracting lines ${CONFIG.OKC_LINE_RANGE.start}-${CONFIG.OKC_LINE_RANGE.end} (600k lines vs 24.5M)`);
    console.log(`[PRECISE] OKC Metro bounds: ${JSON.stringify(CONFIG.OKC_METRO_BOUNDS)}`);
  });
}

start().catch(console.error);
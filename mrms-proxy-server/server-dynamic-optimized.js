/**
 * Optimized MRMS Dynamic Server for Render Free Tier
 * Uses pre-filtering to stay within 512MB memory limit
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
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
  // IEM Archive base URL
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  
  // OKC Metro bounds - expanded to include entire metropolitan area
  OKC_METRO_BOUNDS: {
    north: 35.7,    // North of Edmond
    south: 35.1,    // South of Norman  
    east: -97.1,    // East of Midwest City
    west: -97.8     // West of Yukon
  },
  
  // Cache settings
  CACHE_DIR: path.join(__dirname, 'cache'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
  
  // Processing settings
  MIN_HAIL_SIZE: 0.75, // 0.75 inches minimum
  PORT: process.env.PORT || 3002
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

/**
 * Check if eccodes is installed
 */
async function checkEccodes() {
  try {
    await execPromise('which grib_get_data');
    return true;
  } catch (error) {
    console.error('ecCodes not found. Install with: apt-get install libeccodes-tools');
    return false;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  const hasEccodes = await checkEccodes();
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-optimized',
    eccodes: hasEccodes ? 'installed' : 'missing',
    bounds: CONFIG.OKC_METRO_BOUNDS,
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    capabilities: {
      dateRange: 'Last 12 months',
      dataType: 'MESH 24-hour maximum',
      coverage: 'OKC Metro only',
      optimization: 'Pre-filtered extraction'
    }
  });
});

/**
 * Debug endpoint for troubleshooting data extraction
 */
app.get('/api/debug/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;
    const requestedDate = new Date(dateStr + 'T00:00:00Z');
    
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    console.log(`[DEBUG] Processing debug request for ${dateStr}`);
    
    // Download GRIB2 file
    const utcDate = new Date(requestedDate.toISOString().split('T')[0] + 'T00:00:00Z');
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    const fileName = path.basename(url);
    const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
    const gribPath = gzPath.replace('.gz', '');
    
    console.log(`[DEBUG] Downloading from: ${url}`);
    
    // Download file
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    console.log(`[DEBUG] Download complete, decompressing...`);
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Get file info
    const stats = await fs.stat(gribPath);
    const fileInfo = {
      size: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2)
    };
    
    // Try different extraction methods
    const results = {};
    
    // Method 1: Raw extraction sample
    try {
      const { stdout: rawSample } = await execPromise(
        `grib_get_data ${gribPath} | head -20`,
        { maxBuffer: 1024 * 1024 }
      );
      results.rawSample = rawSample.split('\n').slice(0, 10);
    } catch (e) {
      results.rawSample = `Error: ${e.message}`;
    }
    
    // Method 2: Count total points
    try {
      const { stdout: totalCount } = await execPromise(
        `grib_get_data ${gribPath} | wc -l`,
        { maxBuffer: 1024 * 1024 }
      );
      results.totalPoints = parseInt(totalCount.trim()) - 1; // Minus header
    } catch (e) {
      results.totalPoints = `Error: ${e.message}`;
    }
    
    // Method 3: Check for any non-zero values
    try {
      const { stdout: nonZeroCount } = await execPromise(
        `grib_get_data ${gribPath} | awk 'NR>1 && $3>0' | wc -l`,
        { maxBuffer: 1024 * 1024 }
      );
      results.nonZeroPoints = parseInt(nonZeroCount.trim());
    } catch (e) {
      results.nonZeroPoints = `Error: ${e.message}`;
    }
    
    // Method 4: Test different coordinate filters
    const filters = [
      {
        name: 'Oklahoma State (broad)',
        filter: '$1 >= 33.5 && $1 <= 37 && $2 >= 260 && $2 <= 265'
      },
      {
        name: 'OKC Metro (0-360 lon)',
        filter: '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9'
      },
      {
        name: 'OKC Metro (-180-180 lon)',
        filter: '$1 >= 35.1 && $1 <= 35.7 && $2 >= -97.8 && $2 <= -97.1'
      },
      {
        name: 'Test if lon > 180',
        filter: '$2 > 180'
      }
    ];
    
    results.filterTests = {};
    
    for (const test of filters) {
      try {
        const { stdout: count } = await execPromise(
          `grib_get_data ${gribPath} | awk 'NR>1 && ${test.filter}' | wc -l`,
          { maxBuffer: 5 * 1024 * 1024 }
        );
        results.filterTests[test.name] = parseInt(count.trim());
      } catch (e) {
        results.filterTests[test.name] = `Error: ${e.message}`;
      }
    }
    
    // Method 5: Memory usage test
    const memBefore = process.memoryUsage();
    try {
      await execPromise(
        `grib_get_data ${gribPath} | head -1000`,
        { maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // Ignore
    }
    const memAfter = process.memoryUsage();
    
    results.memoryTest = {
      before: Math.round(memBefore.rss / 1024 / 1024) + ' MB',
      after: Math.round(memAfter.rss / 1024 / 1024) + ' MB',
      increase: Math.round((memAfter.rss - memBefore.rss) / 1024 / 1024) + ' MB'
    };
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    res.json({
      date: dateStr,
      file: fileInfo,
      results: results,
      analysis: {
        coordinateFormat: results.filterTests['Test if lon > 180'] > 0 ? '0-360' : '-180-180',
        hasOKCData: results.filterTests['OKC Metro (0-360 lon)'] > 0 || results.filterTests['OKC Metro (-180-180 lon)'] > 0,
        recommendation: 'Check which coordinate filter matches your data'
      }
    });
    
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ 
      error: 'Debug failed',
      message: error.message 
    });
  }
});

/**
 * Optimized MESH data extraction using streaming and pre-filtering
 */
async function extractOKCMetroDataOptimized(gribPath, date) {
  const reports = [];
  let processedLines = 0;
  
  return new Promise((resolve, reject) => {
    // Use spawn for streaming to avoid loading all data into memory
    const gribProcess = spawn('grib_get_data', [gribPath]);
    
    let buffer = '';
    let headerSkipped = false;
    
    gribProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      
      // Keep last incomplete line in buffer
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        processedLines++;
        
        if (processedLines % 100000 === 0) {
          console.log(`[DYNAMIC] Processed ${processedLines} lines, found ${reports.length} reports`);
        }
        
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Skip header
        if (!headerSkipped) {
          if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
            headerSkipped = true;
          }
          continue;
        }
        
        // Parse line
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          const meshValue = parseFloat(parts[2]);
          
          // Skip invalid
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
            }
          }
        }
      }
    });
    
    gribProcess.stderr.on('data', (data) => {
      console.error('[DYNAMIC] GRIB error:', data.toString());
    });
    
    gribProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`GRIB process exited with code ${code}`));
      } else {
        console.log(`[DYNAMIC] Extraction complete: ${processedLines} lines processed, ${reports.length} reports found`);
        resolve(reports);
      }
    });
    
    gribProcess.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Main MESH endpoint with optimized processing
 */
app.get('/api/mesh/:date', async (req, res) => {
  try {
    // [Previous validation code remains the same...]
    
    const requestedDate = new Date(req.params.date + 'T00:00:00Z');
    
    // Check cache first
    const cacheFile = path.join(CONFIG.CACHE_DIR, `okc_mesh_${req.params.date}.json`);
    try {
      const stats = await fs.stat(cacheFile);
      if (Date.now() - stats.mtime.getTime() < CONFIG.CACHE_DURATION) {
        console.log('[DYNAMIC] Serving from cache');
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      // Cache miss
    }
    
    // Download and process
    const data = await fetchAndProcessMESHOptimized(requestedDate);
    
    // Cache results
    await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    
    res.json(data);
    
  } catch (error) {
    console.error('[DYNAMIC] Error:', error);
    res.status(500).json({ 
      error: 'Failed to process MESH data',
      details: error.message 
    });
  }
});

/**
 * Fetch and process MESH data with memory optimization
 */
async function fetchAndProcessMESHOptimized(date) {
  const utcDate = new Date(date.toISOString().split('T')[0] + 'T00:00:00Z');
  const nextDay = new Date(utcDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  
  const year = nextDay.getUTCFullYear();
  const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nextDay.getUTCDate()).padStart(2, '0');
  
  const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
  
  console.log(`[DYNAMIC] Fetching ${url}`);
  console.log(`[DYNAMIC] Memory before download: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
  
  const fileName = path.basename(url);
  const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
  const gribPath = gzPath.replace('.gz', '');
  
  try {
    // Download file
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'D2D-Sales-Tracker/1.0 (Hail Intelligence System)'
      }
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    console.log(`[DYNAMIC] Download complete`);
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    console.log(`[DYNAMIC] Memory after decompress: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
    
    // Process with streaming
    const reports = await extractOKCMetroDataOptimized(gribPath, date);
    
    return {
      date: date.toISOString().split('T')[0],
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
    
  } finally {
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    console.log(`[DYNAMIC] Memory after cleanup: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
  }
}

// Helper functions (calculateConfidence, getCityName) remain the same...
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
    console.log(`[DYNAMIC] MRMS Optimized Server running on port ${CONFIG.PORT}`);
    console.log(`[DYNAMIC] Memory-optimized for 512MB limit`);
    console.log(`[DYNAMIC] Using streaming and pre-filtering`);
  });
}

start().catch(console.error);
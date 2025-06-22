/**
 * MRMS Dynamic Server with Intelligent Pre-filtering
 * Uses a two-pass approach: quick scan to find OKC location, then targeted extraction
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
  PORT: process.env.PORT || 3002
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

/**
 * Quick scan to find OKC data location in GRIB file
 * Uses sampling to reduce scan time
 */
async function findOKCDataRange(gribPath) {
  return new Promise((resolve, reject) => {
    console.log('[PREFILTER] Starting quick scan for OKC location...');
    
    const sampleRate = 100000; // Check every 100k lines
    let lineNumber = 0;
    let okcStartLine = -1;
    let okcEndLine = -1;
    let headerSkipped = false;
    let buffer = '';
    
    const scanProcess = spawn('sh', ['-c', 
      `grib_get_data ${gribPath} | awk 'NR==1 || NR % ${sampleRate} == 0'`
    ]);
    
    scanProcess.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!headerSkipped) {
          if (line.includes('Latitude') || line.includes('lat')) {
            headerSkipped = true;
          }
          lineNumber++;
          continue;
        }
        
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const lat = parseFloat(parts[0]);
          
          // Track approximate line numbers
          if (!isNaN(lat)) {
            // Estimate actual line number based on sampling
            const estimatedLine = lineNumber * sampleRate;
            
            if (lat >= 35.1 && lat <= 35.7 && okcStartLine === -1) {
              // Found approximate start - back up a bit to ensure we catch everything
              okcStartLine = Math.max(1, estimatedLine - sampleRate);
              console.log(`[PREFILTER] Found OKC area around line ${estimatedLine}`);
            } else if (okcStartLine !== -1 && lat < 35.1) {
              // Passed OKC area
              okcEndLine = estimatedLine + sampleRate; // Add buffer
              scanProcess.kill();
              break;
            }
          }
        }
        lineNumber++;
      }
    });
    
    scanProcess.on('close', () => {
      if (okcStartLine === -1) {
        // Fallback to known range if scan fails
        console.log('[PREFILTER] Quick scan failed, using fallback range');
        resolve({ start: 13400000, end: 13800000 });
      } else {
        const range = {
          start: okcStartLine,
          end: okcEndLine || okcStartLine + 400000
        };
        console.log(`[PREFILTER] OKC data range: lines ${range.start} to ${range.end}`);
        resolve(range);
      }
    });
    
    scanProcess.on('error', (err) => {
      console.error('[PREFILTER] Scan error, using fallback');
      resolve({ start: 13400000, end: 13800000 });
    });
  });
}

/**
 * Extract OKC data using pre-determined line range
 */
async function extractOKCMetroDataPrefiltered(gribPath, date, lineRange) {
  const reports = [];
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    console.log(`[PREFILTER] Extracting lines ${lineRange.start} to ${lineRange.end}...`);
    
    // Use sed for efficient line extraction
    const extractCommand = spawn('sh', ['-c', 
      `grib_get_data ${gribPath} | sed -n '${lineRange.start},${lineRange.end}p'`
    ]);
    
    let buffer = '';
    let processedLines = 0;
    let headerSkipped = false;
    
    extractCommand.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        processedLines++;
        
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Skip header if present
        if (!headerSkipped) {
          if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
            headerSkipped = true;
            console.log('[PREFILTER] Processing data...');
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
                console.log(`[PREFILTER] Hail report #${reports.length}: ${sizeInches.toFixed(2)}" at ${lat},${adjustedLon}`);
              }
            }
          }
        }
      }
    });
    
    extractCommand.stderr.on('data', (data) => {
      console.error('[PREFILTER] Extract stderr:', data.toString());
    });
    
    extractCommand.on('close', (code) => {
      const elapsed = Date.now() - startTime;
      console.log(`[PREFILTER] Extraction complete in ${elapsed}ms`);
      console.log(`[PREFILTER] Processed ${processedLines} lines, found ${reports.length} reports`);
      
      if (code !== 0) {
        reject(new Error(`Extract process exited with code ${code}`));
      } else {
        resolve(reports);
      }
    });
    
    extractCommand.on('error', (err) => {
      reject(err);
    });
  });
}

// Alternative: Use NetCDF subset if grib_to_netcdf worked
async function tryNetCDFExtraction(gribPath, date) {
  try {
    const ncFile = gribPath + '.nc';
    console.log('[PREFILTER] Attempting NetCDF conversion with area subset...');
    
    // Convert to NetCDF with OKC area subset
    await execPromise(
      `grib_to_netcdf -S area:35.1/-97.8/35.7/-97.1 -o ${ncFile} ${gribPath}`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );
    
    // Extract data from NetCDF
    const { stdout } = await execPromise(
      `grib_get_data ${ncFile}`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    await fs.unlink(ncFile).catch(() => {});
    
    // Process the data
    const lines = stdout.split('\n');
    const reports = [];
    let headerSkipped = false;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      if (!headerSkipped) {
        if (line.includes('Latitude') || line.includes('lat')) {
          headerSkipped = true;
        }
        continue;
      }
      
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const meshValue = parseFloat(parts[2]);
        
        if (!isNaN(lat) && !isNaN(lon) && !isNaN(meshValue) && meshValue > 0) {
          const adjustedLon = lon > 180 ? lon - 360 : lon;
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
    
    console.log(`[PREFILTER] NetCDF extraction found ${reports.length} reports`);
    return reports;
    
  } catch (e) {
    console.log('[PREFILTER] NetCDF approach failed:', e.message);
    return null;
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-prefiltered',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    optimization: 'Two-pass pre-filtering with line range detection'
  });
});

// Main MESH endpoint
app.get('/api/mesh/:date', async (req, res) => {
  const memBefore = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(`[PREFILTER] Memory before request: ${memBefore} MB`);
  
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
        console.log('[PREFILTER] Serving from cache');
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
    
    console.log(`[PREFILTER] Fetching ${url}`);
    
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
    console.log('[PREFILTER] Download complete');
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    
    const memAfterDownload = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[PREFILTER] Memory after decompress: ${memAfterDownload} MB`);
    
    let reports = [];
    
    // Try NetCDF approach first (fastest if it works)
    reports = await tryNetCDFExtraction(gribPath, requestedDate);
    
    if (!reports) {
      // Fall back to line-range approach
      const lineRange = await findOKCDataRange(gribPath);
      reports = await extractOKCMetroDataPrefiltered(gribPath, requestedDate, lineRange);
    }
    
    // Sort reports by size (largest first)
    reports.sort((a, b) => b.size - a.size);
    
    const memAfterProcess = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[PREFILTER] Memory after processing: ${memAfterProcess} MB`);
    console.log(`[PREFILTER] Found ${reports.length} hail reports >= ${CONFIG.MIN_HAIL_SIZE}"`);
    
    if (reports.length > 0) {
      console.log(`[PREFILTER] Largest hail: ${reports[0].size}" at ${reports[0].city}`);
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
    console.error('[PREFILTER] Error processing request:', error);
    
    // NO MOCK DATA - must fail explicitly
    throw error;
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[PREFILTER] Server error:', err);
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
    console.log(`[PREFILTER] MRMS Pre-filtered Server running on port ${CONFIG.PORT}`);
    console.log(`[PREFILTER] Using intelligent two-pass extraction`);
    console.log(`[PREFILTER] OKC Metro bounds: ${JSON.stringify(CONFIG.OKC_METRO_BOUNDS)}`);
  });
}

start().catch(console.error);
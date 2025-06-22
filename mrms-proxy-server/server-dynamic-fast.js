/**
 * Fast MRMS Dynamic Server - Optimized for OKC extraction
 * Uses targeted extraction to minimize processing time
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
 * OPTIMIZED: Extract OKC data with early termination
 * Since OKC data is around line 13.6M, we can optimize by:
 * 1. Skipping the first 13M lines
 * 2. Processing only relevant section
 * 3. Stopping after OKC area is passed
 */
async function extractOKCMetroDataFast(gribPath, date) {
  const reports = [];
  let processedLines = 0;
  let foundOKCStart = false;
  let okpastOKC = false;
  
  return new Promise((resolve, reject) => {
    console.log('[FAST] Starting optimized extraction...');
    
    // Based on our tests, OKC data starts around line 13.6M
    // We'll use a combination of tail and head to extract just that section
    const startLine = 13000000; // Start a bit before OKC
    const linesToRead = 2000000; // Read 2M lines (enough to cover OKC)
    
    // First approach: Use sed to extract specific line range
    const extractCommand = spawn('sh', ['-c', 
      `grib_get_data ${gribPath} | sed -n '${startLine},${startLine + linesToRead}p' | awk 'NR==1 || ($1 >= 35.1 && $1 <= 35.7 && (($2 >= 262.2 && $2 <= 262.9) || ($2 >= -97.8 && $2 <= -97.1)))'`
    ]);
    
    let buffer = '';
    let headerSkipped = false;
    
    extractCommand.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        processedLines++;
        
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Skip header
        if (!headerSkipped) {
          if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
            headerSkipped = true;
            console.log('[FAST] Found header, processing data...');
          }
          continue;
        }
        
        // Parse line
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
          
          // Check if we've found OKC data
          if (!foundOKCStart && lat >= CONFIG.OKC_METRO_BOUNDS.south && lat <= CONFIG.OKC_METRO_BOUNDS.north) {
            foundOKCStart = true;
            console.log('[FAST] Found OKC data starting at processed line', processedLines);
          }
          
          // Check if we've passed OKC
          if (foundOKCStart && lat < CONFIG.OKC_METRO_BOUNDS.south) {
            okpastOKC = true;
            console.log('[FAST] Passed OKC area, terminating early');
            extractCommand.kill();
            return;
          }
          
          // Process OKC data
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
              
              // Log first few for debugging
              if (reports.length <= 3) {
                console.log(`[FAST] Hail report #${reports.length}: ${sizeInches.toFixed(2)}" at ${lat},${adjustedLon}`);
              }
            }
          }
        }
      }
    });
    
    extractCommand.stderr.on('data', (data) => {
      console.error('[FAST] Extract error:', data.toString());
    });
    
    extractCommand.on('close', (code) => {
      if (code !== 0 && !okpastOKC) {
        reject(new Error(`Extract process exited with code ${code}`));
      } else {
        console.log(`[FAST] Extraction complete: ${processedLines} lines processed, ${reports.length} reports found`);
        resolve(reports);
      }
    });
    
    extractCommand.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Alternative: Skip-based extraction
 * Use modulo to sample every Nth line for faster processing
 */
async function extractOKCMetroDataSampled(gribPath, date) {
  console.log('[SAMPLED] Using sampling approach...');
  
  // Since CONUS grid is 7000x3500, and OKC is small area,
  // we can sample to reduce processing time
  const skipFactor = 10; // Process every 10th line
  
  const { stdout } = await execPromise(
    `grib_get_data ${gribPath} | awk 'NR==1 || (NR % ${skipFactor} == 0 && $1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 > 0)'`,
    { maxBuffer: 50 * 1024 * 1024 }
  );
  
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
      const lon = parseFloat(parts[1]) - 360;
      const meshValue = parseFloat(parts[2]);
      const sizeInches = meshValue / 25.4;
      
      if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
        reports.push({
          id: `mesh_${date.getTime()}_${reports.length}`,
          latitude: lat,
          longitude: lon,
          size: Math.round(sizeInches * 100) / 100,
          timestamp: date.toISOString(),
          confidence: calculateConfidence(sizeInches),
          city: getCityName(lat, lon),
          source: 'IEM MRMS Archive',
          meshValue: meshValue
        });
      }
    }
  }
  
  console.log(`[SAMPLED] Found ${reports.length} reports (sampled)`);
  
  // Note: Sampling reduces accuracy but improves speed
  // Multiply report count by skip factor for estimate
  return reports;
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-fast',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    optimization: 'Targeted line extraction (13M-15M)'
  });
});

// Main MESH endpoint with fast extraction
app.get('/api/mesh/:date', async (req, res) => {
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
        console.log('[FAST] Serving from cache');
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      // Cache miss
    }
    
    console.log(`[FAST] Processing request for ${req.params.date}`);
    
    // Download and process
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
    
    // Download
    console.log(`[FAST] Downloading from: ${url}`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    console.log(`[FAST] Download complete`);
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Extract with optimized method
    const startTime = Date.now();
    const reports = await extractOKCMetroDataFast(gribPath, requestedDate);
    const elapsed = Date.now() - startTime;
    
    console.log(`[FAST] Extraction took ${elapsed}ms`);
    
    const data = {
      date: requestedDate.toISOString().split('T')[0],
      source: 'IEM Archive MRMS',
      bounds: CONFIG.OKC_METRO_BOUNDS,
      reports: reports,
      summary: {
        totalReports: reports.length,
        maxSize: reports.length > 0 ? Math.max(...reports.map(r => r.size)) : 0,
        avgSize: reports.length > 0 ? 
          reports.reduce((sum, r) => sum + r.size, 0) / reports.length : 0
      },
      processingTime: elapsed
    };
    
    // Cache results
    await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    res.json(data);
    
  } catch (error) {
    console.error('[FAST] Error:', error);
    res.status(500).json({ 
      error: 'Failed to process MESH data',
      details: error.message 
    });
  }
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
    console.log(`[FAST] MRMS Fast Server running on port ${CONFIG.PORT}`);
    console.log(`[FAST] Optimized for OKC extraction (lines 13M-15M)`);
  });
}

start().catch(console.error);
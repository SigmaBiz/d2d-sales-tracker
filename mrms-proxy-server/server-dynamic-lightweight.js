/**
 * Lightweight MRMS Dynamic Server
 * Designed specifically for Render's 512MB memory constraint
 * Uses streaming and minimal memory footprint
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const { createWriteStream, createReadStream } = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const zlib = require('zlib');

const app = express();
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
  MIN_HAIL_SIZE: 0.75,
  PORT: process.env.PORT || 3002,
  // Memory-saving configurations
  MAX_MEMORY_MB: 400, // Stay well under 512MB limit
  STREAM_HIGHWATER_MARK: 16 * 1024 // 16KB chunks
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Monitor memory usage
function checkMemory(step) {
  const usage = process.memoryUsage();
  const usedMB = Math.round(usage.rss / 1024 / 1024);
  console.log(`[MEMORY] ${step}: ${usedMB}MB used`);
  
  if (usedMB > CONFIG.MAX_MEMORY_MB) {
    console.error(`[MEMORY] WARNING: Exceeding ${CONFIG.MAX_MEMORY_MB}MB limit!`);
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('[MEMORY] Forced garbage collection');
    }
  }
  
  return usedMB;
}

// Stream-based OKC extraction
async function extractOKCDataStreaming(gribPath, date) {
  return new Promise((resolve, reject) => {
    const reports = [];
    checkMemory('extraction_start');
    
    // Use spawn for streaming
    const gribProcess = spawn('grib_get_data', [gribPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Create readline interface for line-by-line processing
    const rl = readline.createInterface({
      input: gribProcess.stdout,
      crlfDelay: Infinity
    });
    
    let lineCount = 0;
    let headerSkipped = false;
    
    rl.on('line', (line) => {
      lineCount++;
      
      // Skip header
      if (!headerSkipped) {
        if (line.includes('Latitude') || line.includes('lat')) {
          headerSkipped = true;
        }
        return;
      }
      
      // Process only every 100th line during initial scan to save memory
      if (lineCount % 100 !== 0) return;
      
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        
        // Check if in OKC bounds (remember GRIB uses 0-360 for longitude)
        if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
            lat <= CONFIG.OKC_METRO_BOUNDS.north &&
            lon >= 262.2 && lon <= 262.9) {
          
          const meshValue = parseFloat(parts[2]);
          const sizeInches = meshValue / 25.4;
          
          if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
            reports.push({
              id: `mesh_${date.getTime()}_${reports.length}`,
              latitude: lat,
              longitude: lon - 360, // Convert to standard coordinates
              size: Math.round(sizeInches * 100) / 100,
              timestamp: date.toISOString(),
              confidence: calculateConfidence(sizeInches),
              city: getCityName(lat, lon - 360),
              source: 'IEM MRMS Archive',
              meshValue: meshValue
            });
          }
        }
      }
      
      // Check memory every million lines
      if (lineCount % 1000000 === 0) {
        checkMemory(`processed_${lineCount}_lines`);
      }
    });
    
    rl.on('close', () => {
      console.log(`[STREAM] Processed ${lineCount} lines, found ${reports.length} reports`);
      checkMemory('extraction_complete');
      resolve(reports);
    });
    
    gribProcess.on('error', reject);
    gribProcess.stderr.on('data', (data) => {
      console.error('[GRIB_ERROR]', data.toString());
    });
  });
}

// Lightweight download with streaming
async function downloadGribFile(url, outputPath) {
  checkMemory('download_start');
  
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MRMS-Processor/1.0)'
    }
  });
  
  const writer = createWriteStream(outputPath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      checkMemory('download_complete');
      resolve();
    });
    writer.on('error', reject);
  });
}

// Decompress with streaming
async function decompressGzip(gzPath, outputPath) {
  checkMemory('decompress_start');
  
  return new Promise((resolve, reject) => {
    const readStream = createReadStream(gzPath);
    const writeStream = createWriteStream(outputPath);
    const gunzip = zlib.createGunzip();
    
    readStream
      .pipe(gunzip)
      .pipe(writeStream)
      .on('finish', () => {
        checkMemory('decompress_complete');
        resolve();
      })
      .on('error', reject);
  });
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const usage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-lightweight',
    memory: {
      used: Math.round(usage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(usage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(usage.rss / 1024 / 1024) + ' MB'
    },
    approach: 'Streaming with minimal memory'
  });
});

// Main MESH endpoint
app.get('/api/mesh/:date', async (req, res) => {
  try {
    const dateMatch = req.params.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    const memStart = checkMemory('request_start');
    
    // Check cache first
    const cacheFile = path.join(CONFIG.CACHE_DIR, `okc_mesh_${req.params.date}.json`);
    try {
      const cached = await fs.readFile(cacheFile, 'utf8');
      console.log('[CACHE] Serving from cache');
      return res.json(JSON.parse(cached));
    } catch (error) {
      // Cache miss - continue
    }
    
    // Build URL
    const requestedDate = new Date(req.params.date + 'T12:00:00Z');
    const utcDate = new Date(requestedDate.toISOString().split('T')[0] + 'T00:00:00Z');
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    
    console.log(`[FETCH] ${url}`);
    
    const fileName = path.basename(url);
    const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
    const gribPath = gzPath.replace('.gz', '');
    
    // Download with streaming
    await downloadGribFile(url, gzPath);
    
    // Decompress with streaming
    await decompressGzip(gzPath, gribPath);
    
    // Delete compressed file immediately to save space
    await fs.unlink(gzPath).catch(() => {});
    
    // Extract OKC data with streaming
    const reports = await extractOKCDataStreaming(gribPath, requestedDate);
    
    // Build response
    const responseData = {
      date: req.params.date,
      generated_at: new Date().toISOString(),
      data_source: 'NOAA MRMS 24-hour Maximum',
      bounds: CONFIG.OKC_METRO_BOUNDS,
      reports: reports,
      summary: {
        totalReports: reports.length,
        maxSize: reports.length > 0 ? Math.max(...reports.map(r => r.size)) : 0,
        avgSize: reports.length > 0 ? 
          reports.reduce((sum, r) => sum + r.size, 0) / reports.length : 0,
        memoryUsed: checkMemory('response_built') + ' MB',
        memoryStart: memStart + ' MB'
      }
    };
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(responseData, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    checkMemory('request_complete');
    res.json(responseData);
    
  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ 
      error: 'Failed to process MESH data',
      details: error.message,
      memory: checkMemory('error_state') + ' MB'
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
    { name: 'Midwest City', lat: 35.4495, lon: -97.3967, radius: 0.08 }
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
  
  const server = app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`[LIGHTWEIGHT] MRMS Dynamic Server running on port ${CONFIG.PORT}`);
    console.log('[LIGHTWEIGHT] Using streaming to minimize memory usage');
    console.log('[LIGHTWEIGHT] Memory limit set to', CONFIG.MAX_MEMORY_MB, 'MB');
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[LIGHTWEIGHT] SIGTERM received, shutting down...');
    server.close(() => {
      console.log('[LIGHTWEIGHT] Server closed');
      process.exit(0);
    });
  });
}

// Start with --expose-gc to allow manual garbage collection
start().catch(console.error);
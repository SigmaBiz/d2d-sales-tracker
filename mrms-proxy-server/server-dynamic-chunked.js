/**
 * Chunked MRMS Dynamic Server for Render
 * Processes GRIB2 data in small chunks to stay within memory limits
 * Uses sed with line ranges instead of tail+head
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

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
  CACHE_DURATION: 24 * 60 * 60 * 1000,
  MIN_HAIL_SIZE: 0.75,
  PORT: process.env.PORT || 3002,
  // Chunked processing config
  OKC_START_LINE: 13400000,
  OKC_END_LINE: 14000000,
  CHUNK_SIZE: 100000  // Process 100k lines at a time
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Extract data in chunks
async function extractOKCMetroDataChunked(gribPath, date) {
  const reports = [];
  const startTime = Date.now();
  
  console.log('[CHUNKED] Processing in chunks of', CONFIG.CHUNK_SIZE, 'lines...');
  
  try {
    // Process in chunks to avoid memory issues
    for (let start = CONFIG.OKC_START_LINE; start < CONFIG.OKC_END_LINE; start += CONFIG.CHUNK_SIZE) {
      const end = Math.min(start + CONFIG.CHUNK_SIZE - 1, CONFIG.OKC_END_LINE);
      
      console.log(`[CHUNKED] Processing lines ${start}-${end}...`);
      
      // Use sed to extract specific line range
      const command = `grib_get_data ${gribPath} | sed -n '${start},${end}p'`;
      
      try {
        const { stdout } = await execPromise(command, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 15000 // 15 second timeout per chunk
        });
        
        const lines = stdout.trim().split('\n');
        let chunkOkcCount = 0;
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            
            // Check if within OKC bounds (GRIB uses 0-360 longitude)
            if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
                lat <= CONFIG.OKC_METRO_BOUNDS.north &&
                lon >= 262.2 && lon <= 262.9) {
              
              chunkOkcCount++;
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
        }
        
        console.log(`[CHUNKED] Found ${chunkOkcCount} OKC points in chunk`);
        
        // Log memory after each chunk
        const memUsage = process.memoryUsage();
        console.log(`[CHUNKED] Memory: RSS=${Math.round(memUsage.rss/1024/1024)}MB`);
        
        // If we found significant data, we can stop early
        if (reports.length > 100) {
          console.log('[CHUNKED] Found sufficient data, stopping early');
          break;
        }
        
      } catch (chunkError) {
        console.error(`[CHUNKED] Error processing chunk ${start}-${end}:`, chunkError.message);
        // Continue with next chunk
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[CHUNKED] Found ${reports.length} hail reports in ${elapsed}ms`);
    
    return reports;
    
  } catch (error) {
    console.error('[CHUNKED] Error extracting data:', error);
    throw error;
  }
}

// Alternative: Use awk with buffered output
async function extractOKCMetroDataAwk(gribPath, date) {
  const reports = [];
  const startTime = Date.now();
  
  console.log('[AWK] Using awk with OKC bounds filter...');
  
  try {
    // Use awk to filter OKC data directly, with line number range
    const command = `grib_get_data ${gribPath} | awk 'NR >= ${CONFIG.OKC_START_LINE} && NR <= ${CONFIG.OKC_END_LINE} && $1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9'`;
    
    const { stdout } = await execPromise(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      timeout: 30000 // 30 second timeout
    });
    
    const lines = stdout.trim().split('\n');
    console.log(`[AWK] Found ${lines.length} OKC data points`);
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
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
    
    const elapsed = Date.now() - startTime;
    console.log(`[AWK] Found ${reports.length} hail reports in ${elapsed}ms`);
    
    return reports;
    
  } catch (error) {
    console.error('[AWK] Error with awk approach:', error);
    // Fallback to chunked approach
    return extractOKCMetroDataChunked(gribPath, date);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-chunked',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    approach: 'Chunked processing with sed/awk',
    chunkSize: CONFIG.CHUNK_SIZE
  });
});

// Main MESH endpoint
app.get('/api/mesh/:date', async (req, res) => {
  try {
    const dateMatch = req.params.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    const requestedDate = new Date(req.params.date + 'T12:00:00Z');
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    
    // Check cache first
    const cacheFile = path.join(CONFIG.CACHE_DIR, `okc_mesh_${req.params.date}.json`);
    try {
      const stats = await fs.stat(cacheFile);
      if (Date.now() - stats.mtime.getTime() < CONFIG.CACHE_DURATION) {
        console.log('[CACHE] Serving from cache');
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
    
    console.log(`[FETCH] Downloading ${url}`);
    
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
        'User-Agent': 'Mozilla/5.0 (compatible; MRMS-Processor/1.0)'
      }
    });
    
    const writer = createWriteStream(gzPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    
    console.log('[EXTRACT] Decompressing GZIP...');
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Try awk approach first, fallback to chunked
    const reports = await extractOKCMetroDataAwk(gribPath, requestedDate);
    
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
        extraction: 'chunked/awk processing',
        chunkSize: CONFIG.CHUNK_SIZE
      }
    };
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(responseData, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    // Log final memory state
    const memUsage = process.memoryUsage();
    console.log(`[COMPLETE] Memory: RSS=${Math.round(memUsage.rss/1024/1024)}MB`);
    
    res.json(responseData);
    
  } catch (error) {
    console.error('[ERROR] Processing failed:', error);
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
    { name: 'Del City', lat: 35.4420, lon: -97.4409, radius: 0.05 },
    { name: 'Bethany', lat: 35.5186, lon: -97.6322, radius: 0.05 },
    { name: 'Warr Acres', lat: 35.5225, lon: -97.6189, radius: 0.04 },
    { name: 'Newcastle', lat: 35.2473, lon: -97.5997, radius: 0.06 },
    { name: 'Mustang', lat: 35.3842, lon: -97.7244, radius: 0.06 },
    { name: 'Yukon', lat: 35.5067, lon: -97.7625, radius: 0.08 }
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
    console.log(`[CHUNKED] MRMS Dynamic Server running on port ${CONFIG.PORT}`);
    console.log('[CHUNKED] Using chunked processing to minimize memory');
    console.log('[CHUNKED] Processing in', CONFIG.CHUNK_SIZE, 'line chunks');
    console.log('[CHUNKED] Optimized for 512MB memory constraint');
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[CHUNKED] SIGTERM received, shutting down...');
    server.close(() => {
      console.log('[CHUNKED] Server closed');
      process.exit(0);
    });
  });
}

start().catch(console.error);
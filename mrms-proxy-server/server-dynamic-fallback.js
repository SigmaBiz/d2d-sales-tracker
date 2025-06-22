/**
 * Fallback MRMS Dynamic Server for Render
 * Uses geographic filtering with ecCodes instead of line-based extraction
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

// Extract data using geographic bounds with ecCodes
async function extractOKCMetroDataGeographic(gribPath, date) {
  const reports = [];
  const startTime = Date.now();
  
  try {
    console.log('[FALLBACK] Using geographic filtering with ecCodes...');
    
    // Use grib_filter to extract only OKC area data
    const filterRules = `
      if (latitude >= ${CONFIG.OKC_METRO_BOUNDS.south} && 
          latitude <= ${CONFIG.OKC_METRO_BOUNDS.north} && 
          longitude >= ${360 + CONFIG.OKC_METRO_BOUNDS.west} && 
          longitude <= ${360 + CONFIG.OKC_METRO_BOUNDS.east}) {
        print "[lat] [latitude] [lon] [longitude] [value] [parameterName]";
      }
    `.replace(/\n/g, ' ');
    
    // Write filter rules to temp file
    const filterFile = path.join(CONFIG.TEMP_DIR, 'okc_filter.txt');
    await fs.writeFile(filterFile, filterRules);
    
    // Run grib_filter
    const { stdout, stderr } = await execPromise(
      `grib_filter ${filterFile} ${gribPath}`,
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );
    
    if (stderr) {
      console.log('[FALLBACK] Filter stderr:', stderr);
    }
    
    // Parse output
    const lines = stdout.trim().split('\n');
    console.log(`[FALLBACK] Extracted ${lines.length} data points`);
    
    for (const line of lines) {
      const match = line.match(/\[lat\]\s+([\d.-]+)\s+\[lon\]\s+([\d.-]+)\s+\[value\]\s+([\d.-]+)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]) - 360; // Convert from 0-360 to -180-180
        const meshValue = parseFloat(match[3]);
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
    
    // Cleanup filter file
    await fs.unlink(filterFile).catch(() => {});
    
    const elapsed = Date.now() - startTime;
    console.log(`[FALLBACK] Found ${reports.length} reports in ${elapsed}ms`);
    
    return reports;
    
  } catch (error) {
    console.error('[FALLBACK] Error with geographic filtering:', error);
    
    // Try alternative approach with grib_get_data and smaller chunks
    console.log('[FALLBACK] Trying chunked approach...');
    return extractOKCMetroDataChunked(gribPath, date);
  }
}

// Alternative: Process in smaller chunks
async function extractOKCMetroDataChunked(gribPath, date) {
  const reports = [];
  
  try {
    // First get the total number of data points
    const { stdout: countOut } = await execPromise(
      `grib_get_data ${gribPath} | wc -l`,
      { timeout: 10000 }
    );
    
    const totalLines = parseInt(countOut.trim()) - 1; // Subtract header
    console.log(`[FALLBACK] Total data points: ${totalLines}`);
    
    // Process in chunks of 1 million lines
    const chunkSize = 1000000;
    const startLine = 13000000; // Start closer to OKC data
    const endLine = Math.min(startLine + 2000000, totalLines); // Process 2M lines max
    
    for (let i = startLine; i < endLine; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, endLine);
      console.log(`[FALLBACK] Processing chunk ${i}-${chunkEnd}...`);
      
      const { stdout } = await execPromise(
        `grib_get_data ${gribPath} | sed -n '1p;${i},${chunkEnd}p' | awk 'NR==1 || ($1 >= ${CONFIG.OKC_METRO_BOUNDS.south} && $1 <= ${CONFIG.OKC_METRO_BOUNDS.north} && $2 >= ${CONFIG.OKC_METRO_BOUNDS.west} && $2 <= ${CONFIG.OKC_METRO_BOUNDS.east})'`,
        { maxBuffer: 50 * 1024 * 1024, timeout: 20000 }
      );
      
      const lines = stdout.trim().split('\n');
      for (let j = 1; j < lines.length; j++) {
        const parts = lines[j].trim().split(/\s+/);
        if (parts.length >= 3) {
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]);
          const meshValue = parseFloat(parts[2]);
          const sizeInches = meshValue / 25.4;
          
          if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
            reports.push({
              id: `mesh_${date.getTime()}_${reports.length}`,
              latitude: lat,
              longitude: lon < -180 ? lon + 360 : lon,
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
      
      // If we found data, we can stop
      if (reports.length > 100) {
        console.log('[FALLBACK] Found sufficient data, stopping chunk processing');
        break;
      }
    }
    
    return reports;
    
  } catch (error) {
    console.error('[FALLBACK] Chunked approach also failed:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-dynamic-server-fallback',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    approach: 'Geographic filtering with ecCodes'
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
        console.log('[FALLBACK] Serving from cache');
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
    
    console.log(`[FALLBACK] Fetching ${url}`);
    
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
    
    // Extract GZIP
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Extract OKC Metro data
    const reports = await extractOKCMetroDataGeographic(gribPath, requestedDate);
    
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
          reports.reduce((sum, r) => sum + r.size, 0) / reports.length : 0
      }
    };
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(responseData, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    res.json(responseData);
    
  } catch (error) {
    console.error('[FALLBACK] Error processing request:', error);
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
    console.log(`[FALLBACK] MRMS Dynamic Server (Fallback) running on port ${CONFIG.PORT}`);
    console.log('[FALLBACK] Using geographic filtering with ecCodes');
    console.log('[FALLBACK] Coverage: OKC Metro area only');
    console.log('[FALLBACK] Date range: Last 12 months');
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[FALLBACK] SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('[FALLBACK] Server closed');
      process.exit(0);
    });
  });
}

start().catch(console.error);
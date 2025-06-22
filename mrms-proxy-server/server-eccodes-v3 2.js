/**
 * MRMS GRIB2 Processing Server using ecCodes V3
 * Optimized for OKC Metro area processing
 * Uses streaming approach to handle large GRIB2 files
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
const readline = require('readline');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // IEM Archive base URL
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  
  // OKC Metro bounds - includes entire metropolitan area
  // Norman in the south to Edmond in the north
  // Yukon in the west to Midwest City in the east
  OKC_METRO_BOUNDS: {
    north: 35.7,    // North of Edmond
    south: 35.1,    // South of Norman
    east: -97.1,    // East of Midwest City
    west: -97.8     // West of Yukon
  },
  
  // Minimum hail size to include (inches)
  MIN_HAIL_SIZE: 1.25,
  
  // Cache settings
  CACHE_DIR: path.join(__dirname, 'cache'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  
  // Processing settings
  // For MESH_Max_1440min (24-hour max), we need to check the NEXT day's 00:00 UTC file
  // which contains the maximum hail size from the previous 24 hours
  USE_NEXT_DAY_FOR_24HR_MAX: true
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
    console.error('[GRIB2] ecCodes not found. Install with:');
    console.error('[GRIB2] Mac: brew install eccodes');
    console.error('[GRIB2] Ubuntu: apt-get install libeccodes-tools');
    return false;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  const hasEccodes = await checkEccodes();
  res.json({ 
    status: 'ok', 
    service: 'mrms-eccodes-server-v3',
    eccodes: hasEccodes ? 'installed' : 'missing'
  });
});

/**
 * Main endpoint - Get MESH data for a specific date
 */
app.get('/api/mesh/:date', async (req, res) => {
  const { date } = req.params;
  
  try {
    console.log(`[GRIB2] Processing request for ${date}`);
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Check cache first
    const cacheFile = path.join(CONFIG.CACHE_DIR, `${date}_mesh.json`);
    if (fsSync.existsSync(cacheFile)) {
      console.log(`[GRIB2] Returning cached data for ${date}`);
      const cachedData = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      return res.json(cachedData);
    }
    
    // Process GRIB2 data
    const meshData = await processDateMESH(date);
    
    // Cache the results
    if (meshData.reports.length > 0) {
      await fs.writeFile(cacheFile, JSON.stringify(meshData));
    }
    
    res.json(meshData);
    
  } catch (error) {
    console.error(`[GRIB2] Error processing ${date}:`, error);
    res.status(500).json({ 
      error: 'Failed to process MESH data',
      details: error.message 
    });
  }
});

/**
 * Process MESH data for a specific date
 */
async function processDateMESH(date) {
  const [year, month, day] = date.split('-');
  
  // Check if eccodes is available
  const hasEccodes = await checkEccodes();
  if (!hasEccodes) {
    throw new Error('ecCodes not installed');
  }
  
  // For MESH_Max_1440min (24-hour maximum), we need to get the NEXT day's 00:00 UTC file
  // which contains the maximum hail size from the previous 24 hours ending at that time
  const targetDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  targetDate.setDate(targetDate.getDate() + 1); // Add one day
  
  const nextYear = targetDate.getFullYear();
  const nextMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
  const nextDay = String(targetDate.getDate()).padStart(2, '0');
  
  console.log(`[GRIB2] Processing ${date} using next day's 24hr max file...`);
  
  try {
    const reports = await process24HourMaxMESH(nextYear, nextMonth, nextDay, date);
    
    console.log(`[GRIB2] Processed ${reports.length} reports for ${date}`);
    
    return {
      date,
      reports: reports,
      source: 'IEM MRMS Archive (24hr Max)',
      dataFile: `${nextYear}-${nextMonth}-${nextDay} 00:00 UTC`,
      bounds: CONFIG.OKC_METRO_BOUNDS
    };
  } catch (error) {
    console.error(`[GRIB2] Error processing ${date}:`, error.message);
    return {
      date,
      reports: [],
      source: 'IEM MRMS Archive',
      error: error.message,
      bounds: CONFIG.OKC_METRO_BOUNDS
    };
  }
}

/**
 * Process 24-hour maximum MESH data
 */
async function process24HourMaxMESH(year, month, day, originalDate) {
  // For 24-hour max, we get the 00:00 UTC file
  const dateTimeStr = `${year}${month}${day}-000000`;
  
  // Construct the URL for MESH data
  const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${dateTimeStr}.grib2.gz`;
  
  console.log(`[GRIB2] Fetching ${url}`);
  
  // Download gzipped GRIB2 file
  const gzPath = path.join(CONFIG.TEMP_DIR, `MESH_${dateTimeStr}.grib2.gz`);
  const gribPath = path.join(CONFIG.TEMP_DIR, `MESH_${dateTimeStr}.grib2`);
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'MRMS-Proxy/1.0'
      }
    });
    
    // Save to disk
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    
    // Decompress the file
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Process GRIB2 to get data using streaming approach
    const meshData = await processMESHGrib2WithEccodesStream(gribPath, originalDate, '24hr');
    
    return meshData;
    
  } finally {
    // Cleanup
    await cleanupTempFiles(gribPath, gzPath);
  }
}

/**
 * Process MESH GRIB2 file using ecCodes with streaming to handle large files
 */
async function processMESHGrib2WithEccodesStream(gribPath, date, hour) {
  return new Promise((resolve, reject) => {
    const reports = [];
    
    // Use grib_get_data as a spawned process to stream the output
    const gribProcess = spawn('grib_get_data', [gribPath]);
    
    const rl = readline.createInterface({
      input: gribProcess.stdout,
      crlfDelay: Infinity
    });
    
    let headerSkipped = false;
    let processedLines = 0;
    
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      
      // Skip header line
      if (!headerSkipped) {
        if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
          headerSkipped = true;
        }
        return;
      }
      
      processedLines++;
      if (processedLines % 100000 === 0) {
        console.log(`[GRIB2] Processed ${processedLines} lines...`);
      }
      
      // Parse data line: latitude longitude value
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        const meshValue = parseFloat(parts[2]); // MESH in mm
        
        if (isNaN(lat) || isNaN(lon) || isNaN(meshValue)) return;
        
        // Quick bounds check before conversion
        if (lat < CONFIG.OKC_METRO_BOUNDS.south || 
            lat > CONFIG.OKC_METRO_BOUNDS.north ||
            lon < CONFIG.OKC_METRO_BOUNDS.west || 
            lon > CONFIG.OKC_METRO_BOUNDS.east) {
          return;
        }
        
        const meshInches = meshValue / 25.4;
        
        // Check minimum size
        if (meshInches >= CONFIG.MIN_HAIL_SIZE) {
          reports.push({
            id: `mesh_${date}_${hour}_${reports.length}`,
            latitude: lat,
            longitude: lon,
            size: meshInches,
            meshValue: meshValue,
            timestamp: new Date(`${date}T${hour}:00:00Z`),
            confidence: calculateConfidence(meshInches),
            city: getClosestCity(lat, lon),
            isMetroOKC: true,
            source: 'IEM MRMS Archive'
          });
        }
      }
    });
    
    rl.on('close', () => {
      console.log(`[GRIB2] Extracted ${reports.length} significant hail reports from ${processedLines} total lines`);
      resolve(reports);
    });
    
    gribProcess.stderr.on('data', (data) => {
      console.error(`[GRIB2] Error:`, data.toString());
    });
    
    gribProcess.on('error', (error) => {
      reject(error);
    });
    
    gribProcess.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`grib_get_data exited with code ${code}`));
      }
    });
  });
}

/**
 * Calculate confidence based on MESH size
 */
function calculateConfidence(sizeInches) {
  if (sizeInches >= 2.5) return 95;
  if (sizeInches >= 2.0) return 90;
  if (sizeInches >= 1.5) return 85;
  return 80;
}

/**
 * Get closest city for coordinates
 */
function getClosestCity(lat, lon) {
  const cities = [
    { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164 },
    { name: 'Norman', lat: 35.2226, lon: -97.4395 },
    { name: 'Moore', lat: 35.3395, lon: -97.4867 },
    { name: 'Edmond', lat: 35.6528, lon: -97.4781 },
    { name: 'Newcastle', lat: 35.3053, lon: -97.4766 },
    { name: 'Midwest City', lat: 35.4934, lon: -97.2891 }
  ];
  
  let closest = cities[0];
  let minDistance = Infinity;
  
  for (const city of cities) {
    const distance = Math.sqrt(
      Math.pow(lat - city.lat, 2) + 
      Math.pow(lon - city.lon, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = city;
    }
  }
  
  return closest.name;
}

/**
 * Cleanup temporary files
 */
async function cleanupTempFiles(...files) {
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get available dates with significant hail
 */
app.get('/api/mesh/available-dates', async (req, res) => {
  try {
    const cacheFiles = await fs.readdir(CONFIG.CACHE_DIR);
    const dates = cacheFiles
      .filter(f => f.endsWith('_mesh.json'))
      .map(f => f.replace('_mesh.json', ''))
      .sort()
      .reverse();
    
    res.json({ dates });
  } catch (error) {
    res.json({ dates: [] });
  }
});

// Initialize and start server
async function start() {
  await ensureDirectories();
  
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log(`[GRIB2] ecCodes Server V3 running on port ${PORT}`);
    console.log(`[GRIB2] Health check: http://localhost:${PORT}/health`);
    console.log(`[GRIB2] Example: http://localhost:${PORT}/api/mesh/2024-09-24`);
  });
}

start().catch(console.error);
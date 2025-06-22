/**
 * MRMS GRIB2 Processing Server using ecCodes V2
 * Updated to use correct IEM Archive URL structure
 * Processes real NOAA MRMS data from mtarchive.geol.iastate.edu
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { pipeline } = require('stream/promises');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // IEM Archive base URL - updated to correct mtarchive URL
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  
  // OKC Metro bounds (tighter for better performance)
  OKC_METRO_BOUNDS: {
    north: 35.7,
    south: 35.2,
    east: -97.1,
    west: -97.7
  },
  
  // Minimum hail size to include (inches)
  MIN_HAIL_SIZE: 1.25,
  
  // Cache settings
  CACHE_DIR: path.join(__dirname, 'cache'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  
  // Processing settings
  PEAK_HOURS: [18, 19, 20, 21, 22, 23], // 1 PM - 6 PM CDT
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
    service: 'mrms-eccodes-server-v2',
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
  const allReports = [];
  const processedHours = [];
  
  // Check if eccodes is available
  const hasEccodes = await checkEccodes();
  if (!hasEccodes) {
    throw new Error('ecCodes not installed');
  }
  
  // Process each peak hour
  for (const hour of CONFIG.PEAK_HOURS) {
    try {
      const hourStr = String(hour).padStart(2, '0');
      console.log(`[GRIB2] Processing ${date} hour ${hourStr}...`);
      
      const reports = await processHourMESH(year, month, day, hourStr);
      if (reports.length > 0) {
        allReports.push(...reports);
        processedHours.push(hourStr);
      }
    } catch (error) {
      console.log(`[GRIB2] Skipping hour ${hour}: ${error.message}`);
    }
  }
  
  console.log(`[GRIB2] Processed ${allReports.length} reports from ${processedHours.length} hours`);
  
  return {
    date,
    reports: allReports,
    source: 'IEM MRMS Archive',
    processedHours,
    bounds: CONFIG.OKC_METRO_BOUNDS
  };
}

/**
 * Process MESH data for a specific hour
 */
async function processHourMESH(year, month, day, hour) {
  // IEM Archive stores MESH_Max_1440min files every 30 minutes
  // We'll get the file closest to the hour
  const minute = '00';
  const dateTimeStr = `${year}${month}${day}-${hour}${minute}00`;
  
  // Construct the correct URL for MESH data
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
    
    // Process GRIB2 to get data
    const meshData = await processMESHGrib2WithEccodes(gribPath, `${year}-${month}-${day}`, hour);
    
    return meshData;
    
  } finally {
    // Cleanup
    await cleanupTempFiles(gribPath, gzPath);
  }
}

/**
 * Process MESH GRIB2 file using ecCodes to extract hail data
 */
async function processMESHGrib2WithEccodes(gribPath, date, hour) {
  const reports = [];
  
  // First, get the grid info using grib_dump to understand the data structure
  const dumpCmd = `grib_dump -O ${gribPath} | grep -E "shortName|Ni|Nj|latitudeOfFirstGridPoint|longitudeOfFirstGridPoint|latitudeOfLastGridPoint|longitudeOfLastGridPoint|iDirectionIncrement|jDirectionIncrement" | head -20`;
  console.log(`[GRIB2] Getting grid info...`);
  
  try {
    const { stdout: gridInfo } = await execPromise(dumpCmd);
    console.log(`[GRIB2] Grid info:`, gridInfo);
  } catch (error) {
    console.log(`[GRIB2] Could not get grid info:`, error.message);
  }
  
  // Extract data using grib_get_data with a bounding box to reduce output size
  // First, let's use grib_ls to extract just the subset we need
  // The -p option specifies which keys to print, -w filters by area
  const latMin = CONFIG.OKC_METRO_BOUNDS.south;
  const latMax = CONFIG.OKC_METRO_BOUNDS.north;
  const lonMin = CONFIG.OKC_METRO_BOUNDS.west + 360; // Convert to 0-360 range
  const lonMax = CONFIG.OKC_METRO_BOUNDS.east + 360; // Convert to 0-360 range
  
  // Use grib_copy to extract a subset first, then get data
  const subsetPath = gribPath.replace('.grib2', '_subset.grib2');
  const copyCmd = `grib_copy -w "latitudeOfFirstGridPointInDegrees<=${latMax},latitudeOfLastGridPointInDegrees>=${latMin}" ${gribPath} ${subsetPath} 2>/dev/null || cp ${gribPath} ${subsetPath}`;
  
  console.log(`[GRIB2] Creating geographic subset for OKC Metro...`);
  await execPromise(copyCmd);
  
  // Now extract data from the subset (or full file if subset failed)
  const dataCmd = `grib_get_data ${subsetPath}`;
  
  console.log(`[GRIB2] Extracting MESH data...`);
  const { stdout } = await execPromise(dataCmd, { maxBuffer: 200 * 1024 * 1024 }); // 200MB buffer
  
  // Clean up subset file
  await cleanupTempFiles(subsetPath);
  
  // Parse the output
  const lines = stdout.split('\n');
  let headerSkipped = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Skip header line
    if (!headerSkipped) {
      if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
        headerSkipped = true;
      }
      continue;
    }
    
    // Parse data line: latitude longitude value
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      const meshValue = parseFloat(parts[2]); // MESH in mm
      
      if (isNaN(lat) || isNaN(lon) || isNaN(meshValue)) continue;
      
      const meshInches = meshValue / 25.4;
      
      // Filter by bounds and minimum size
      if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
          lat <= CONFIG.OKC_METRO_BOUNDS.north &&
          lon >= CONFIG.OKC_METRO_BOUNDS.west && 
          lon <= CONFIG.OKC_METRO_BOUNDS.east &&
          meshInches >= CONFIG.MIN_HAIL_SIZE) {
        
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
  }
  
  console.log(`[GRIB2] Extracted ${reports.length} significant hail reports`);
  return reports;
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
    console.log(`[GRIB2] ecCodes Server V2 running on port ${PORT}`);
    console.log(`[GRIB2] Health check: http://localhost:${PORT}/health`);
    console.log(`[GRIB2] Example: http://localhost:${PORT}/api/mesh/2024-09-24`);
  });
}

start().catch(console.error);
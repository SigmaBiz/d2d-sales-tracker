/**
 * MRMS GRIB2 Processing Server
 * Fetches and processes real NOAA MRMS data from IEM Archive
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
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // IEM Archive base URL
  IEM_BASE_URL: 'https://mrms.agron.iastate.edu',
  
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
 * Check if wgrib2 is installed
 */
async function checkWgrib2() {
  try {
    await execPromise('which wgrib2');
    return true;
  } catch (error) {
    console.error('[GRIB2] wgrib2 not found. Install with:');
    console.error('[GRIB2] Mac: brew install wgrib2');
    console.error('[GRIB2] Ubuntu: apt-get install grib-api-tools');
    return false;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', async (req, res) => {
  const hasWgrib2 = await checkWgrib2();
  res.json({ 
    status: 'ok', 
    service: 'mrms-grib2-server',
    wgrib2: hasWgrib2 ? 'installed' : 'missing'
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
  
  // Check if wgrib2 is available
  const hasWgrib2 = await checkWgrib2();
  if (!hasWgrib2) {
    throw new Error('wgrib2 not installed');
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
  const timestamp = `${year}${month}${day}${hour}00`;
  const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/${hour}/${timestamp}.zip`;
  
  console.log(`[GRIB2] Fetching ${url}`);
  
  // Download zip file
  const zipPath = path.join(CONFIG.TEMP_DIR, `${timestamp}.zip`);
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
  await pipeline(response.data, fsSync.createWriteStream(zipPath));
  
  try {
    // Extract MESH file
    const meshFile = await extractMESHFile(zipPath, timestamp);
    if (!meshFile) {
      throw new Error('No MESH file found in archive');
    }
    
    // Process GRIB2 to JSON
    const meshData = await processMESHGrib2(meshFile, `${year}-${month}-${day}`, hour);
    
    return meshData;
    
  } finally {
    // Cleanup
    await cleanupTempFiles(timestamp);
  }
}

/**
 * Extract MESH file from zip archive
 */
async function extractMESHFile(zipPath, timestamp) {
  const extractDir = path.join(CONFIG.TEMP_DIR, timestamp);
  await fs.mkdir(extractDir, { recursive: true });
  
  // Unzip
  await execPromise(`unzip -o ${zipPath} -d ${extractDir}`);
  
  // Find MESH file (usually MESH_Max_1440min.grib2)
  const files = await fs.readdir(extractDir);
  const meshFile = files.find(f => 
    f.includes('MESH') && 
    f.includes('Max') && 
    f.endsWith('.grib2')
  );
  
  if (meshFile) {
    return path.join(extractDir, meshFile);
  }
  
  return null;
}

/**
 * Process MESH GRIB2 file to extract hail data
 */
async function processMESHGrib2(gribPath, date, hour) {
  const reports = [];
  
  // Convert GRIB2 to JSON using wgrib2
  const jsonPath = gribPath.replace('.grib2', '.json');
  
  // Extract MESH data for OKC bounds
  const wgribCmd = `wgrib2 ${gribPath} -match "MESH" -lon ${CONFIG.OKC_METRO_BOUNDS.west} ${CONFIG.OKC_METRO_BOUNDS.east} -lat ${CONFIG.OKC_METRO_BOUNDS.south} ${CONFIG.OKC_METRO_BOUNDS.north} -json ${jsonPath}`;
  
  console.log(`[GRIB2] Running: ${wgribCmd}`);
  await execPromise(wgribCmd);
  
  // Read and parse JSON
  const jsonData = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  
  // Process each data point
  if (jsonData && jsonData.length > 0) {
    const meshData = jsonData[0];
    const { data, lat, lon } = meshData;
    
    // Convert grid data to reports
    for (let i = 0; i < data.length; i++) {
      const meshValue = data[i]; // MESH in mm
      const meshInches = meshValue / 25.4;
      
      // Only include significant hail
      if (meshInches >= CONFIG.MIN_HAIL_SIZE) {
        const latitude = lat[i];
        const longitude = lon[i];
        
        // Verify within bounds
        if (latitude >= CONFIG.OKC_METRO_BOUNDS.south && 
            latitude <= CONFIG.OKC_METRO_BOUNDS.north &&
            longitude >= CONFIG.OKC_METRO_BOUNDS.west && 
            longitude <= CONFIG.OKC_METRO_BOUNDS.east) {
          
          reports.push({
            id: `mesh_${date}_${hour}_${i}`,
            latitude,
            longitude,
            size: meshInches,
            meshValue: meshValue,
            timestamp: new Date(`${date}T${hour}:00:00Z`),
            confidence: calculateConfidence(meshInches),
            city: getClosestCity(latitude, longitude),
            isMetroOKC: true,
            source: 'IEM MRMS Archive'
          });
        }
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
async function cleanupTempFiles(timestamp) {
  try {
    const tempFiles = [
      path.join(CONFIG.TEMP_DIR, `${timestamp}.zip`),
      path.join(CONFIG.TEMP_DIR, timestamp)
    ];
    
    for (const file of tempFiles) {
      await fs.rm(file, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore cleanup errors
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
    console.log(`[GRIB2] Server running on port ${PORT}`);
    console.log(`[GRIB2] Health check: http://localhost:${PORT}/health`);
    console.log(`[GRIB2] Example: http://localhost:${PORT}/api/mesh/2024-09-24`);
  });
}

start().catch(console.error);
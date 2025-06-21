/**
 * Dynamic MRMS Proxy Server
 * Fetches real MRMS data for any date in the last 12 months
 * Focuses on OKC Metro area only
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
    console.error('ecCodes not found. Install with: brew install eccodes');
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
    service: 'mrms-dynamic-server',
    eccodes: hasEccodes ? 'installed' : 'missing',
    bounds: CONFIG.OKC_METRO_BOUNDS,
    capabilities: {
      dateRange: 'Last 12 months',
      dataType: 'MESH 24-hour maximum',
      coverage: 'OKC Metro only'
    }
  });
});

/**
 * Get MESH data for a specific date
 */
app.get('/api/mesh/:date', async (req, res) => {
  try {
    const requestedDate = new Date(req.params.date);
    const now = new Date();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    // Validate date is within last 12 months
    if (requestedDate < twelveMonthsAgo || requestedDate > now) {
      return res.status(400).json({ 
        error: 'Date must be within the last 12 months',
        minDate: twelveMonthsAgo.toISOString().split('T')[0],
        maxDate: now.toISOString().split('T')[0]
      });
    }
    
    console.log(`[DYNAMIC] Processing request for ${req.params.date}`);
    
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
      // Cache miss, continue to fetch
    }
    
    // Fetch and process GRIB2 data
    const data = await fetchAndProcessMESH(requestedDate);
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    
    res.json(data);
    
  } catch (error) {
    console.error('[DYNAMIC] Error processing request:', error);
    res.status(500).json({ 
      error: 'Failed to process MESH data',
      details: error.message 
    });
  }
});

/**
 * Get MESH data for a date range (up to 30 days)
 */
app.get('/api/mesh/range/:startDate/:endDate', async (req, res) => {
  try {
    const startDate = new Date(req.params.startDate);
    const endDate = new Date(req.params.endDate);
    
    // Validate date range
    const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
    if (daysDiff > 30) {
      return res.status(400).json({ 
        error: 'Date range cannot exceed 30 days for performance reasons'
      });
    }
    
    const results = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      try {
        const dateStr = currentDate.toISOString().split('T')[0];
        const data = await fetchAndProcessMESH(currentDate);
        if (data.reports && data.reports.length > 0) {
          results.push({
            date: dateStr,
            reportCount: data.reports.length,
            maxSize: Math.max(...data.reports.map(r => r.size)),
            reports: data.reports
          });
        }
      } catch (error) {
        console.error(`[DYNAMIC] Error processing ${currentDate}:`, error);
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    res.json({
      startDate: req.params.startDate,
      endDate: req.params.endDate,
      daysWithHail: results.length,
      storms: results
    });
    
  } catch (error) {
    console.error('[DYNAMIC] Error processing range request:', error);
    res.status(500).json({ 
      error: 'Failed to process date range',
      details: error.message 
    });
  }
});

/**
 * Get available dates with significant hail in the last 12 months
 */
app.get('/api/mesh/available', async (req, res) => {
  try {
    // For performance, return known significant dates
    // In production, this could query a database of processed dates
    const knownSignificantDates = [
      { date: '2024-09-24', description: 'Major OKC storm, tennis ball hail' },
      { date: '2024-05-15', description: 'Moore/Norman storm system' },
      { date: '2024-04-27', description: 'Edmond hail event' },
      { date: '2023-06-14', description: 'Metro-wide storm' },
      { date: '2023-05-02', description: 'Yukon/Mustang hail' }
    ];
    
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const availableDates = knownSignificantDates.filter(item => {
      const date = new Date(item.date);
      return date >= twelveMonthsAgo;
    });
    
    res.json({
      availableDates,
      dataRange: {
        start: twelveMonthsAgo.toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0]
      },
      note: 'Any date within the last 12 months can be queried'
    });
    
  } catch (error) {
    console.error('[DYNAMIC] Error getting available dates:', error);
    res.status(500).json({ error: 'Failed to get available dates' });
  }
});

/**
 * Fetch and process MESH data for a specific date
 */
async function fetchAndProcessMESH(date) {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  
  const year = nextDay.getFullYear();
  const month = String(nextDay.getMonth() + 1).padStart(2, '0');
  const day = String(nextDay.getDate()).padStart(2, '0');
  
  // MESH_Max_1440min contains 24-hour maximum
  const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
  
  console.log(`[DYNAMIC] Fetching ${url}`);
  
  const fileName = path.basename(url);
  const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
  const gribPath = gzPath.replace('.gz', '');
  
  try {
    // Check if ecCodes is available
    const hasEccodes = await checkEccodes();
    if (!hasEccodes) {
      throw new Error('ecCodes not installed. Cannot process GRIB2 files.');
    }
    
    // Download file
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    
    // Decompress
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Process with ecCodes
    const reports = await extractOKCMetroData(gribPath, date);
    
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
    try {
      await fs.unlink(gribPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract MESH data for OKC Metro area only
 */
async function extractOKCMetroData(gribPath, date) {
  try {
    console.log('[DYNAMIC] Extracting OKC Metro data...');
    
    // Use grib_get_data to extract values
    const { stdout } = await execPromise(`grib_get_data ${gribPath}`, {
      maxBuffer: 200 * 1024 * 1024 // 200MB buffer for CONUS grid
    });
    
    const reports = [];
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
      
      // Parse: latitude longitude value
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]) - 360; // Convert from 0-360 to -180-180
        const meshValue = parseFloat(parts[2]); // in mm
        
        // Skip invalid or zero values
        if (isNaN(lat) || isNaN(lon) || isNaN(meshValue) || meshValue <= 0) {
          continue;
        }
        
        // Check if in OKC Metro bounds
        if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
            lat <= CONFIG.OKC_METRO_BOUNDS.north &&
            lon >= CONFIG.OKC_METRO_BOUNDS.west && 
            lon <= CONFIG.OKC_METRO_BOUNDS.east) {
          
          const sizeInches = meshValue / 25.4;
          
          // Only include significant hail
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
    }
    
    console.log(`[DYNAMIC] Found ${reports.length} hail reports in OKC Metro`);
    return reports;
    
  } catch (error) {
    console.error('[DYNAMIC] Error extracting data:', error);
    return [];
  }
}

/**
 * Calculate confidence score based on hail size
 */
function calculateConfidence(sizeInches) {
  if (sizeInches >= 2.0) return 95;      // Golf ball or larger
  if (sizeInches >= 1.5) return 90;      // Ping pong ball
  if (sizeInches >= 1.25) return 85;     // Half dollar
  if (sizeInches >= 1.0) return 80;      // Quarter
  return 75;                              // Smaller hail
}

/**
 * Get approximate city name based on coordinates
 */
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

// Initialize server
async function start() {
  await ensureDirectories();
  
  app.listen(CONFIG.PORT, () => {
    console.log(`[DYNAMIC] MRMS Dynamic Server running on port ${CONFIG.PORT}`);
    console.log(`[DYNAMIC] Coverage: OKC Metro area only`);
    console.log(`[DYNAMIC] Date range: Last 12 months`);
    console.log(`[DYNAMIC] Endpoints:`);
    console.log(`  GET /health`);
    console.log(`  GET /api/mesh/:date (YYYY-MM-DD)`);
    console.log(`  GET /api/mesh/range/:startDate/:endDate`);
    console.log(`  GET /api/mesh/available`);
  });
}

start().catch(console.error);
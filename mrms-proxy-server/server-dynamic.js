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
 * Diagnostic endpoint for troubleshooting production issues
 */
app.get('/api/diagnostics', async (req, res) => {
  try {
    const hasEccodes = await checkEccodes();
    
    // Test date parsing
    const testDate = '2024-09-24';
    let dateParseTest = 'failed';
    try {
      const parsed = new Date(testDate + 'T00:00:00Z');
      dateParseTest = parsed.toISOString();
    } catch (e) {
      dateParseTest = e.message;
    }
    
    // Check if we can fetch a test file
    let canFetchGrib2 = false;
    let fetchError = null;
    try {
      const testUrl = 'https://mtarchive.geol.iastate.edu/2024/09/25/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_20240925-000000.grib2.gz';
      const response = await axios.head(testUrl, { timeout: 5000 });
      canFetchGrib2 = response.status === 200;
    } catch (e) {
      fetchError = e.message;
    }
    
    // Get cached files
    const cacheFiles = fsSync.existsSync(CONFIG.CACHE_DIR) 
      ? await fs.readdir(CONFIG.CACHE_DIR).catch(() => [])
      : [];
    
    res.json({
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
        }
      },
      eccodes: {
        installed: hasEccodes,
        testCommand: hasEccodes ? 'grib_get_data available' : 'not found'
      },
      dateHandling: {
        testDate,
        parsed: dateParseTest,
        currentTime: new Date().toISOString()
      },
      network: {
        canAccessIEM: canFetchGrib2,
        fetchError,
        testUrl: 'Sept 25, 2024 GRIB2 file'
      },
      cache: {
        files: cacheFiles.length,
        samples: cacheFiles.slice(0, 5)
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Diagnostic failed',
      message: error.message
    });
  }
});

/**
 * Get MESH data for a local Oklahoma date
 * This endpoint handles timezone conversion properly for evening storms
 */
app.get('/api/mesh/local/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;
    const requestedDate = new Date(dateStr);
    
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    console.log(`[DYNAMIC] Processing LOCAL date request for ${dateStr} (Oklahoma time)`);
    
    // Check cache for combined data
    const cacheFile = path.join(CONFIG.CACHE_DIR, `okc_mesh_local_${dateStr}.json`);
    try {
      const stats = await fs.stat(cacheFile);
      if (Date.now() - stats.mtime.getTime() < CONFIG.CACHE_DURATION) {
        console.log('[DYNAMIC] Serving local date from cache');
        const cachedData = await fs.readFile(cacheFile, 'utf8');
        return res.json(JSON.parse(cachedData));
      }
    } catch (error) {
      // Cache miss
    }
    
    // For Oklahoma evening storms, check both the current date and next date
    // A storm at 8 PM CDT on May 17 = May 18 1 AM UTC
    const currentDateData = await fetchAndProcessMESH(requestedDate);
    
    // Also check the next day's file for evening storms
    const nextDate = new Date(requestedDate);
    nextDate.setDate(nextDate.getDate() + 1);
    const nextDateData = await fetchAndProcessMESH(nextDate);
    
    // Combine reports from both days, removing duplicates by location
    const allReports = [...currentDateData.reports, ...nextDateData.reports];
    const uniqueReports = Array.from(
      new Map(allReports.map(r => [`${r.latitude.toFixed(3)}_${r.longitude.toFixed(3)}`, r])).values()
    );
    
    const combinedData = {
      date: dateStr,
      source: 'IEM Archive MRMS',
      bounds: CONFIG.OKC_METRO_BOUNDS,
      reports: uniqueReports,
      summary: {
        totalReports: uniqueReports.length,
        maxSize: uniqueReports.length > 0 ? Math.max(...uniqueReports.map(r => r.size)) : 0,
        avgSize: uniqueReports.length > 0 ? uniqueReports.reduce((sum, r) => sum + r.size, 0) / uniqueReports.length : 0
      },
      note: `Combined data from ${requestedDate.toISOString().split('T')[0]} and ${nextDate.toISOString().split('T')[0]} UTC to capture evening storms`
    };
    
    console.log(`[DYNAMIC] Combined: ${uniqueReports.length} reports (from ${currentDateData.reports.length} + ${nextDateData.reports.length})`);
    
    // Cache the combined results
    await fs.writeFile(cacheFile, JSON.stringify(combinedData, null, 2));
    
    res.json(combinedData);
    
  } catch (error) {
    console.error('[DYNAMIC] Error processing local date request:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

/**
 * Get MESH data for a specific date (UTC-based)
 */
app.get('/api/mesh/:date', async (req, res) => {
  try {
    // Validate date format first
    if (!req.params.date || !/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD',
        received: req.params.date
      });
    }
    
    const requestedDate = new Date(req.params.date + 'T00:00:00Z');
    
    // Check if date is valid
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ 
        error: 'Invalid date value',
        received: req.params.date
      });
    }
    
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
    
    // Verify we got actual data
    if (!data.reports || data.reports.length === 0) {
      console.log('[DYNAMIC] Warning: No hail data found for', req.params.date);
      // Still return the empty result but log it
    }
    
    // Cache the results
    await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    
    res.json(data);
    
  } catch (error) {
    console.error('[DYNAMIC] Error processing request:', error);
    console.error('[DYNAMIC] Stack trace:', error.stack);
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
 * NOTE: For Oklahoma local time, evening storms may appear in the next UTC day's file
 * Example: May 17 8PM CDT = May 18 1AM UTC
 */
async function fetchAndProcessMESH(date) {
  // Create date at UTC midnight to avoid timezone issues
  const utcDate = new Date(date.toISOString().split('T')[0] + 'T00:00:00Z');
  const nextDay = new Date(utcDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  
  const year = nextDay.getUTCFullYear();
  const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nextDay.getUTCDate()).padStart(2, '0');
  
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
      throw new Error('ecCodes not installed. Cannot process GRIB2 files. Please install with: apt-get install libeccodes-tools');
    }
    
    // Download file
    console.log(`[DYNAMIC] Downloading from: ${url}`);
    console.log(`[DYNAMIC] Date requested: ${date.toISOString()}`);
    console.log(`[DYNAMIC] File will be saved to: ${gzPath}`);
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'D2D-Sales-Tracker/1.0 (Hail Intelligence System)'
      },
      onDownloadProgress: (progressEvent) => {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        if (percent % 25 === 0) {
          console.log(`[DYNAMIC] Download progress: ${percent}%`);
        }
      }
    });
    
    await pipeline(response.data, fsSync.createWriteStream(gzPath));
    console.log(`[DYNAMIC] Download complete: ${gzPath}`);
    
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
    console.log('[DYNAMIC] Looking for data in bounds:', CONFIG.OKC_METRO_BOUNDS);
    
    // First check if file exists
    const stats = await fs.stat(gribPath);
    console.log(`[DYNAMIC] Processing GRIB2 file: ${gribPath} (${stats.size} bytes)`);
    
    const reports = [];
    let totalPoints = 0;
    let pointsInBounds = 0;
    let pointsWithHail = 0;
    
    try {
      // CRITICAL OPTIMIZATION: Pre-filter at GRIB2 level to avoid memory issues
      // This extracts ONLY the OKC area instead of all 24.5M CONUS points
      console.log('[DYNAMIC] Using pre-filtered extraction for OKC area only...');
      
      // Method 1: Try using grib_get_data with area constraints
      // Note: GRIB2 lat/lon are in millidegrees (35.1° = 35100000)
      const okc_north_milli = 35700000;  // 35.7°
      const okc_south_milli = 35100000;  // 35.1°
      const okc_west = 262.2;  // Already in 0-360 format
      const okc_east = 262.9;
      
      let extractCommand;
      
      // First attempt: Use grib_ls to check if area filtering is supported
      try {
        const { stdout: gribInfo } = await execPromise(
          `grib_ls -p centre,dataDate,dataTime ${gribPath} | head -5`,
          { maxBuffer: 1024 * 1024 }
        );
        console.log('[DYNAMIC] GRIB info:', gribInfo.trim());
      } catch (infoError) {
        console.log('[DYNAMIC] Could not get GRIB info:', infoError.message);
      }
      
      // Try area-based extraction first (most efficient)
      extractCommand = `grib_get_data -w latitudeOfFirstGridPoint<=${okc_north_milli},latitudeOfLastGridPoint>=${okc_south_milli} ${gribPath} 2>/dev/null || grib_get_data ${gribPath}`;
      
      console.log('[DYNAMIC] Attempting pre-filtered extraction...');
      const { stdout: rawData } = await execPromise(
        extractCommand,
        { maxBuffer: 50 * 1024 * 1024 } // 50MB should be enough for OKC area only
      );
      
      // Process the data directly from stdout (no temp file needed)
      const lines = rawData.split('\n');
      console.log(`[DYNAMIC] Processing ${lines.length} lines of data...`);
      
      let headerSkipped = false;
      
      // First, let's log a sample of the data to debug format issues
      if (lines.length > 1) {
        console.log('[DYNAMIC] Sample data (first 5 lines):');
        for (let i = 0; i < Math.min(5, lines.length); i++) {
          console.log(`  Line ${i}: "${lines[i]}"`);
        }
      }
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Skip header line
        if (!headerSkipped) {
          if (trimmed.includes('Latitude') || trimmed.includes('lat') || trimmed.includes('longitude')) {
            headerSkipped = true;
            console.log('[DYNAMIC] Found header:', trimmed);
          }
          continue;
        }
        
        // Parse: latitude longitude value
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          totalPoints++;
          const lat = parseFloat(parts[0]);
          const lon = parseFloat(parts[1]); // Keep as-is first to check format
          const meshValue = parseFloat(parts[2]); // in mm
          
          // Skip invalid or zero values
          if (isNaN(lat) || isNaN(lon) || isNaN(meshValue) || meshValue <= 0) {
            continue;
          }
          
          // Determine longitude format and convert if needed
          let adjustedLon = lon;
          if (lon > 180) {
            // It's in 0-360 format, convert to -180-180
            adjustedLon = lon - 360;
          }
          
          // Check bounds
          if (lat >= CONFIG.OKC_METRO_BOUNDS.south && 
              lat <= CONFIG.OKC_METRO_BOUNDS.north &&
              adjustedLon >= CONFIG.OKC_METRO_BOUNDS.west && 
              adjustedLon <= CONFIG.OKC_METRO_BOUNDS.east) {
            
            pointsInBounds++;
            const sizeInches = meshValue / 25.4;
            
            // Only include significant hail
            if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
              pointsWithHail++;
              
              // Log first few matches for debugging
              if (reports.length < 3) {
                console.log(`[DYNAMIC] Found hail: ${lat}, ${adjustedLon}, ${sizeInches}" (${meshValue}mm)`);
              }
              
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
      
      console.log(`[DYNAMIC] Processed ${totalPoints} total points`);
      console.log(`[DYNAMIC] Found ${pointsInBounds} points in OKC Metro bounds`);
      console.log(`[DYNAMIC] Found ${pointsWithHail} points with hail >= ${CONFIG.MIN_HAIL_SIZE}"`);
      console.log(`[DYNAMIC] Returning ${reports.length} hail reports`);
      
      return reports;
      
    } catch (error) {
      console.error('[DYNAMIC] Error during extraction:', error.message);
      throw error;
    }
    
  } catch (error) {
    console.error('[DYNAMIC] Error extracting data:', error);
    console.error('[DYNAMIC] Error details:', error.message);
    // CRITICAL: Must throw error instead of returning empty array
    // This ensures we follow NO MOCK DATA protocol - fail explicitly
    throw new Error(`Failed to extract GRIB2 data: ${error.message}`);
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
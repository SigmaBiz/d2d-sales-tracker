/**
 * MRMS Proxy Server
 * Processes GRIB2 files from Iowa Environmental Mesonet
 * Extracts MESH data for Oklahoma region
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);
const app = express();

// Enable CORS for all origins in development
app.use(cors());
app.use(express.json());

// Oklahoma bounds
const OKLAHOMA_BOUNDS = {
  north: 37.0,
  south: 33.5,
  east: -94.5,
  west: -103.0
};

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
fs.mkdir(TEMP_DIR, { recursive: true }).catch(console.error);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mrms-proxy-server' });
});

/**
 * Get MESH data for a specific date
 * Example: GET /api/mesh/2024-09-24
 */
app.get('/api/mesh/:date', async (req, res) => {
  const { date } = req.params;
  
  try {
    console.log(`[MRMS Proxy] Fetching MESH data for ${date}`);
    
    // Parse date
    const [year, month, day] = date.split('-');
    if (!year || !month || !day) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Try multiple hours (storms can occur at different times)
    const hours = ['20', '21', '22', '19', '23', '18']; // Try evening hours first
    let meshData = null;
    
    for (const hour of hours) {
      try {
        meshData = await fetchMESHData(year, month, day, hour);
        if (meshData && meshData.length > 0) {
          console.log(`[MRMS Proxy] Found data for ${date} at hour ${hour}`);
          break;
        }
      } catch (error) {
        console.log(`[MRMS Proxy] No data for hour ${hour}, trying next...`);
      }
    }
    
    if (!meshData || meshData.length === 0) {
      // Return empty array if no data found
      return res.json({ 
        date,
        reports: [],
        message: 'No MESH data available for this date'
      });
    }
    
    res.json({
      date,
      reports: meshData,
      source: 'IEM Archive MESH'
    });
    
  } catch (error) {
    console.error('[MRMS Proxy] Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch MESH data',
      details: error.message 
    });
  }
});

/**
 * Fetch MESH data from IEM archive
 */
async function fetchMESHData(year, month, day, hour) {
  const filename = `${year}${month}${day}${hour}`;
  const url = `https://mrms.agron.iastate.edu/${year}/${month}/${day}/${filename}.zip`;
  
  console.log(`[MRMS Proxy] Downloading from ${url}`);
  
  // Download ZIP file
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000 // 30 second timeout
  });
  
  // Save ZIP temporarily
  const zipPath = path.join(TEMP_DIR, `${filename}.zip`);
  await fs.writeFile(zipPath, response.data);
  
  try {
    // Extract ZIP
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    // Look for MESH GRIB2 file
    let meshEntry = null;
    for (const entry of zipEntries) {
      if (entry.entryName.includes('MESH') && entry.entryName.endsWith('.grib2')) {
        meshEntry = entry;
        break;
      }
    }
    
    if (!meshEntry) {
      throw new Error('No MESH data in archive');
    }
    
    // Extract MESH GRIB2 file
    const gribPath = path.join(TEMP_DIR, meshEntry.entryName);
    zip.extractEntryTo(meshEntry, TEMP_DIR, false, true);
    
    // Process GRIB2 file
    const meshReports = await processGRIB2(gribPath, `${year}-${month}-${day}T${hour}:00:00Z`);
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    await fs.unlink(zipPath).catch(() => {});
    
    return meshReports;
    
  } catch (error) {
    // Cleanup on error
    await fs.unlink(zipPath).catch(() => {});
    throw error;
  }
}

/**
 * Process GRIB2 file to extract MESH values
 * Note: This requires wgrib2 to be installed on the system
 */
async function processGRIB2(gribPath, timestamp) {
  try {
    // Use wgrib2 to convert GRIB2 to CSV
    // You need to install wgrib2: https://www.cpc.ncep.noaa.gov/products/wesley/wgrib2/
    const csvPath = gribPath.replace('.grib2', '.csv');
    
    // Extract MESH data as CSV
    const wgrib2Command = `wgrib2 ${gribPath} -match "MESH" -csv ${csvPath}`;
    
    try {
      await execPromise(wgrib2Command);
    } catch (error) {
      console.error('[MRMS Proxy] wgrib2 not found. Using mock data instead.');
      // Return mock data if wgrib2 is not installed
      return getMockMESHData(timestamp);
    }
    
    // Read CSV data
    const csvData = await fs.readFile(csvPath, 'utf-8');
    const lines = csvData.split('\n');
    
    const reports = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // CSV format: date,var,level,lon,lat,value
      const parts = line.split(',');
      if (parts.length < 6) continue;
      
      const lon = parseFloat(parts[3]);
      const lat = parseFloat(parts[4]);
      const meshMM = parseFloat(parts[5]);
      
      // Filter for Oklahoma
      if (lat >= OKLAHOMA_BOUNDS.south && lat <= OKLAHOMA_BOUNDS.north &&
          lon >= OKLAHOMA_BOUNDS.west && lon <= OKLAHOMA_BOUNDS.east &&
          meshMM > 0) {
        
        reports.push({
          id: `mesh_${Date.now()}_${reports.length}`,
          latitude: lat,
          longitude: lon,
          size: meshMM / 25.4, // Convert mm to inches
          meshValue: meshMM,
          timestamp: timestamp,
          confidence: calculateConfidence(meshMM),
          city: getClosestCity(lat, lon),
          isMetroOKC: isMetroOKC(lat, lon),
          source: 'IEM Archive MESH'
        });
      }
    }
    
    // Cleanup
    await fs.unlink(csvPath).catch(() => {});
    
    return reports;
    
  } catch (error) {
    console.error('[MRMS Proxy] Error processing GRIB2:', error);
    return getMockMESHData(timestamp);
  }
}

/**
 * Calculate confidence based on MESH value
 */
function calculateConfidence(meshMM) {
  if (meshMM >= 50) return 92; // 2+ inch hail
  if (meshMM >= 40) return 88; // 1.5+ inch hail
  if (meshMM >= 25) return 85; // 1+ inch hail
  return 80;
}

/**
 * Check if coordinates are in Metro OKC
 */
function isMetroOKC(lat, lon) {
  const OKC_CENTER = { lat: 35.4676, lon: -97.5164 };
  const distance = Math.sqrt(
    Math.pow(lat - OKC_CENTER.lat, 2) + 
    Math.pow(lon - OKC_CENTER.lon, 2)
  );
  return distance < 0.5; // Roughly 35 miles
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
    { name: 'Tulsa', lat: 36.1540, lon: -95.9928 },
    { name: 'Lawton', lat: 34.6036, lon: -98.3959 }
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
 * Mock MESH data for testing
 */
function getMockMESHData(timestamp) {
  const date = new Date(timestamp);
  const dateStr = date.toISOString().split('T')[0];
  
  // Known storm dates with mock data
  const mockData = {
    '2024-09-24': [
      {
        latitude: 35.4676, longitude: -97.5164, size: 2.25, meshValue: 57.15,
        city: 'Oklahoma City', confidence: 92
      },
      {
        latitude: 35.3395, longitude: -97.4867, size: 1.75, meshValue: 44.45,
        city: 'Moore', confidence: 88
      },
      {
        latitude: 35.2226, longitude: -97.4395, size: 1.5, meshValue: 38.1,
        city: 'Norman', confidence: 85
      }
    ]
  };
  
  const reports = (mockData[dateStr] || []).map((data, index) => ({
    id: `mock_mesh_${Date.now()}_${index}`,
    ...data,
    timestamp: timestamp,
    isMetroOKC: true,
    source: 'Mock MESH Data'
  }));
  
  return reports;
}

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[MRMS Proxy] Server running on port ${PORT}`);
  console.log(`[MRMS Proxy] Health check: http://localhost:${PORT}/health`);
  console.log(`[MRMS Proxy] Example: http://localhost:${PORT}/api/mesh/2024-09-24`);
});
/**
 * TIER 1: Real-Time MRMS Processing Server
 * Monitors NCEP MRMS for immediate storm detection
 * Uses ecCodes for real-time GRIB2 processing
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
  // Real-time NCEP MRMS endpoints
  NCEP_REALTIME_URL: 'https://mrms.ncep.noaa.gov/data/2p5km/MESH_Max_30min',
  
  // OKC Metro bounds - includes entire metropolitan area
  OKC_METRO_BOUNDS: {
    north: 35.7,    // North of Edmond
    south: 35.1,    // South of Norman
    east: -97.1,    // East of Midwest City
    west: -97.8     // West of Yukon
  },
  
  // Real-time thresholds
  MIN_HAIL_SIZE: 0.75,  // Lower threshold for real-time alerts (0.75")
  ALERT_THRESHOLD: 1.25, // Size that triggers immediate alerts
  
  // Cache and temp directories
  CACHE_DIR: path.join(__dirname, 'realtime_cache'),
  TEMP_DIR: path.join(__dirname, 'realtime_temp'),
  
  // Monitoring settings
  CHECK_INTERVAL: 2 * 60 * 1000, // 2 minutes
  MAX_AGE_MINUTES: 30, // Only look at files from last 30 minutes
  
  PORT: process.env.PORT || 3003
};

// Global monitoring state
let monitoringActive = false;
let monitoringInterval = null;
let lastProcessedTime = null;
let testStorms = []; // Store test storms temporarily
let stormHistory = new Map(); // Track storm progression over time

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
    console.error('[REALTIME] ecCodes not found. Install with:');
    console.error('[REALTIME] Mac: brew install eccodes');
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
    service: 'mrms-realtime-server',
    eccodes: hasEccodes ? 'installed' : 'missing',
    monitoring: monitoringActive,
    lastCheck: lastProcessedTime,
    bounds: CONFIG.OKC_METRO_BOUNDS
  });
});

/**
 * Start real-time monitoring
 */
app.post('/api/monitoring/start', async (req, res) => {
  try {
    if (monitoringActive) {
      return res.json({ 
        status: 'already_active',
        message: 'Real-time monitoring is already running'
      });
    }
    
    const hasEccodes = await checkEccodes();
    if (!hasEccodes) {
      return res.status(500).json({ 
        error: 'ecCodes not installed',
        message: 'Cannot start monitoring without ecCodes'
      });
    }
    
    await startRealTimeMonitoring();
    
    res.json({
      status: 'started',
      message: 'Real-time monitoring activated',
      interval: CONFIG.CHECK_INTERVAL / 1000 + ' seconds',
      bounds: CONFIG.OKC_METRO_BOUNDS
    });
    
  } catch (error) {
    console.error('[REALTIME] Error starting monitoring:', error);
    res.status(500).json({ 
      error: 'Failed to start monitoring',
      details: error.message 
    });
  }
});

/**
 * Stop real-time monitoring
 */
app.post('/api/monitoring/stop', (req, res) => {
  stopRealTimeMonitoring();
  res.json({
    status: 'stopped',
    message: 'Real-time monitoring deactivated'
  });
});

/**
 * Get current storms (immediate check)
 */
app.get('/api/storms/current', async (req, res) => {
  try {
    console.log('[REALTIME] Manual storm check requested');
    
    const storms = await checkForCurrentStorms();
    
    res.json({
      timestamp: new Date(),
      storms: storms,
      count: storms.length,
      bounds: CONFIG.OKC_METRO_BOUNDS,
      source: 'NCEP MRMS Real-Time'
    });
    
  } catch (error) {
    console.error('[REALTIME] Error checking current storms:', error);
    res.status(500).json({ 
      error: 'Failed to check storms',
      details: error.message 
    });
  }
});

/**
 * Get storm progression timeline
 */
app.get('/api/storms/progression/:stormId', (req, res) => {
  const { stormId } = req.params;
  const history = stormHistory.get(stormId) || [];
  
  res.json({
    stormId,
    timeline: history,
    duration: history.length > 0 ? 
      (history[history.length - 1].timestamp - history[0].timestamp) / 1000 / 60 : 0, // minutes
    currentStatus: history.length > 0 ? history[history.length - 1] : null
  });
});

/**
 * Get all active storm progressions
 */
app.get('/api/storms/progressions', (req, res) => {
  const progressions = {};
  
  stormHistory.forEach((timeline, stormId) => {
    progressions[stormId] = {
      timeline: timeline,
      duration: timeline.length > 0 ? 
        (timeline[timeline.length - 1].timestamp - timeline[0].timestamp) / 1000 / 60 : 0
    };
  });
  
  res.json({
    storms: progressions,
    count: stormHistory.size
  });
});

/**
 * Get alerts (storms above alert threshold)
 */
app.get('/api/alerts/active', async (req, res) => {
  try {
    const storms = await checkForCurrentStorms();
    const alerts = storms.filter(storm => storm.size >= CONFIG.ALERT_THRESHOLD);
    
    res.json({
      timestamp: new Date(),
      alerts: alerts,
      count: alerts.length,
      threshold: CONFIG.ALERT_THRESHOLD,
      message: alerts.length > 0 ? 'ACTIVE HAIL ALERTS' : 'No active alerts'
    });
    
  } catch (error) {
    console.error('[REALTIME] Error checking alerts:', error);
    res.status(500).json({ 
      error: 'Failed to check alerts',
      details: error.message 
    });
  }
});

/**
 * TEST ENDPOINT: Simulate a storm for testing
 */
app.post('/api/test/simulate-storm', async (req, res) => {
  try {
    console.log('[REALTIME] 🧪 TEST: Simulating storm detection');
    
    // Create test storm data
    testStorms = [
      {
        id: `test_storm_${Date.now()}`,
        latitude: 35.6,      // Edmond area
        longitude: -97.47,
        size: 2.5,           // 2.5 inch hail (baseball size)
        meshValue: 63.5,     // 2.5 * 25.4
        timestamp: new Date(),
        confidence: 85,
        source: 'NCEP MRMS Real-Time',
        isActive: true
      },
      {
        id: `test_storm_${Date.now()}_2`,
        latitude: 35.45,     // Downtown OKC
        longitude: -97.51,
        size: 1.75,          // Golf ball size
        meshValue: 44.45,
        timestamp: new Date(),
        confidence: 80,
        source: 'NCEP MRMS Real-Time',
        isActive: true
      }
    ];
    
    // Trigger alerts
    await triggerAlerts(testStorms);
    
    res.json({
      status: 'success',
      message: 'Test storm simulation complete',
      storms: testStorms,
      alertsTriggered: true
    });
    
  } catch (error) {
    console.error('[REALTIME] Error in test simulation:', error);
    res.status(500).json({ 
      error: 'Test simulation failed',
      details: error.message 
    });
  }
});

/**
 * TEST ENDPOINT: Create storms with different tier labels for visual testing
 */
app.post('/api/test/tier-test', async (req, res) => {
  try {
    console.log('[REALTIME] 🧪 TEST: Creating Tier 1 and Tier 2 test storms');
    
    // Create one storm from each tier for visual testing
    testStorms = [
      // TIER 1: Real-time storm
      {
        id: `tier1_test_${Date.now()}`,
        latitude: 35.6,
        longitude: -97.47,
        size: 2.5,  // Will show AUTO badge
        meshValue: 63.5,
        timestamp: new Date(),
        confidence: 85,
        source: 'NCEP MRMS Real-Time',  // This makes it TIER 1
        isActive: true,
        city: 'Edmond'
      },
      // TIER 2: Historical storm (simulated)
      {
        id: `tier2_test_${Date.now()}`,
        latitude: 35.45,
        longitude: -97.51,
        size: 1.75,
        meshValue: 44.45,
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        confidence: 75,
        source: 'IEM Archive MESH',  // This makes it TIER 2
        isActive: false,  // Historical storms are not active
        city: 'Oklahoma City'
      }
    ];
    
    console.log('[REALTIME] Created test storms:');
    console.log('  - TIER 1 (MRMS): 2.5" in Edmond - should show T1 + AUTO badges');
    console.log('  - TIER 2 (IEM): 1.75" in OKC - should show T2 badge');
    
    res.json({
      status: 'success',
      message: 'Tier test storms created',
      storms: testStorms,
      instructions: 'Check Active Storms panel for T1/T2 badges'
    });
    
  } catch (error) {
    console.error('[REALTIME] Error in tier test:', error);
    res.status(500).json({ 
      error: 'Tier test failed',
      details: error.message 
    });
  }
});

/**
 * Start the real-time monitoring process
 */
async function startRealTimeMonitoring() {
  console.log('[REALTIME] Starting real-time MRMS monitoring...');
  console.log(`[REALTIME] Checking every ${CONFIG.CHECK_INTERVAL / 1000} seconds for hail ≥${CONFIG.MIN_HAIL_SIZE}"`);
  console.log(`[REALTIME] Alert threshold: ${CONFIG.ALERT_THRESHOLD}"`);
  
  monitoringActive = true;
  
  // Initial check
  await checkForCurrentStorms();
  
  // Set up interval
  monitoringInterval = setInterval(async () => {
    try {
      await checkForCurrentStorms();
    } catch (error) {
      console.error('[REALTIME] Error in monitoring interval:', error);
    }
  }, CONFIG.CHECK_INTERVAL);
}

/**
 * Stop the real-time monitoring process
 */
function stopRealTimeMonitoring() {
  console.log('[REALTIME] Stopping real-time monitoring...');
  
  monitoringActive = false;
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Check for current storms from NCEP MRMS
 */
async function checkForCurrentStorms() {
  try {
    console.log('[REALTIME] Checking for current storms...');
    lastProcessedTime = new Date();
    
    // Return test storms if available
    if (testStorms.length > 0) {
      console.log('[REALTIME] Returning test storms');
      return testStorms;
    }
    
    // Get latest MESH data file
    const latestFile = await getLatestMESHFile();
    if (!latestFile) {
      console.log('[REALTIME] No recent MESH data available');
      return [];
    }
    
    // Process the GRIB2 file
    const storms = await processMESHFile(latestFile);
    
    // Filter for significant hail in metro area
    const metroStorms = storms.filter(storm => 
      storm.latitude >= CONFIG.OKC_METRO_BOUNDS.south &&
      storm.latitude <= CONFIG.OKC_METRO_BOUNDS.north &&
      storm.longitude >= CONFIG.OKC_METRO_BOUNDS.west &&
      storm.longitude <= CONFIG.OKC_METRO_BOUNDS.east &&
      storm.size >= CONFIG.MIN_HAIL_SIZE
    );
    
    if (metroStorms.length > 0) {
      console.log(`[REALTIME] Found ${metroStorms.length} active storms in metro area`);
      
      // Track storm progression
      metroStorms.forEach(storm => {
        const stormKey = `${storm.latitude.toFixed(2)}_${storm.longitude.toFixed(2)}`;
        
        if (!stormHistory.has(stormKey)) {
          stormHistory.set(stormKey, []);
        }
        
        const history = stormHistory.get(stormKey);
        history.push({
          timestamp: new Date(),
          latitude: storm.latitude,
          longitude: storm.longitude,
          size: storm.size,
          confidence: storm.confidence,
          intensity: getIntensityLevel(storm.size)
        });
        
        // Keep only last 2 hours of history
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        stormHistory.set(stormKey, history.filter(h => h.timestamp > twoHoursAgo));
      });
      
      // Check for alert-level storms
      const alertStorms = metroStorms.filter(s => s.size >= CONFIG.ALERT_THRESHOLD);
      if (alertStorms.length > 0) {
        console.log(`[REALTIME] 🚨 ALERT: ${alertStorms.length} significant storms detected!`);
        await triggerAlerts(alertStorms);
      }
    } else {
      console.log('[REALTIME] No significant storms detected in metro area');
    }
    
    return metroStorms;
    
  } catch (error) {
    console.error('[REALTIME] Error checking for storms:', error);
    return [];
  }
}

/**
 * Get the latest MESH file from NCEP
 */
async function getLatestMESHFile() {
  try {
    // In a real implementation, you would:
    // 1. List files from NCEP FTP/HTTP directory
    // 2. Find the most recent MESH file
    // 3. Download it if newer than last processed
    
    // For now, we'll simulate with IEM Archive recent data
    // This would need to be replaced with actual NCEP endpoint
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    
    // Try current hour and previous hour
    for (let hourOffset = 0; hourOffset <= 1; hourOffset++) {
      const targetHour = String((now.getHours() - hourOffset + 24) % 24).padStart(2, '0');
      const url = `https://mtarchive.geol.iastate.edu/${year}/${month}/${day}/mrms/ncep/MESH_Max_30min/MESH_Max_30min_00.50_${year}${month}${day}-${targetHour}3000.grib2.gz`;
      
      try {
        console.log(`[REALTIME] Checking ${url}`);
        const response = await axios.head(url, { timeout: 10000 });
        
        if (response.status === 200) {
          console.log(`[REALTIME] Found recent MESH file: ${url}`);
          return url;
        }
      } catch (error) {
        // File doesn't exist, try next
        continue;
      }
    }
    
    console.log('[REALTIME] No recent MESH files found');
    return null;
    
  } catch (error) {
    console.error('[REALTIME] Error getting latest MESH file:', error);
    return null;
  }
}

/**
 * Process MESH GRIB2 file and extract hail data
 */
async function processMESHFile(url) {
  const fileName = path.basename(url);
  const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
  const gribPath = gzPath.replace('.gz', '');
  
  try {
    // Download file
    console.log(`[REALTIME] Downloading ${url}`);
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
    const storms = await extractMESHData(gribPath);
    
    return storms;
    
  } finally {
    // Cleanup
    await cleanupFiles(gribPath, gzPath);
  }
}

/**
 * Extract MESH data using ecCodes
 */
async function extractMESHData(gribPath) {
  try {
    console.log('[REALTIME] Extracting MESH data...');
    
    const { stdout } = await execPromise(`grib_get_data ${gribPath}`, {
      maxBuffer: 100 * 1024 * 1024 // 100MB buffer
    });
    
    const storms = [];
    const lines = stdout.split('\n');
    let headerSkipped = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Skip header
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
        const lon = parseFloat(parts[1]);
        const meshValue = parseFloat(parts[2]); // mm
        
        if (isNaN(lat) || isNaN(lon) || isNaN(meshValue) || meshValue <= 0) continue;
        
        const meshInches = meshValue / 25.4;
        
        // Only include significant hail
        if (meshInches >= CONFIG.MIN_HAIL_SIZE) {
          storms.push({
            id: `realtime_${Date.now()}_${storms.length}`,
            latitude: lat,
            longitude: lon - 360, // Convert to -180/180
            size: Math.round(meshInches * 100) / 100,
            meshValue: meshValue,
            timestamp: new Date(),
            confidence: calculateRealtimeConfidence(meshInches),
            source: 'NCEP MRMS Real-Time',
            isActive: true
          });
        }
      }
    }
    
    console.log(`[REALTIME] Extracted ${storms.length} storm points`);
    return storms;
    
  } catch (error) {
    console.error('[REALTIME] Error extracting MESH data:', error);
    return [];
  }
}

/**
 * Calculate confidence for real-time data
 */
function calculateRealtimeConfidence(sizeInches) {
  // Real-time data starts with lower confidence due to processing delay
  let confidence = 70;
  
  if (sizeInches >= 2.5) confidence = 85;      // Baseball+
  else if (sizeInches >= 2.0) confidence = 80; // Golf ball+
  else if (sizeInches >= 1.5) confidence = 75; // Ping pong+
  
  return confidence;
}

/**
 * Get intensity level description
 */
function getIntensityLevel(sizeInches) {
  if (sizeInches >= 4.0) return 'extreme';     // Softball+
  if (sizeInches >= 2.75) return 'severe';     // Baseball+
  if (sizeInches >= 2.0) return 'significant'; // Golf ball+
  if (sizeInches >= 1.5) return 'moderate';    // Ping pong+
  if (sizeInches >= 1.0) return 'notable';     // Quarter+
  return 'minor';
}

/**
 * Trigger alerts for significant storms
 */
async function triggerAlerts(storms) {
  console.log(`[REALTIME] 🚨 TRIGGERING ALERTS for ${storms.length} storms`);
  
  // Save alert data
  const alertData = {
    timestamp: new Date(),
    storms: storms,
    alertLevel: 'HIGH',
    message: `${storms.length} significant storm(s) detected in OKC Metro`
  };
  
  const alertFile = path.join(CONFIG.CACHE_DIR, `alert_${Date.now()}.json`);
  await fs.writeFile(alertFile, JSON.stringify(alertData, null, 2));
  
  // In production, this would trigger:
  // - Push notifications to all active users
  // - SMS alerts to team leads
  // - Slack/Teams notifications
  // - Email alerts
  
  storms.forEach(storm => {
    console.log(`[REALTIME] 🌩️  ${storm.size}" hail at ${storm.latitude.toFixed(3)}, ${storm.longitude.toFixed(3)}`);
  });
}

/**
 * Cleanup temporary files
 */
async function cleanupFiles(...files) {
  for (const file of files) {
    try {
      await fs.unlink(file);
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

// Initialize and start server
async function start() {
  await ensureDirectories();
  
  app.listen(CONFIG.PORT, () => {
    console.log(`[REALTIME] Real-Time MRMS Server running on port ${CONFIG.PORT}`);
    console.log(`[REALTIME] Health check: http://localhost:${CONFIG.PORT}/health`);
    console.log(`[REALTIME] Start monitoring: POST http://localhost:${CONFIG.PORT}/api/monitoring/start`);
    console.log(`[REALTIME] Current storms: GET http://localhost:${CONFIG.PORT}/api/storms/current`);
    console.log(`[REALTIME] Metro bounds: ${JSON.stringify(CONFIG.OKC_METRO_BOUNDS)}`);
  });
}

start().catch(console.error);
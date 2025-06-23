#!/usr/bin/env node

/**
 * Pre-process last 12 months of MRMS data
 * Production-ready script with error handling and resume capability
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');
const { createWriteStream } = require('fs');

const CONFIG = {
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  OKC_METRO_BOUNDS: {
    north: 35.7,
    south: 35.1,
    east: -97.1,
    west: -97.8
  },
  MIN_HAIL_SIZE: 0.75,
  OUTPUT_DIR: './preprocessed',
  TEMP_DIR: './temp',
  PROGRESS_FILE: './preprocess-progress.json',
  BATCH_SIZE: 5,
  RETRY_ATTEMPTS: 3
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Load progress to support resuming
async function loadProgress() {
  try {
    const data = await fs.readFile(CONFIG.PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      completed: [],
      failed: [],
      stats: {
        totalProcessed: 0,
        totalReports: 0,
        datesWithHail: 0,
        startTime: new Date().toISOString()
      }
    };
  }
}

// Save progress
async function saveProgress(progress) {
  await fs.writeFile(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Get dates for last 12 months
function getLast12Months() {
  const dates = [];
  const today = new Date();
  
  for (let i = 1; i <= 365; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  return dates;
}

// Process a single date with retries
async function processDate(dateStr, attempt = 1) {
  const outputFile = path.join(CONFIG.OUTPUT_DIR, `${dateStr}.json`);
  
  try {
    // Build URL (use next day for 24hr max)
    const requestedDate = new Date(dateStr + 'T12:00:00Z');
    const nextDay = new Date(requestedDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    const year = nextDay.getUTCFullYear();
    const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nextDay.getUTCDate()).padStart(2, '0');
    
    const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
    
    // Download file
    const fileName = path.basename(url);
    const gzPath = path.join(CONFIG.TEMP_DIR, fileName);
    const gribPath = gzPath.replace('.gz', '');
    
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 60000,
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
    
    // Extract
    await execPromise(`gunzip -f ${gzPath}`);
    
    // Process with awk
    const { stdout } = await execPromise(
      `grib_get_data ${gribPath} | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 >= ${CONFIG.MIN_HAIL_SIZE * 25.4}'`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    // Parse results
    const reports = [];
    const lines = stdout.trim().split('\n');
    
    for (const line of lines) {
      if (!line) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]) - 360;
        const meshValue = parseFloat(parts[2]);
        const sizeInches = meshValue / 25.4;
        
        reports.push({
          id: `mesh_${dateStr}_${reports.length}`,
          latitude: lat,
          longitude: lon,
          size: Math.round(sizeInches * 100) / 100,
          timestamp: requestedDate.toISOString(),
          confidence: calculateConfidence(sizeInches),
          city: getCityName(lat, lon),
          source: 'IEM MRMS Archive',
          meshValue: meshValue
        });
      }
    }
    
    // Save results
    const result = {
      date: dateStr,
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
    
    await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
    
    // Cleanup
    await fs.unlink(gribPath).catch(() => {});
    
    return { success: true, reports: reports.length };
    
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // No data available - save empty result
      const emptyResult = {
        date: dateStr,
        generated_at: new Date().toISOString(),
        error: 'No data available',
        reports: [],
        summary: { totalReports: 0, maxSize: 0, avgSize: 0 }
      };
      await fs.writeFile(outputFile, JSON.stringify(emptyResult, null, 2));
      return { success: true, reports: 0, noData: true };
    }
    
    if (attempt < CONFIG.RETRY_ATTEMPTS) {
      console.log(`  Retry attempt ${attempt + 1}...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return processDate(dateStr, attempt + 1);
    }
    
    throw error;
  }
}

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

// Progress display
function displayProgress(current, total, dateStr, reports) {
  const percent = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(percent / 2)) + '░'.repeat(50 - Math.floor(percent / 2));
  
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(`[${bar}] ${percent}% | ${current}/${total} | ${dateStr} | ${reports} reports`);
}

// Main processing
async function main() {
  console.log('MRMS Data Pre-processor for OKC Metro');
  console.log('=====================================\n');
  
  await ensureDirectories();
  
  // Load progress
  const progress = await loadProgress();
  console.log(`Resuming from previous run...`);
  console.log(`Already completed: ${progress.completed.length} dates\n`);
  
  // Get dates to process
  const allDates = getLast12Months();
  const datesToProcess = allDates.filter(d => !progress.completed.includes(d));
  
  console.log(`Total dates to process: ${datesToProcess.length}`);
  console.log(`Starting processing...\n`);
  
  const startTime = Date.now();
  
  // Process in batches
  for (let i = 0; i < datesToProcess.length; i += CONFIG.BATCH_SIZE) {
    const batch = datesToProcess.slice(i, i + CONFIG.BATCH_SIZE);
    
    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (date) => {
        try {
          displayProgress(
            progress.completed.length + 1,
            allDates.length,
            date,
            'processing...'
          );
          
          const result = await processDate(date);
          
          progress.completed.push(date);
          progress.stats.totalProcessed++;
          if (result.reports > 0) {
            progress.stats.datesWithHail++;
            progress.stats.totalReports += result.reports;
          }
          
          displayProgress(
            progress.completed.length,
            allDates.length,
            date,
            result.reports
          );
          
          return { date, ...result };
          
        } catch (error) {
          console.error(`\n❌ Failed ${date}: ${error.message}`);
          progress.failed.push({ date, error: error.message });
          return { date, success: false, error: error.message };
        }
      })
    );
    
    // Save progress after each batch
    await saveProgress(progress);
    
    // Rate limiting
    if (i + CONFIG.BATCH_SIZE < datesToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Final statistics
  const elapsed = Date.now() - startTime;
  console.log('\n\n✅ Pre-processing complete!\n');
  
  console.log('Statistics:');
  console.log(`- Total dates processed: ${progress.stats.totalProcessed}`);
  console.log(`- Dates with hail: ${progress.stats.datesWithHail}`);
  console.log(`- Total hail reports: ${progress.stats.totalReports}`);
  console.log(`- Failed dates: ${progress.failed.length}`);
  console.log(`- Processing time: ${Math.round(elapsed / 1000 / 60)} minutes`);
  
  if (progress.stats.datesWithHail > 0) {
    console.log(`- Average reports per storm day: ${Math.round(progress.stats.totalReports / progress.stats.datesWithHail)}`);
  }
  
  // Calculate storage
  const files = await fs.readdir(CONFIG.OUTPUT_DIR);
  let totalSize = 0;
  for (const file of files) {
    const stats = await fs.stat(path.join(CONFIG.OUTPUT_DIR, file));
    totalSize += stats.size;
  }
  console.log(`- Total storage used: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
  
  if (progress.failed.length > 0) {
    console.log('\nFailed dates:');
    progress.failed.forEach(f => console.log(`  - ${f.date}: ${f.error}`));
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { processDate, getLast12Months };
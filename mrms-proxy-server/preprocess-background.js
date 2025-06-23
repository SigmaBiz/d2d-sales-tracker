#!/usr/bin/env node

/**
 * Background-safe version of preprocessing script
 * Runs without terminal interaction, perfect for overnight processing
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const { createWriteStream } = require('fs');

const execPromise = promisify(exec);

// Configuration
const CONFIG = {
  BASE_URL: 'https://mtarchive.geol.iastate.edu',
  OUTPUT_DIR: './preprocessed',
  TEMP_DIR: './temp',
  DAYS_TO_PROCESS: 365,
  MIN_HAIL_SIZE: 0.75, // inches
  BATCH_SIZE: 5,
  MAX_RETRIES: 3,
  PROGRESS_FILE: './preprocess-progress.json'
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Simple logging to file
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fsSync.appendFileSync('preprocessing.log', logMessage);
}

// Save progress
async function saveProgress(progress) {
  await fs.writeFile(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Load progress
async function loadProgress() {
  try {
    const data = await fs.readFile(CONFIG.PROGRESS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      startedAt: new Date().toISOString(),
      completed: [],
      failed: [],
      stats: {
        totalProcessed: 0,
        datesWithHail: 0,
        totalReports: 0
      }
    };
  }
}

// Get dates for last N days
function getLastNDays(days) {
  const dates = [];
  const today = new Date();
  
  for (let i = 1; i <= days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  return dates;
}

// Process single date
async function processDate(dateStr, attempt = 1) {
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(5, 7);
  const day = dateStr.substring(8, 10);
  
  // URL for daily maximum file (need to use next day's date for 24hr max)
  const nextDate = new Date(dateStr);
  nextDate.setDate(nextDate.getDate() + 1);
  const nextYear = nextDate.getFullYear();
  const nextMonth = String(nextDate.getMonth() + 1).padStart(2, '0');
  const nextDay = String(nextDate.getDate()).padStart(2, '0');
  
  const url = `${CONFIG.BASE_URL}/${nextYear}/${nextMonth}/${nextDay}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${nextYear}${nextMonth}${nextDay}-000000.grib2.gz`;
  
  const gzPath = path.join(CONFIG.TEMP_DIR, `${dateStr}.grib2.gz`);
  const gribPath = path.join(CONFIG.TEMP_DIR, `${dateStr}.grib2`);
  
  try {
    // Download
    log(`Downloading ${dateStr}...`);
    const response = await axios({
      method: 'get',
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
    
    // Process with awk (OKC bounds)
    const { stdout } = await execPromise(
      `grib_get_data ${gribPath} | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9 && $3 >= ${CONFIG.MIN_HAIL_SIZE * 25.4}'`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    // Parse results
    const reports = [];
    const lines = stdout.trim().split('\n');
    
    for (const line of lines) {
      if (!line || line.includes('lat')) continue;
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
          timestamp: new Date(`${dateStr}T12:00:00.000Z`).toISOString(),
          confidence: sizeInches >= 2 ? 85 : sizeInches >= 1 ? 75 : 65,
          city: lat > 35.5 ? 'Edmond' : lat > 35.4 ? 'Oklahoma City' : 'Moore',
          source: 'IEM MRMS Archive',
          meshValue: meshValue
        });
      }
    }
    
    // Save JSON
    const outputData = {
      date: dateStr,
      generated_at: new Date().toISOString(),
      data_source: 'NOAA MRMS 24-hour Maximum',
      bounds: {
        north: 35.7,
        south: 35.1,
        east: -97.1,
        west: -97.8
      },
      reports: reports
    };
    
    const outputPath = path.join(CONFIG.OUTPUT_DIR, `${dateStr}.json`);
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    
    // Cleanup
    try {
      await fs.unlink(gribPath);
    } catch (e) {}
    
    log(`✓ ${dateStr}: ${reports.length} reports`);
    return { success: true, reports: reports.length };
    
  } catch (error) {
    if (attempt < CONFIG.MAX_RETRIES && error.response?.status !== 404) {
      log(`⚠ ${dateStr}: Retry ${attempt}/${CONFIG.MAX_RETRIES}`);
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      return processDate(dateStr, attempt + 1);
    }
    
    log(`✗ ${dateStr}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Main processing function
async function main() {
  log('=== Starting MRMS Preprocessing (Background Mode) ===');
  
  await ensureDirectories();
  
  // Load progress
  const progress = await loadProgress();
  log(`Resuming from previous run...`);
  log(`Already completed: ${progress.completed.length} dates`);
  
  // Get dates to process
  const allDates = getLastNDays(CONFIG.DAYS_TO_PROCESS);
  const datesToProcess = allDates.filter(d => !progress.completed.includes(d));
  
  log(`Total dates to process: ${datesToProcess.length}`);
  log(`Starting processing...`);
  
  const startTime = Date.now();
  let processedCount = 0;
  
  // Process dates sequentially (safer for overnight run)
  for (const date of datesToProcess) {
    const result = await processDate(date);
    
    if (result.success) {
      progress.completed.push(date);
      progress.stats.totalProcessed++;
      if (result.reports > 0) {
        progress.stats.datesWithHail++;
        progress.stats.totalReports += result.reports;
      }
    } else {
      progress.failed.push({ date, error: result.error });
    }
    
    processedCount++;
    
    // Save progress every 10 dates
    if (processedCount % 10 === 0) {
      await saveProgress(progress);
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = processedCount / elapsed;
      const remaining = (datesToProcess.length - processedCount) / rate;
      log(`Progress: ${processedCount}/${datesToProcess.length} (${Math.round(remaining)} minutes remaining)`);
    }
  }
  
  // Final save
  await saveProgress(progress);
  
  const totalTime = (Date.now() - startTime) / 1000 / 60;
  log(`\n=== Processing Complete ===`);
  log(`Total time: ${Math.round(totalTime)} minutes`);
  log(`Processed: ${progress.stats.totalProcessed} dates`);
  log(`Dates with hail: ${progress.stats.datesWithHail}`);
  log(`Total reports: ${progress.stats.totalReports}`);
  log(`Failed: ${progress.failed.length} dates`);
  
  if (progress.failed.length > 0) {
    log(`\nFailed dates:`);
    progress.failed.forEach(f => log(`  - ${f.date}: ${f.error}`));
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});

// Run
main().catch(error => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
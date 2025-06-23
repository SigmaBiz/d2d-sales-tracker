#!/usr/bin/env node

/**
 * Fixed preprocessing script - corrects date offset issue
 * MRMS 24-hour max files contain data FROM the previous day
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
  OUTPUT_DIR: './preprocessed-fixed',
  TEMP_DIR: './temp',
  DAYS_TO_PROCESS: 365,
  MIN_HAIL_SIZE: 0.75, // inches
  BATCH_SIZE: 5,
  MAX_RETRIES: 3,
  PROGRESS_FILE: './preprocess-fixed-progress.json'
};

// Ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
  await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Simple logging
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  fsSync.appendFileSync('preprocessing-fixed.log', logMessage);
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
  // IMPORTANT: The file for dateStr contains data FROM dateStr
  // So May 18th file contains May 17th's storm data
  const fileDate = new Date(dateStr);
  fileDate.setDate(fileDate.getDate() + 1);
  
  const year = fileDate.getFullYear();
  const month = String(fileDate.getMonth() + 1).padStart(2, '0');
  const day = String(fileDate.getDate()).padStart(2, '0');
  
  // URL uses the file date (next day)
  const url = `${CONFIG.BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;
  
  const gzPath = path.join(CONFIG.TEMP_DIR, `${dateStr}.grib2.gz`);
  const gribPath = path.join(CONFIG.TEMP_DIR, `${dateStr}.grib2`);
  
  try {
    // Download
    log(`Downloading data for ${dateStr} (from file ${year}-${month}-${day})...`);
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
    
    // Save JSON with the CORRECT date (the date the storms occurred)
    const outputData = {
      date: dateStr,
      generated_at: new Date().toISOString(),
      data_source: 'NOAA MRMS 24-hour Maximum',
      file_date: `${year}-${month}-${day}`,
      note: `Data from ${dateStr} extracted from file dated ${year}-${month}-${day}`,
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
  log('=== Starting MRMS Preprocessing (Fixed Version) ===');
  log('This version correctly aligns dates with their storm data');
  
  await ensureDirectories();
  
  // Load progress
  const progress = await loadProgress();
  log(`Already completed: ${progress.completed.length} dates`);
  
  // For testing, just process a few key dates
  const testDates = [
    '2025-05-17', // Should have storms (from May 18 file)
    '2025-05-18', // Major storm day (from May 19 file) 
    '2025-05-19', // From May 20 file
    '2025-05-25', // Major storm
    '2025-05-26'  // Major storm
  ];
  
  log(`Processing ${testDates.length} test dates to verify fix...`);
  
  for (const date of testDates) {
    if (!progress.completed.includes(date)) {
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
      
      await saveProgress(progress);
    }
  }
  
  log('\n=== Processing Complete ===');
  log(`Processed: ${progress.stats.totalProcessed} dates`);
  log(`Dates with hail: ${progress.stats.datesWithHail}`);
  log(`Total reports: ${progress.stats.totalReports}`);
  
  // Compare with incorrectly processed data
  log('\n=== Comparison with incorrect data ===');
  for (const date of testDates) {
    try {
      const fixedData = JSON.parse(await fs.readFile(path.join(CONFIG.OUTPUT_DIR, `${date}.json`), 'utf8'));
      const oldData = JSON.parse(await fs.readFile(path.join('./preprocessed', `${date}.json`), 'utf8'));
      
      log(`${date}: Fixed=${fixedData.reports.length} reports, Old=${oldData.reports.length} reports`);
    } catch (e) {
      // Skip if file doesn't exist
    }
  }
}

// Run
if (require.main === module) {
  main().catch(error => {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
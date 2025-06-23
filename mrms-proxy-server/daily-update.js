#!/usr/bin/env node

/**
 * Daily update script for MRMS data
 * Processes yesterday's data and removes data older than 12 months
 */

const fs = require('fs').promises;
const path = require('path');
const { processDate } = require('./preprocess-all.js');

const CONFIG = {
  PREPROCESSED_DIR: './preprocessed',
  RETENTION_DAYS: 365
};

async function dailyUpdate() {
  console.log('MRMS Daily Update');
  console.log('=================');
  console.log(`Run time: ${new Date().toISOString()}\n`);
  
  // Process yesterday's data
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  console.log(`Processing data for: ${yesterdayStr}`);
  
  try {
    const result = await processDate(yesterdayStr);
    
    if (result.success) {
      console.log(`✓ Successfully processed ${yesterdayStr}`);
      console.log(`  Reports: ${result.reports}`);
    } else {
      console.log(`✗ Failed to process ${yesterdayStr}`);
    }
  } catch (error) {
    console.error(`Error processing ${yesterdayStr}:`, error.message);
  }
  
  // Clean up old data
  console.log('\nCleaning up old data...');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.RETENTION_DAYS);
  
  const files = await fs.readdir(CONFIG.PREPROCESSED_DIR);
  let removed = 0;
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const dateStr = file.replace('.json', '');
    const fileDate = new Date(dateStr);
    
    if (fileDate < cutoffDate) {
      await fs.unlink(path.join(CONFIG.PREPROCESSED_DIR, file));
      removed++;
      console.log(`  Removed: ${file}`);
    }
  }
  
  console.log(`✓ Removed ${removed} old files`);
  
  // Generate summary
  const remainingFiles = await fs.readdir(CONFIG.PREPROCESSED_DIR);
  const jsonFiles = remainingFiles.filter(f => f.endsWith('.json'));
  
  console.log('\nSummary:');
  console.log(`- Total dates available: ${jsonFiles.length}`);
  console.log(`- Date range: ${jsonFiles[0]?.replace('.json', '')} to ${jsonFiles[jsonFiles.length - 1]?.replace('.json', '')}`);
  
  console.log('\n✓ Daily update complete');
}

// Run if called directly
if (require.main === module) {
  dailyUpdate().catch(console.error);
}

module.exports = { dailyUpdate };
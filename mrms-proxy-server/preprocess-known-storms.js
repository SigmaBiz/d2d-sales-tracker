#!/usr/bin/env node

/**
 * Preprocess known storm dates
 */

const { processDate } = require('./preprocess-all.js');

async function preprocessKnownStorms() {
  // Known significant storm dates in OKC
  const knownStormDates = [
    '2024-09-24',  // Major storm (we have this)
    '2024-05-06',  // Spring storm
    '2024-04-27',  // April storm
    '2024-04-26',  // April storm
    '2024-03-14',  // Early spring
    '2023-06-18',  // Summer 2023
    '2023-05-12',  // Spring 2023
    '2023-04-19',  // Spring 2023
  ];
  
  console.log('Processing known storm dates...\n');
  
  for (const date of knownStormDates) {
    // Check if already processed
    try {
      await require('fs').promises.stat(`./preprocessed/${date}.json`);
      console.log(`${date} - already processed ✓`);
      continue;
    } catch (e) {
      // Not processed yet
    }
    
    process.stdout.write(`Processing ${date}... `);
    try {
      const result = await processDate(date);
      console.log(`✓ ${result.reports} reports`);
    } catch (error) {
      console.log(`✗ ${error.message}`);
    }
  }
  
  console.log('\nDone!');
}

preprocessKnownStorms().catch(console.error);
#!/usr/bin/env node

/**
 * Process a single date
 */

const { processDate } = require('./preprocess-all.js');

async function processSingle() {
  const date = process.argv[2];
  if (!date) {
    console.error('Usage: node preprocess-single.js YYYY-MM-DD');
    process.exit(1);
  }
  
  console.log(`Processing ${date}...`);
  try {
    const result = await processDate(date);
    console.log(`✓ Success: ${result.reports} reports`);
  } catch (error) {
    console.error(`✗ Failed: ${error.message}`);
    process.exit(1);
  }
}

processSingle().catch(console.error);
#!/usr/bin/env node

/**
 * Quick preprocessing for recent dates to get started
 */

const { processDate } = require('./preprocess-all.js');
const fs = require('fs').promises;

async function preprocessRecent() {
  console.log('Quick preprocessing for last 30 days...\n');
  
  await fs.mkdir('./preprocessed', { recursive: true });
  
  const dates = [];
  for (let i = 1; i <= 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  console.log(`Processing ${dates.length} recent dates...\n`);
  
  let processed = 0;
  let withHail = 0;
  
  for (const date of dates) {
    process.stdout.write(`Processing ${date}... `);
    try {
      const result = await processDate(date);
      processed++;
      if (result.reports > 0) {
        withHail++;
        console.log(`✓ ${result.reports} reports`);
      } else {
        console.log(`✓ no hail`);
      }
    } catch (error) {
      console.log(`✗ ${error.message}`);
    }
  }
  
  console.log(`\n✓ Processed ${processed} dates`);
  console.log(`✓ Found ${withHail} dates with hail`);
  console.log('\nReady for deployment!');
}

preprocessRecent().catch(console.error);
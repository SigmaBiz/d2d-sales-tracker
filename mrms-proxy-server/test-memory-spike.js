#!/usr/bin/env node

/**
 * Test script to identify exactly where memory spikes occur
 * Run this locally to understand the memory profile
 */

const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

// Memory logging utility
class MemoryTracker {
  constructor() {
    this.logs = [];
    this.startTime = Date.now();
  }
  
  log(step) {
    const usage = process.memoryUsage();
    const time = Date.now() - this.startTime;
    this.logs.push({
      step,
      time: `${time}ms`,
      heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
      external: `${Math.round(usage.external / 1024 / 1024)}MB`
    });
    console.log(`[${time}ms] ${step}: Heap=${Math.round(usage.heapUsed / 1024 / 1024)}MB, RSS=${Math.round(usage.rss / 1024 / 1024)}MB`);
  }
  
  report() {
    console.log('\nMemory Profile Summary:');
    console.table(this.logs);
  }
}

async function testGribProcessing() {
  const tracker = new MemoryTracker();
  tracker.log('Start');
  
  try {
    // Use a test GRIB file if available
    const testFiles = await fs.readdir('temp').catch(() => []);
    const gribFile = testFiles.find(f => f.endsWith('.grib2'));
    
    if (!gribFile) {
      console.log('No GRIB2 file found in temp directory');
      console.log('Download one first using the main server');
      return;
    }
    
    const gribPath = path.join('temp', gribFile);
    console.log(`Testing with: ${gribPath}`);
    
    tracker.log('File found');
    
    // Test 1: Just counting lines (should be memory efficient)
    console.log('\nTest 1: Counting lines with wc...');
    const { stdout: lineCount } = await execPromise(
      `grib_get_data ${gribPath} | wc -l`,
      { maxBuffer: 1024 * 1024 } // 1MB buffer
    );
    tracker.log('Line count complete');
    console.log(`Total lines: ${lineCount.trim()}`);
    
    // Test 2: Getting first 1000 lines (minimal memory)
    console.log('\nTest 2: Getting first 1000 lines...');
    const { stdout: sample } = await execPromise(
      `grib_get_data ${gribPath} | head -n 1000`,
      { maxBuffer: 1024 * 1024 }
    );
    tracker.log('Sample complete');
    
    // Test 3: Streaming with spawn (most memory efficient)
    console.log('\nTest 3: Streaming data...');
    await new Promise((resolve, reject) => {
      const proc = spawn('grib_get_data', [gribPath]);
      let linesSeen = 0;
      let okc_points = 0;
      
      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        linesSeen += lines.length;
        
        // Check for OKC data
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            if (lat >= 35.1 && lat <= 35.7 && lon >= 262.2 && lon <= 262.9) {
              okc_points++;
            }
          }
        }
        
        // Log every million lines
        if (linesSeen % 1000000 === 0) {
          tracker.log(`Streamed ${linesSeen / 1000000}M lines`);
        }
      });
      
      proc.on('close', (code) => {
        console.log(`\nFound ${okc_points} OKC points out of ${linesSeen} total`);
        tracker.log('Stream complete');
        resolve();
      });
      
      proc.on('error', reject);
    });
    
    // Test 4: The problematic approach - loading all data
    console.log('\nTest 4: Loading with large buffer (THIS MIGHT SPIKE)...');
    console.log('Press Ctrl+C if memory gets too high!');
    
    try {
      const { stdout: allData } = await execPromise(
        `grib_get_data ${gribPath} | head -n 5000000`, // Only 5M lines for safety
        { maxBuffer: 500 * 1024 * 1024 } // 500MB buffer
      );
      tracker.log('Large buffer complete');
      console.log(`Loaded ${allData.length / 1024 / 1024}MB of text data`);
    } catch (error) {
      tracker.log('Large buffer FAILED');
      console.log('Error:', error.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
  
  tracker.report();
}

// Run the test
console.log('Memory Spike Test for GRIB2 Processing');
console.log('======================================\n');
testGribProcessing();
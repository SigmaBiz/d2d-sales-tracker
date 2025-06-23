#!/usr/bin/env node

/**
 * Comprehensive GRIB2 optimization test
 * Explores every possible way to extract OKC data efficiently
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class MemoryMonitor {
  checkMemory(label) {
    const usage = process.memoryUsage();
    console.log(`[MEMORY] ${label}: RSS=${Math.round(usage.rss/1024/1024)}MB, Heap=${Math.round(usage.heapUsed/1024/1024)}MB`);
    return usage.rss;
  }
}

async function findOptimalApproach() {
  const monitor = new MemoryMonitor();
  console.log('GRIB2 Optimization Test Suite for OKC Metro Extraction\n');
  
  // Find test file
  const tempFiles = await fs.readdir('temp').catch(() => []);
  const gribFile = tempFiles.find(f => f.endsWith('.grib2'));
  
  if (!gribFile) {
    // Download a test file
    console.log('Downloading Sept 24, 2024 test file...');
    const { exec } = require('child_process');
    const url = 'https://mtarchive.geol.iastate.edu/2024/09/25/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_20240925-000000.grib2.gz';
    await execPromise(`cd temp && curl -O ${url} && gunzip -f *.gz`);
    return findOptimalApproach(); // Retry
  }
  
  const gribPath = path.join('temp', gribFile);
  const stats = await fs.stat(gribPath);
  console.log(`Test file: ${gribFile} (${(stats.size/1024/1024).toFixed(2)}MB)\n`);
  
  const results = [];
  
  // Approach 1: Direct constraint with grib_get_data
  console.log('=== Approach 1: Direct Constraints ===');
  monitor.checkMemory('Start');
  try {
    const start = Date.now();
    
    // Test if -w flag works
    const { stdout: test } = await execPromise(
      `grib_get_data -w "latitudeOfFirstGridPointInDegrees>30" ${gribPath} | head -10`,
      { timeout: 5000 }
    );
    
    if (test.includes('Latitude')) {
      console.log('✓ Constraint flag -w is supported');
      
      // Try OKC bounds
      const { stdout: lineCount } = await execPromise(
        `grib_get_data -w "latitudeOfFirstGridPointInDegrees>=35.1" ${gribPath} | wc -l`,
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
      );
      
      const elapsed = Date.now() - start;
      results.push({
        approach: 'Direct constraints',
        time: elapsed,
        memory: monitor.checkMemory('After constraints'),
        success: true,
        lines: parseInt(lineCount)
      });
    }
  } catch (error) {
    console.log('✗ Direct constraints not supported:', error.message);
  }
  
  // Approach 2: Two-stage with grib_copy
  console.log('\n=== Approach 2: Two-Stage Processing ===');
  try {
    const start = Date.now();
    const subsetFile = path.join('temp', 'okc_subset.grib2');
    
    // Create subset first
    await execPromise(
      `grib_copy -w "latitudeOfFirstGridPointInDegrees>=30" ${gribPath} ${subsetFile}`,
      { timeout: 30000 }
    );
    
    const subsetStats = await fs.stat(subsetFile);
    console.log(`Subset size: ${(subsetStats.size/1024/1024).toFixed(2)}MB`);
    
    // Process subset
    const { stdout } = await execPromise(
      `grib_get_data ${subsetFile} | awk '$1>=35.1 && $1<=35.7 && $2>=262.2 && $2<=262.9' | wc -l`
    );
    
    const elapsed = Date.now() - start;
    results.push({
      approach: 'Two-stage (grib_copy)',
      time: elapsed,
      memory: monitor.checkMemory('After two-stage'),
      success: true,
      lines: parseInt(stdout)
    });
    
  } catch (error) {
    console.log('✗ Two-stage failed:', error.message);
  }
  
  // Approach 3: Stream processing with early termination
  console.log('\n=== Approach 3: Stream with Early Exit ===');
  try {
    const start = Date.now();
    let okcPoints = 0;
    let totalLines = 0;
    
    await new Promise((resolve, reject) => {
      const proc = spawn('grib_get_data', [gribPath]);
      let buffer = '';
      
      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line
        
        for (const line of lines) {
          totalLines++;
          
          // Only process lines that might be OKC
          if (totalLines > 13000000 && totalLines < 14000000) {
            const parts = line.split(/\s+/);
            if (parts.length >= 3) {
              const lat = parseFloat(parts[0]);
              if (lat >= 35.1 && lat <= 35.7) {
                const lon = parseFloat(parts[1]);
                if (lon >= 262.2 && lon <= 262.9) {
                  okcPoints++;
                }
              }
            }
          }
          
          // Early exit after OKC region
          if (totalLines > 14000000) {
            proc.kill();
            resolve();
            return;
          }
        }
      });
      
      proc.on('close', resolve);
      proc.on('error', reject);
    });
    
    const elapsed = Date.now() - start;
    results.push({
      approach: 'Stream with early exit',
      time: elapsed,
      memory: monitor.checkMemory('After streaming'),
      success: true,
      lines: okcPoints
    });
    
  } catch (error) {
    console.log('✗ Streaming failed:', error.message);
  }
  
  // Approach 4: Index-based extraction
  console.log('\n=== Approach 4: Index-Based Extraction ===');
  try {
    const start = Date.now();
    const indexFile = path.join('temp', 'okc.idx');
    
    // Build index
    await execPromise(
      `grib_index_build -k latitude,longitude -o ${indexFile} ${gribPath}`,
      { timeout: 30000 }
    );
    
    console.log('✓ Index built successfully');
    
    // Query index (this part might need adjustment)
    const elapsed = Date.now() - start;
    results.push({
      approach: 'Index-based',
      time: elapsed,
      memory: monitor.checkMemory('After indexing'),
      success: true,
      note: 'Index created, query method TBD'
    });
    
  } catch (error) {
    console.log('✗ Indexing failed:', error.message);
  }
  
  // Approach 5: Smart line extraction with skip
  console.log('\n=== Approach 5: Skip-based Extraction ===');
  try {
    const start = Date.now();
    
    // Skip first 13M lines, read 600k, stop
    const { stdout } = await execPromise(
      `grib_get_data ${gribPath} | tail -n +13400000 | head -n 600000 | awk '$1>=35.1 && $1<=35.7 && $2>=262.2 && $2<=262.9' | wc -l`,
      { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );
    
    const elapsed = Date.now() - start;
    results.push({
      approach: 'Skip-based (tail+head)',
      time: elapsed,
      memory: monitor.checkMemory('After skip-based'),
      success: true,
      lines: parseInt(stdout)
    });
    
  } catch (error) {
    console.log('✗ Skip-based failed:', error.message);
  }
  
  // Summary
  console.log('\n=== OPTIMIZATION RESULTS ===');
  console.table(results.map(r => ({
    Approach: r.approach,
    'Time (ms)': r.time,
    'Memory (MB)': Math.round(r.memory / 1024 / 1024),
    'Success': r.success ? '✓' : '✗',
    'Lines/Notes': r.lines || r.note || 'N/A'
  })));
  
  // Recommendation
  const fastest = results.reduce((min, r) => r.time < min.time ? r : min, results[0]);
  console.log(`\nRecommended approach: ${fastest.approach} (${fastest.time}ms)`);
}

// Run the test
console.log('Starting comprehensive GRIB2 optimization test...\n');
findOptimalApproach().catch(console.error);
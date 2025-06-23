#!/usr/bin/env node

/**
 * Isolated memory test for GRIB2 extraction
 * Measures only the memory used by our extraction process
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function measureExtractionMemory() {
  console.log('Isolated Memory Test for GRIB2 Extraction');
  console.log('========================================\n');
  
  // Find GRIB file
  const dirs = ['temp', '.', 'cache'];
  let gribFile = null;
  
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      const grib = files.find(f => f.endsWith('.grib2'));
      if (grib) {
        gribFile = path.join(dir, grib);
        break;
      }
    } catch (e) {}
  }
  
  if (!gribFile) {
    console.log('No GRIB2 file found. Please ensure one exists in temp/ directory');
    return;
  }
  
  console.log(`Using file: ${gribFile}`);
  const stats = fs.statSync(gribFile);
  console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);
  
  // Test different approaches
  const tests = [
    {
      name: 'Direct awk filter (no line counting)',
      command: `grib_get_data ${gribFile} | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9' | wc -l`
    },
    {
      name: 'Skip-based (tail+head)',
      command: `grib_get_data ${gribFile} | tail -n +13400000 | head -n 600000 | wc -l`
    },
    {
      name: 'Skip-based with awk filter',
      command: `grib_get_data ${gribFile} | tail -n +13400000 | head -n 600000 | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9' | wc -l`
    }
  ];
  
  for (const test of tests) {
    console.log(`\nTesting: ${test.name}`);
    console.log('-'.repeat(50));
    
    await new Promise((resolve) => {
      const startTime = Date.now();
      let peakMemory = 0;
      let output = '';
      
      // Use /usr/bin/time to measure memory
      const proc = spawn('/usr/bin/time', ['-l', 'sh', '-c', test.command], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      // Monitor our Node process memory too
      const nodeMonitor = setInterval(() => {
        const usage = process.memoryUsage();
        const nodeMB = Math.round(usage.rss / 1024 / 1024);
        if (nodeMB > peakMemory) peakMemory = nodeMB;
      }, 100);
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      let timeOutput = '';
      proc.stderr.on('data', (data) => {
        timeOutput += data.toString();
      });
      
      proc.on('close', (code) => {
        clearInterval(nodeMonitor);
        const elapsed = Date.now() - startTime;
        
        console.log(`Result: ${output.trim()} lines found`);
        console.log(`Time: ${elapsed}ms`);
        
        // Parse memory usage from time command
        const memMatch = timeOutput.match(/(\d+)\s+maximum resident set size/);
        if (memMatch) {
          const maxMemBytes = parseInt(memMatch[1]);
          const maxMemMB = maxMemBytes / 1024 / 1024;
          console.log(`Peak memory (extraction): ${maxMemMB.toFixed(0)} MB`);
        }
        
        console.log(`Peak memory (Node.js): ${peakMemory} MB`);
        console.log(`Exit code: ${code}`);
        
        if (code !== 0) {
          console.log('❌ FAILED - Process was likely killed');
        } else {
          console.log('✅ SUCCESS');
        }
        
        resolve();
      });
    });
  }
  
  // Now test memory in a container-like environment
  console.log('\n\nContainer Simulation Test');
  console.log('=========================\n');
  
  console.log('Testing with memory limit simulation...');
  
  // Create a script that monitors its own memory
  const monitorScript = `
    const { spawn } = require('child_process');
    const gribFile = '${gribFile}';
    
    let peakRSS = 0;
    const monitor = setInterval(() => {
      const mem = process.memoryUsage();
      if (mem.rss > peakRSS) peakRSS = mem.rss;
    }, 50);
    
    const proc = spawn('sh', ['-c', 
      'grib_get_data ' + gribFile + ' | tail -n +13400000 | head -n 600000 | awk \\'$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9\\' | wc -l'
    ]);
    
    let result = '';
    proc.stdout.on('data', d => result += d);
    
    proc.on('close', code => {
      clearInterval(monitor);
      console.log('Lines found:', result.trim());
      console.log('Peak Node RSS:', Math.round(peakRSS/1024/1024), 'MB');
      console.log('Exit code:', code);
      
      // Try to measure total system impact
      require('child_process').exec('ps aux | awk \\'{sum+=$6} END {print sum/1024}\\'', (err, stdout) => {
        if (!err) console.log('System memory:', Math.round(parseFloat(stdout)), 'MB');
        process.exit(code);
      });
    });
  `;
  
  fs.writeFileSync('memory-test.js', monitorScript);
  
  await new Promise((resolve) => {
    const proc = spawn('node', ['memory-test.js'], { stdio: 'inherit' });
    proc.on('close', resolve);
  });
  
  // Cleanup
  try {
    fs.unlinkSync('memory-test.js');
  } catch (e) {}
  
  console.log('\n\nFINAL ASSESSMENT');
  console.log('================\n');
  
  console.log('Based on the tests above:');
  console.log('1. Look at the peak memory for each approach');
  console.log('2. If any test shows "Exit code: 137" or "FAILED", that approach won\'t work');
  console.log('3. The successful approach with lowest memory is your best bet');
  console.log('\nFor Render paid tier (2GB):');
  console.log('- If peak memory < 1800MB: ✅ Will work');
  console.log('- If peak memory > 1800MB: ❌ Won\'t work');
  console.log('- Leave ~200MB headroom for OS and other processes');
}

// Run the test
measureExtractionMemory().catch(console.error);
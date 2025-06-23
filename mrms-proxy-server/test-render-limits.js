#!/usr/bin/env node

/**
 * Comprehensive test to determine if we'll exceed Render's paid tier limits
 * Tests: Memory, CPU time, process limits, file I/O, and timeout constraints
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class RenderLimitTester {
  constructor() {
    this.results = {
      memory: {},
      cpu: {},
      io: {},
      time: {},
      processes: {},
      overall: {}
    };
    this.peakMemory = 0;
    this.startTime = Date.now();
  }

  // Monitor memory continuously
  startMemoryMonitor() {
    this.memoryInterval = setInterval(() => {
      const usage = process.memoryUsage();
      const totalMB = (usage.rss + usage.external) / 1024 / 1024;
      if (totalMB > this.peakMemory) {
        this.peakMemory = totalMB;
      }
    }, 100); // Check every 100ms
  }

  stopMemoryMonitor() {
    clearInterval(this.memoryInterval);
  }

  // Get system-wide memory usage
  async getSystemMemory() {
    try {
      const { stdout } = await execPromise('ps aux | awk \'{sum+=$6} END {print sum/1024}\'');
      return parseFloat(stdout.trim());
    } catch (e) {
      return 0;
    }
  }

  // Test 1: Memory usage during full extraction
  async testMemoryUsage() {
    console.log('\n=== TEST 1: Memory Usage Analysis ===');
    
    const gribFile = await this.findGribFile();
    if (!gribFile) {
      console.log('❌ No GRIB file found for testing');
      return;
    }

    this.startMemoryMonitor();
    const memBefore = await this.getSystemMemory();
    
    console.log('Testing skip-based extraction memory usage...');
    
    try {
      // Simulate the exact command we'll use
      const startMem = process.memoryUsage();
      console.log(`Initial: RSS=${Math.round(startMem.rss/1024/1024)}MB`);
      
      // Test 1a: Peak memory during extraction
      const proc = spawn('sh', ['-c', 
        `grib_get_data ${gribFile} | tail -n +13400000 | head -n 600000 | wc -l`
      ]);
      
      let peakDuringExtraction = 0;
      const monitorExtraction = setInterval(async () => {
        const currentMem = await this.getSystemMemory();
        if (currentMem > peakDuringExtraction) {
          peakDuringExtraction = currentMem;
        }
      }, 100);
      
      await new Promise((resolve, reject) => {
        proc.on('close', resolve);
        proc.on('error', reject);
      });
      
      clearInterval(monitorExtraction);
      const memAfter = await this.getSystemMemory();
      
      this.results.memory = {
        nodePeak: this.peakMemory,
        systemBefore: memBefore,
        systemPeak: peakDuringExtraction,
        systemAfter: memAfter,
        extractionCost: peakDuringExtraction - memBefore,
        status: peakDuringExtraction < 1800 ? 'PASS' : 'FAIL'
      };
      
      console.log(`\nMemory Results:`);
      console.log(`- System memory before: ${memBefore.toFixed(0)}MB`);
      console.log(`- System memory peak: ${peakDuringExtraction.toFixed(0)}MB`);
      console.log(`- Extraction memory cost: ${(peakDuringExtraction - memBefore).toFixed(0)}MB`);
      console.log(`- Would fit in 2GB? ${this.results.memory.status}`);
      
    } catch (error) {
      console.log('❌ Memory test failed:', error.message);
      this.results.memory.status = 'ERROR';
    }
    
    this.stopMemoryMonitor();
  }

  // Test 2: CPU time limits
  async testCPUTime() {
    console.log('\n=== TEST 2: CPU Time Analysis ===');
    
    const gribFile = await this.findGribFile();
    if (!gribFile) return;
    
    console.log('Measuring CPU time for extraction...');
    
    try {
      // Test processing time
      const start = Date.now();
      const { stdout } = await execPromise(
        `time -p sh -c 'grib_get_data ${gribFile} | tail -n +13400000 | head -n 600000 | wc -l'`,
        { timeout: 60000 }
      );
      
      const elapsed = Date.now() - start;
      
      this.results.cpu = {
        realTime: elapsed,
        status: elapsed < 30000 ? 'PASS' : 'FAIL', // 30s limit
        note: elapsed > 30000 ? 'May hit request timeout' : 'Within limits'
      };
      
      console.log(`\nCPU Time Results:`);
      console.log(`- Total processing time: ${elapsed}ms`);
      console.log(`- Status: ${this.results.cpu.status}`);
      
    } catch (error) {
      if (error.killed && error.signal === 'SIGTERM') {
        this.results.cpu.status = 'TIMEOUT';
        console.log('❌ Process timed out (>60s)');
      } else {
        this.results.cpu.status = 'ERROR';
      }
    }
  }

  // Test 3: File I/O limits
  async testFileIO() {
    console.log('\n=== TEST 3: File I/O Analysis ===');
    
    try {
      // Test download speed
      console.log('Testing download speed...');
      const downloadStart = Date.now();
      await execPromise(
        'curl -s -o /tmp/test.gz https://mtarchive.geol.iastate.edu/2024/09/25/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_20240925-000000.grib2.gz'
      );
      const downloadTime = Date.now() - downloadStart;
      
      // Test extraction speed
      console.log('Testing extraction speed...');
      const extractStart = Date.now();
      await execPromise('gunzip -f /tmp/test.gz');
      const extractTime = Date.now() - extractStart;
      
      // Test disk space
      const { stdout: diskSpace } = await execPromise('df -BM /tmp | tail -1');
      const availableMB = parseInt(diskSpace.split(/\s+/)[3]);
      
      this.results.io = {
        downloadTime,
        extractTime,
        diskSpaceMB: availableMB,
        status: availableMB > 1000 ? 'PASS' : 'FAIL'
      };
      
      console.log(`\nI/O Results:`);
      console.log(`- Download time: ${downloadTime}ms`);
      console.log(`- Extract time: ${extractTime}ms`);
      console.log(`- Available disk: ${availableMB}MB`);
      console.log(`- Status: ${this.results.io.status}`);
      
      // Cleanup
      await execPromise('rm -f /tmp/test*').catch(() => {});
      
    } catch (error) {
      console.log('❌ I/O test failed:', error.message);
      this.results.io.status = 'ERROR';
    }
  }

  // Test 4: Process limits
  async testProcessLimits() {
    console.log('\n=== TEST 4: Process Limits Analysis ===');
    
    try {
      // Count current processes
      const { stdout: psCount } = await execPromise('ps aux | wc -l');
      const currentProcesses = parseInt(psCount.trim());
      
      // Test spawning multiple processes (our pipeline uses 4-5)
      console.log('Testing process spawning...');
      const procs = [];
      for (let i = 0; i < 5; i++) {
        procs.push(spawn('sleep', ['1']));
      }
      
      // Wait for all to complete
      await Promise.all(procs.map(p => new Promise(resolve => p.on('close', resolve))));
      
      this.results.processes = {
        current: currentProcesses,
        spawned: 5,
        status: 'PASS'
      };
      
      console.log(`\nProcess Results:`);
      console.log(`- Current processes: ${currentProcesses}`);
      console.log(`- Can spawn required processes: YES`);
      
    } catch (error) {
      console.log('❌ Process test failed:', error.message);
      this.results.processes.status = 'FAIL';
    }
  }

  // Test 5: Full pipeline simulation
  async testFullPipeline() {
    console.log('\n=== TEST 5: Full Pipeline Simulation ===');
    
    const gribFile = await this.findGribFile();
    if (!gribFile) return;
    
    console.log('Simulating complete extraction pipeline...');
    
    const pipelineStart = Date.now();
    const initialMem = await this.getSystemMemory();
    let peakMem = initialMem;
    
    // Monitor memory during pipeline
    const monitor = setInterval(async () => {
      const current = await this.getSystemMemory();
      if (current > peakMem) peakMem = current;
    }, 100);
    
    try {
      // Step 1: Download (simulated as already done)
      console.log('✓ Download complete (using existing file)');
      
      // Step 2: Extract with memory monitoring
      console.log('Extracting OKC data...');
      const { stdout } = await execPromise(
        `grib_get_data ${gribFile} | tail -n +13400000 | head -n 600000 | awk '$1 >= 35.1 && $1 <= 35.7 && $2 >= 262.2 && $2 <= 262.9' | wc -l`,
        { 
          timeout: 60000,
          maxBuffer: 50 * 1024 * 1024
        }
      );
      
      const okcPoints = parseInt(stdout.trim());
      console.log(`✓ Found ${okcPoints} OKC points`);
      
      // Step 3: Check final state
      clearInterval(monitor);
      const elapsed = Date.now() - pipelineStart;
      const memoryUsed = peakMem - initialMem;
      
      this.results.overall = {
        success: true,
        okcPoints,
        totalTime: elapsed,
        peakMemory: peakMem,
        memoryIncrease: memoryUsed,
        fitsIn2GB: peakMem < 1800,
        fitsIn30s: elapsed < 30000
      };
      
      console.log(`\nPipeline Results:`);
      console.log(`- Total time: ${elapsed}ms`);
      console.log(`- Peak memory: ${peakMem.toFixed(0)}MB`);
      console.log(`- Memory increase: ${memoryUsed.toFixed(0)}MB`);
      console.log(`- Fits in 2GB RAM? ${peakMem < 1800 ? 'YES' : 'NO'}`);
      console.log(`- Completes in 30s? ${elapsed < 30000 ? 'YES' : 'NO'}`);
      
    } catch (error) {
      clearInterval(monitor);
      this.results.overall = {
        success: false,
        error: error.message,
        timedOut: error.killed && error.signal === 'SIGTERM'
      };
      console.log('❌ Pipeline failed:', error.message);
    }
  }

  // Helper to find GRIB file
  async findGribFile() {
    const dirs = ['temp', '.', 'cache'];
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        const grib = files.find(f => f.endsWith('.grib2'));
        if (grib) return path.join(dir, grib);
      } catch (e) {}
    }
    return null;
  }

  // Generate final report
  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('FINAL ASSESSMENT: Will it work on Render Paid Tier (2GB)?');
    console.log('='.repeat(60) + '\n');
    
    const checks = [
      {
        name: 'Memory Usage',
        pass: this.results.memory.status === 'PASS',
        detail: `Peak: ${this.results.memory.systemPeak?.toFixed(0) || '?'}MB / 2048MB`
      },
      {
        name: 'CPU Time',
        pass: this.results.cpu.status === 'PASS',
        detail: `Time: ${this.results.cpu.realTime || '?'}ms / 30000ms`
      },
      {
        name: 'Disk I/O',
        pass: this.results.io.status === 'PASS',
        detail: `Space: ${this.results.io.diskSpaceMB || '?'}MB available`
      },
      {
        name: 'Process Limits',
        pass: this.results.processes.status === 'PASS',
        detail: 'Can spawn required processes'
      },
      {
        name: 'Full Pipeline',
        pass: this.results.overall.success && this.results.overall.fitsIn2GB && this.results.overall.fitsIn30s,
        detail: this.results.overall.success ? 'Completes successfully' : 'Failed'
      }
    ];
    
    // Print results table
    console.log('Test Results:');
    console.log('-'.repeat(50));
    checks.forEach(check => {
      const status = check.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`${check.name.padEnd(20)} ${status}  ${check.detail}`);
    });
    console.log('-'.repeat(50));
    
    // Overall verdict
    const allPass = checks.every(c => c.pass);
    console.log('\n🎯 VERDICT:');
    if (allPass) {
      console.log('✅ YES - The $7/month upgrade WILL work!');
      console.log('\nKey metrics:');
      console.log(`- Peak memory: ~${this.results.memory.systemPeak?.toFixed(0) || '?'}MB (well under 2GB limit)`);
      console.log(`- Processing time: ~${(this.results.cpu.realTime/1000)?.toFixed(1) || '?'}s (under 30s timeout)`);
    } else {
      console.log('❌ NO - The upgrade may NOT be sufficient');
      console.log('\nIssues found:');
      checks.filter(c => !c.pass).forEach(c => {
        console.log(`- ${c.name}: ${c.detail}`);
      });
    }
    
    // Save detailed results
    const reportPath = './render-limits-report.json';
    fs.writeFile(reportPath, JSON.stringify(this.results, null, 2))
      .then(() => console.log(`\nDetailed report saved to: ${reportPath}`))
      .catch(() => {});
  }

  // Run all tests
  async runAllTests() {
    console.log('Render Paid Tier Compatibility Test');
    console.log('==================================');
    console.log('Testing if $7/month upgrade (2GB RAM) will work...\n');
    
    await this.testMemoryUsage();
    await this.testCPUTime();
    await this.testFileIO();
    await this.testProcessLimits();
    await this.testFullPipeline();
    
    this.generateReport();
  }
}

// Run tests
if (require.main === module) {
  const tester = new RenderLimitTester();
  tester.runAllTests().catch(console.error);
}

module.exports = RenderLimitTester;
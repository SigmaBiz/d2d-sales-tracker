#!/usr/bin/env node

const { spawn } = require('child_process');

// Test different approaches to handle large line numbers
console.log('Testing AWK approaches for large line numbers...\n');

// Approach 1: Direct awk (what we're using)
function testDirectAwk() {
  console.log('1. Testing direct awk approach:');
  const cmd = spawn('sh', ['-c', 
    `seq 1 15000000 | awk 'NR==1 || (NR>=13400000 && NR<=13400010)'`
  ]);
  
  let output = '';
  cmd.stdout.on('data', (data) => output += data);
  cmd.stderr.on('data', (data) => console.error('Error:', data.toString()));
  
  cmd.on('close', (code) => {
    console.log('Exit code:', code);
    console.log('Output:', output.trim());
    console.log('---\n');
    
    // Test approach 2
    testTailHead();
  });
}

// Approach 2: tail + head combination
function testTailHead() {
  console.log('2. Testing tail + head approach:');
  const cmd = spawn('sh', ['-c', 
    `seq 1 15000000 | tail -n +13400000 | head -n 11`
  ]);
  
  let output = '';
  cmd.stdout.on('data', (data) => output += data);
  cmd.stderr.on('data', (data) => console.error('Error:', data.toString()));
  
  cmd.on('close', (code) => {
    console.log('Exit code:', code);
    console.log('Output:', output.trim());
    console.log('---\n');
    
    // Test approach 3
    testPureNode();
  });
}

// Approach 3: Pure Node.js line counting
function testPureNode() {
  console.log('3. Testing pure Node.js approach:');
  const cmd = spawn('seq', ['1', '15000000']);
  const readline = require('readline');
  
  const rl = readline.createInterface({
    input: cmd.stdout,
    crlfDelay: Infinity
  });
  
  let lineCount = 0;
  const results = [];
  
  rl.on('line', (line) => {
    lineCount++;
    if (lineCount === 1 || (lineCount >= 13400000 && lineCount <= 13400010)) {
      results.push(line);
    }
    if (lineCount > 13400010) {
      rl.close();
      cmd.kill();
    }
  });
  
  rl.on('close', () => {
    console.log('Lines processed:', lineCount);
    console.log('Output:', results.join(','));
    console.log('---\n');
    
    // Test ecCodes command
    testEcCodes();
  });
}

// Test ecCodes availability
function testEcCodes() {
  console.log('4. Testing ecCodes availability:');
  const cmd = spawn('sh', ['-c', 'which grib_get_data && grib_get_data -V 2>&1 || echo "grib_get_data not found"']);
  
  let output = '';
  cmd.stdout.on('data', (data) => output += data);
  cmd.stderr.on('data', (data) => output += data);
  
  cmd.on('close', (code) => {
    console.log('Output:', output.trim());
    console.log('---\n');
  });
}

// Start tests
testDirectAwk();
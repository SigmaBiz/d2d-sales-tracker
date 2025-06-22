/**
 * Process manager to run both servers in one container
 */
const { spawn } = require('child_process');

console.log('Starting D2D MRMS Servers...');

// Start dynamic server
const dynamicServer = spawn('node', ['server-dynamic.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: '3002' }
});

// Start real-time server
const realtimeServer = spawn('node', ['server-realtime.js'], {
  stdio: 'inherit', 
  env: { ...process.env, PORT: '3003' }
});

// Handle exit
process.on('SIGTERM', () => {
  console.log('Shutting down servers...');
  dynamicServer.kill();
  realtimeServer.kill();
  process.exit(0);
});

// Keep process alive
setInterval(() => {}, 1000);
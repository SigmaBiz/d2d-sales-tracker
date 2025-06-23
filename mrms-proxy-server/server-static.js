/**
 * Static MRMS Server - Serves pre-processed JSON files
 * Ultra-fast, ultra-reliable, zero processing
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  PREPROCESSED_DIR: path.join(__dirname, 'preprocessed'),
  PORT: process.env.PORT || 3002,
  CACHE_CONTROL: 'public, max-age=86400' // Cache for 24 hours
};

// Health check endpoint
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'mrms-static-server',
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB'
    },
    mode: 'static-preprocessed',
    performance: 'instant (<10ms response time)'
  });
});

// List available dates
app.get('/api/mesh/available', async (req, res) => {
  try {
    const files = await fs.readdir(CONFIG.PREPROCESSED_DIR);
    const dates = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort()
      .reverse();
    
    res.json({
      dates,
      count: dates.length,
      mode: 'preprocessed'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list available dates' });
  }
});

// Main MESH endpoint - just serve the file!
app.get('/api/mesh/:date', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate date format
    const dateMatch = req.params.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Construct file path
    const filePath = path.join(CONFIG.PREPROCESSED_DIR, `${req.params.date}.json`);
    
    // Check if file exists
    try {
      await fs.stat(filePath);
    } catch (e) {
      return res.status(404).json({ 
        error: 'No data available for this date',
        date: req.params.date,
        suggestion: 'Try /api/mesh/available to see available dates'
      });
    }
    
    // Read and serve the file
    const data = await fs.readFile(filePath, 'utf8');
    const json = JSON.parse(data);
    
    // Add response metadata
    json.cached = true;
    json.responseTime = Date.now() - startTime + 'ms';
    
    // Set cache headers for client-side caching
    res.set('Cache-Control', CONFIG.CACHE_CONTROL);
    res.json(json);
    
  } catch (error) {
    console.error('Error serving data:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve MESH data',
      details: error.message
    });
  }
});

// Get date range
app.get('/api/mesh/range/:startDate/:endDate', async (req, res) => {
  try {
    const start = new Date(req.params.startDate);
    const end = new Date(req.params.endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const results = [];
    const current = new Date(start);
    
    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      const filePath = path.join(CONFIG.PREPROCESSED_DIR, `${dateStr}.json`);
      
      try {
        const data = await fs.readFile(filePath, 'utf8');
        const json = JSON.parse(data);
        if (json.reports && json.reports.length > 0) {
          results.push({
            date: dateStr,
            reports: json.reports.length,
            maxSize: json.summary.maxSize
          });
        }
      } catch (e) {
        // File doesn't exist or no data
      }
      
      current.setDate(current.getDate() + 1);
    }
    
    res.json({
      startDate: req.params.startDate,
      endDate: req.params.endDate,
      datesWithHail: results.length,
      results
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to process date range' });
  }
});

// Summary statistics
app.get('/api/mesh/stats', async (req, res) => {
  try {
    const files = await fs.readdir(CONFIG.PREPROCESSED_DIR);
    let totalReports = 0;
    let datesWithHail = 0;
    let largestStorm = { date: null, reports: 0 };
    let maxHail = { date: null, size: 0 };
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const data = JSON.parse(
        await fs.readFile(path.join(CONFIG.PREPROCESSED_DIR, file), 'utf8')
      );
      
      if (data.reports && data.reports.length > 0) {
        totalReports += data.reports.length;
        datesWithHail++;
        
        if (data.reports.length > largestStorm.reports) {
          largestStorm = {
            date: data.date,
            reports: data.reports.length
          };
        }
        
        if (data.summary.maxSize > maxHail.size) {
          maxHail = {
            date: data.date,
            size: data.summary.maxSize
          };
        }
      }
    }
    
    res.json({
      totalDates: files.length,
      datesWithHail,
      totalReports,
      averageReportsPerStorm: datesWithHail > 0 ? Math.round(totalReports / datesWithHail) : 0,
      largestStorm,
      maxHail
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate statistics' });
  }
});

// Start server
async function start() {
  // Verify preprocessed directory exists
  try {
    await fs.stat(CONFIG.PREPROCESSED_DIR);
  } catch (e) {
    console.error(`ERROR: Preprocessed directory not found at ${CONFIG.PREPROCESSED_DIR}`);
    console.error('Run preprocess-all.js first to generate the data files.');
    process.exit(1);
  }
  
  const files = await fs.readdir(CONFIG.PREPROCESSED_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  
  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`MRMS Static Server running on port ${CONFIG.PORT}`);
    console.log(`Serving ${jsonFiles.length} pre-processed dates`);
    console.log('Mode: Ultra-fast static file serving');
    console.log('Response time: <10ms');
    console.log('Memory usage: Minimal');
    console.log('Processing: None - just serving files!');
  });
}

start().catch(console.error);
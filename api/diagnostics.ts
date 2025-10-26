/**
 * Diagnostics & Health Check Endpoint
 * Verifies eccodes installation and system capabilities
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    // Check eccodes installation
    let eccodesVersion = 'not installed';
    let eccodesStatus = 'missing';

    try {
      const { stdout } = await execPromise('grib_get_data --version 2>&1');
      eccodesVersion = stdout.trim();
      eccodesStatus = 'installed';
    } catch (error) {
      console.log('eccodes not found:', error);
    }

    // Check node version
    const nodeVersion = process.version;

    // Check available memory
    const memoryUsage = process.memoryUsage();

    // Test date parsing (UTC-based)
    const testDate = '2024-09-24';
    const parsedDate = new Date(testDate + 'T00:00:00Z');

    // Check environment variables
    const hasR2Credentials = !!(
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET_NAME
    );

    // Build diagnostic response
    const diagnostics = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'd2d-hail-tracker-serverless',
      version: '1.0.0',
      environment: {
        nodeVersion,
        platform: process.platform,
        arch: process.arch
      },
      eccodes: {
        status: eccodesStatus,
        version: eccodesVersion,
        available: eccodesStatus === 'installed'
      },
      memory: {
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`
      },
      dateHandling: {
        testDate,
        parsed: parsedDate.toISOString(),
        method: 'UTC-based (timezone bug fixed)'
      },
      r2Cache: {
        configured: hasR2Credentials,
        status: hasR2Credentials ? 'ready' : 'missing credentials'
      },
      capabilities: {
        grib2Processing: eccodesStatus === 'installed',
        r2Caching: hasR2Credentials,
        spcPreFiltering: true
      },
      dataflow: {
        tier1: 'Real-time MRMS (future)',
        tier2: 'Historical IEM Archive GRIB2 (active)',
        tier3: 'SPC Storm Reports Pre-filter (active)'
      }
    };

    // Set cache headers (cache for 5 minutes)
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

    return res.status(200).json(diagnostics);

  } catch (error) {
    console.error('Diagnostics error:', error);

    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

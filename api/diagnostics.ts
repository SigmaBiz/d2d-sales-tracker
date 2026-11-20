/**
 * Diagnostics & Health Check Endpoint
 * Verifies eccodes installation and system capabilities
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
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
      // eccodes is deliberately ABSENT here. GRIB2 decoding needs a system
      // binary that cannot run in a serverless function (see mesh/[date].ts) —
      // it runs on the GitHub Actions runner, which installs libeccodes-tools.
      // This endpoint used to shell out to `grib_get_data --version` and log a
      // scary stack trace on every call for a capability it is not supposed to
      // have. Removed: it was pure noise that misdirects debugging.
      grib2: {
        runsHere: false,
        runsOn: 'github-actions (hail-swath.yml → libeccodes-tools)'
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
      // The branch the swath workflow is dispatched on. NOT a secret — and
      // exposing it is the point: the dispatch silently 404s when this names a
      // ref the workflow file isn't on, which is how the pipeline sat dead for
      // months. Readable config beats an encrypted value nobody can check.
      swathDispatch: {
        ref: process.env.GITHUB_WORKFLOW_REF || 'main (default)',
        repo: process.env.GITHUB_REPO ? 'set' : 'MISSING',
        token: process.env.GITHUB_ACTIONS_TOKEN ? 'set' : 'MISSING'
      },
      calendar: {
        configured: !!(
          process.env.GOOGLE_OAUTH_CLIENT_ID &&
          process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
          process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
        )
      },
      r2Cache: {
        configured: hasR2Credentials,
        status: hasR2Credentials ? 'ready' : 'missing credentials'
      },
      capabilities: {
        grib2Processing: false, // by design — see grib2 above
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

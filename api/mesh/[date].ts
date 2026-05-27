/**
 * MESH Data Endpoint - Hail Swath Map Data
 *
 * Flow:
 * 1. Check R2 cache → return immediately if cached
 * 2. Check SPC pre-filter → return empty result if no significant hail that day
 * 3. Return 404 with instructions to run local preprocessor
 *
 * GRIB2 processing does NOT happen here. eccodes is a system binary that cannot
 * run in Vercel's Node environment. Populate R2 by running locally:
 *   npm run preprocess <date>   (e.g. npm run preprocess 2024-09-24)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// Configuration
const OKC_METRO_BOUNDS = {
  north: 35.7,
  south: 35.1,
  east: -97.1,
  west: -97.8
};

// R2 Client (S3-compatible)
const r2Client = process.env.R2_ACCESS_KEY_ID ? new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!
  }
}) : null;

interface MESHResponse {
  date: string;
  generated_at: string;
  data_source: string;
  bounds: typeof OKC_METRO_BOUNDS;
  reports: unknown[];
  summary: {
    totalReports: number;
    maxSize: number;
    avgSize: number;
  };
  cached?: boolean;
  responseTime?: string;
  spcPreFilter?: {
    checked: boolean;
    hadSignificantHail: boolean | null;
    spcReports: number;
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();

  const { date } = req.query;

  // Validate date format
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: 'Invalid date format. Use YYYY-MM-DD',
      received: date
    });
  }

  const requestedDate = new Date(date + 'T00:00:00Z');
  if (isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date value', received: date });
  }

  console.log(`[MESH] Request for ${date}`);

  // STEP 1: Check R2 cache
  if (r2Client) {
    try {
      const cacheKey = `mesh/${date}.json`;
      const response = await r2Client.send(new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: cacheKey
      }));
      const cached = JSON.parse(await response.Body!.transformToString());

      console.log(`[MESH] Cache HIT for ${date}`);

      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      res.setHeader('X-Cache-Status', 'HIT');

      return res.status(200).json({
        ...cached,
        cached: true,
        responseTime: `${Date.now() - startTime}ms`
      });

    } catch {
      console.log(`[MESH] Cache MISS for ${date}`);
    }
  }

  // STEP 2: SPC pre-filter — skip if SPC confirms no significant hail that day
  let spcPreFilter = {
    checked: false,
    hadSignificantHail: null as boolean | null,
    spcReports: 0
  };

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const spcResponse = await axios.get(
      `${proto}://${host}/api/spc/check-date?date=${date}`,
      { timeout: 5000 }
    );

    spcPreFilter = {
      checked: true,
      hadSignificantHail: spcResponse.data.hasOKCMetroHail,
      spcReports: spcResponse.data.okcMetroReports || 0
    };

    console.log(`[MESH] SPC: ${spcPreFilter.hadSignificantHail ? 'significant hail' : 'no significant hail'}`);

    if (spcPreFilter.hadSignificantHail === false) {
      const emptyResult: MESHResponse = {
        date,
        generated_at: new Date().toISOString(),
        data_source: 'SPC Pre-filter (no significant hail this date)',
        bounds: OKC_METRO_BOUNDS,
        reports: [],
        summary: { totalReports: 0, maxSize: 0, avgSize: 0 },
        spcPreFilter,
        responseTime: `${Date.now() - startTime}ms`
      };

      // Cache the empty result so we don't re-query SPC repeatedly
      if (r2Client) {
        await cacheToR2(date, emptyResult);
      }

      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
      res.setHeader('X-SPC-Prefilter', 'no-significant-hail');

      return res.status(200).json(emptyResult);
    }

  } catch (err) {
    console.log(`[MESH] SPC pre-filter unavailable, continuing:`, err);
  }

  // STEP 3: Cache cold — no GRIB2 processing available in this environment
  console.log(`[MESH] No cached data for ${date} — GRIB2 processing not available serverside`);

  res.setHeader('X-Cache-Status', 'COLD');

  return res.status(404).json({
    error: 'MESH data not yet processed for this date',
    date,
    instructions: `Run locally: npm run preprocess ${date}`,
    detail: 'GRIB2 processing requires eccodes (system binary) and runs on your Mac, not in this serverless function. The preprocessor uploads results to R2, after which this endpoint will serve them instantly.',
    spcPreFilter
  });
}

/**
 * Cache result to R2
 */
async function cacheToR2(date: string, data: MESHResponse): Promise<void> {
  if (!r2Client) return;

  try {
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: `mesh/${date}.json`,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    console.log(`[MESH] Cached to R2: mesh/${date}.json`);
  } catch (err) {
    console.error('[MESH] R2 cache write failed:', err);
  }
}

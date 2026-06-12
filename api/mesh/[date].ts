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
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Configuration — Oklahoma statewide (was OKC metro; widened 2026-06-12)
const OK_BOUNDS = {
  north: 37.0,
  south: 33.6,
  east: -94.4,
  west: -103.0
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
  bounds: typeof OK_BOUNDS;
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

      // 10 min, not 24h: dates can be REPROCESSED (e.g. statewide re-runs) and
      // the CDN must not mask the fresh R2 object for a day.
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
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

    // Statewide flag (hasOKHail); falls back to the metro flag if the SPC
    // endpoint hasn't been redeployed yet.
    spcPreFilter = {
      checked: true,
      hadSignificantHail: spcResponse.data.hasOKHail ?? spcResponse.data.hasOKCMetroHail,
      spcReports: spcResponse.data.okReports ?? spcResponse.data.okcMetroReports ?? 0
    };

    console.log(`[MESH] SPC: ${spcPreFilter.hadSignificantHail ? 'significant hail' : 'no significant hail'}`);

    if (spcPreFilter.hadSignificantHail === false) {
      // NEVER write this empty result to R2: the workflow writes the real
      // swath to the same key, and a pre-filter false-negative (or a request
      // racing the workflow) used to permanently poison the date with an
      // empty object (this is what hid the 2026-06-11 El Reno storm).
      const emptyResult: MESHResponse = {
        date,
        generated_at: new Date().toISOString(),
        data_source: 'SPC Pre-filter (no significant hail this date)',
        bounds: OK_BOUNDS,
        reports: [],
        summary: { totalReports: 0, maxSize: 0, avgSize: 0 },
        spcPreFilter,
        responseTime: `${Date.now() - startTime}ms`
      };

      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
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

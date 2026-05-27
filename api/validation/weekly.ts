/**
 * Tier 3 — Weekly Ground Truth Validation
 *
 * Called by Vercel cron weekly (or manually via GET /api/validation/weekly).
 *
 * Flow:
 * 1. Fetch IEM Local Storm Reports for OKC Metro — past 30 days, hail >= 0.75"
 *    (IEM LSR is JSON, no GRIB2 or CSV parsing required)
 * 2. Group reports by date → unique storm dates
 * 3. For each date: check R2 for cached MESH data
 * 4. Log to Supabase:
 *    - Missing dates → "unprocessed_storm_event" (operator should run preprocessor)
 *    - Present dates → compare LSR hail locations to MESH reports, log accuracy score
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

// OKC Metro bounds (same as preprocessor)
const OKC_BOUNDS = { north: 35.7, south: 35.1, east: -97.1, west: -97.8 };

// IEM NWS offices covering OKC Metro
const OKC_NWS_OFFICES = ['OUN', 'TSA']; // Norman + Tulsa (for edge cases)

const MIN_HAIL_INCHES = 0.75;

// Match radius in degrees (≈ 5 miles)
const MATCH_RADIUS_DEG = 0.07;

function getR2Client() {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT } = process.env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) return null;

  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
  });
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key);
}

interface LSRReport {
  valid: string;       // ISO timestamp
  lat: number;
  lon: number;
  magnitude: number;   // hail size in inches
  city: string;
  county: string;
  remark: string;
}

interface MeshReport {
  latitude: number;
  longitude: number;
  size: number;
}

/**
 * Fetch IEM Local Storm Reports (hail) for a date range and NWS office.
 * API: https://mesonet.agron.iastate.edu/json/lsr.php
 */
async function fetchLSRReports(wfo: string, startISO: string, endISO: string): Promise<LSRReport[]> {
  const url = 'https://mesonet.agron.iastate.edu/json/lsr.php';
  const response = await axios.get<{ results: any[] }>(url, {
    params: { wfo, sts: startISO, ets: endISO, phenomena: 'H' }, // H = hail
    timeout: 10000,
    headers: { 'User-Agent': 'D2D-Sales-Tracker/1.0' }
  });

  return (response.data.results || [])
    .filter((r: any) => {
      const mag = parseFloat(r.magnitude);
      if (isNaN(mag) || mag < MIN_HAIL_INCHES) return false;
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      return lat >= OKC_BOUNDS.south && lat <= OKC_BOUNDS.north &&
             lon >= OKC_BOUNDS.west  && lon <= OKC_BOUNDS.east;
    })
    .map((r: any) => ({
      valid: r.valid,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      magnitude: parseFloat(r.magnitude),
      city: r.city || '',
      county: r.county || '',
      remark: r.remark || '',
    }));
}

/**
 * Check R2 for MESH data on a given date.
 * Returns the parsed reports array, or null if not cached.
 */
async function fetchMeshFromR2(r2: S3Client, date: string): Promise<MeshReport[] | null> {
  try {
    const response = await r2.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: `mesh/${date}.json`,
    }));
    const body = await response.Body!.transformToString();
    const data = JSON.parse(body);
    return data.reports || [];
  } catch {
    return null; // Cache miss or R2 not configured
  }
}

/**
 * Calculate accuracy: for each LSR report, check if a MESH report exists nearby.
 * Returns hit rate (0–1).
 */
function calculateAccuracy(lsrReports: LSRReport[], meshReports: MeshReport[]): number {
  if (lsrReports.length === 0) return 1;

  let hits = 0;
  for (const lsr of lsrReports) {
    const matched = meshReports.some(mesh =>
      Math.abs(mesh.latitude - lsr.lat) <= MATCH_RADIUS_DEG &&
      Math.abs(mesh.longitude - lsr.lon) <= MATCH_RADIUS_DEG
    );
    if (matched) hits++;
  }
  return hits / lsrReports.length;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[Validation] Weekly check triggered');

  const supabase = getSupabase();
  const r2 = getR2Client();

  if (!r2) {
    return res.status(503).json({ error: 'R2 not configured — set R2_* env vars' });
  }

  // Look back 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  // 1. Fetch LSR hail reports from IEM for OKC Metro
  let allLSR: LSRReport[] = [];
  for (const wfo of OKC_NWS_OFFICES) {
    try {
      const reports = await fetchLSRReports(wfo, startISO, endISO);
      allLSR.push(...reports);
      console.log(`[Validation] ${reports.length} LSR hail reports from ${wfo}`);
    } catch (err) {
      console.warn(`[Validation] Failed to fetch LSR from ${wfo}:`, err);
    }
  }

  // 2. Group by date (YYYY-MM-DD)
  const byDate = new Map<string, LSRReport[]>();
  for (const report of allLSR) {
    // LSR timestamps are in UTC; storm date = day of event (Oklahoma is UTC-5/6)
    const utcDate = new Date(report.valid);
    // Adjust to Oklahoma local time (CDT = UTC-5, CST = UTC-6)
    const oklahomaNoon = new Date(utcDate.getTime() - 6 * 3600 * 1000);
    const date = oklahomaNoon.toISOString().split('T')[0];

    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(report);
  }

  console.log(`[Validation] LSR hail events on ${byDate.size} unique dates`);

  // 3. For each storm date, check R2 and log results
  const results: {
    date: string;
    lsrCount: number;
    status: 'processed' | 'unprocessed';
    accuracy?: number;
    maxLSRSize?: number;
  }[] = [];

  for (const [date, lsrReports] of byDate.entries()) {
    const meshReports = await fetchMeshFromR2(r2, date);
    const maxLSRSize = Math.max(...lsrReports.map(r => r.magnitude));

    if (meshReports === null) {
      // No MESH data — this is a gap we need to fill
      console.log(`[Validation] UNPROCESSED: ${date} (${lsrReports.length} LSR reports, max ${maxLSRSize}")`);

      await supabase.from('validation_log').upsert({
        date,
        status: 'unprocessed',
        lsr_count: lsrReports.length,
        max_lsr_size: maxLSRSize,
        accuracy_score: null,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'date' });

      results.push({ date, lsrCount: lsrReports.length, status: 'unprocessed', maxLSRSize });

    } else {
      // MESH data exists — calculate accuracy
      const accuracy = calculateAccuracy(lsrReports, meshReports);
      console.log(`[Validation] PROCESSED: ${date} — accuracy ${(accuracy * 100).toFixed(0)}% (${lsrReports.length} LSR vs ${meshReports.length} MESH)`);

      await supabase.from('validation_log').upsert({
        date,
        status: 'processed',
        lsr_count: lsrReports.length,
        max_lsr_size: maxLSRSize,
        mesh_count: meshReports.length,
        accuracy_score: accuracy,
        checked_at: new Date().toISOString(),
      }, { onConflict: 'date' });

      results.push({ date, lsrCount: lsrReports.length, status: 'processed', accuracy, maxLSRSize });
    }
  }

  const unprocessed = results.filter(r => r.status === 'unprocessed');
  const processed = results.filter(r => r.status === 'processed');
  const avgAccuracy = processed.length > 0
    ? processed.reduce((s, r) => s + (r.accuracy ?? 0), 0) / processed.length
    : null;

  console.log(`[Validation] Done. ${processed.length} processed, ${unprocessed.length} unprocessed.`);
  if (avgAccuracy !== null) {
    console.log(`[Validation] Average MESH accuracy: ${(avgAccuracy * 100).toFixed(1)}%`);
  }

  return res.status(200).json({
    period: {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    },
    totalLSRReports: allLSR.length,
    stormDates: byDate.size,
    processed: processed.length,
    unprocessed: unprocessed.length,
    avgAccuracy: avgAccuracy !== null ? Math.round(avgAccuracy * 1000) / 10 : null,
    unprocessedDates: unprocessed.map(r => r.date).sort(),
    results: results.sort((a, b) => a.date.localeCompare(b.date)),
  });
}

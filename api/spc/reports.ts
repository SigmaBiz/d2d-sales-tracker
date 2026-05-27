/**
 * SPC Hail Reports Endpoint — Tier 3
 *
 * Returns spotter/observer hail reports for a given date as HailReport objects
 * ready to render as dots on the map.
 *
 * Data source: SPC Storm Reports CSV (same-day, ~1-2hr delay after storm)
 * URL pattern: https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_hail.csv
 *
 * These are ground-truth sightings (human observers, trained spotters, EM).
 * confidence is always 100 — if a person reported it, it happened.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

// OKC Metro bounds
const OKC_METRO_BOUNDS = {
  north: 35.7,
  south: 35.1,
  east: -97.1,
  west: -97.8
};

// Broader Oklahoma bounds (for returning statewide context if needed)
const OK_BOUNDS = {
  north: 37.0,
  south: 33.6,
  east: -94.4,
  west: -103.0
};

// Minimum hail size to return (quarter-inch — anything smaller isn't relevant for roofing)
const MIN_HAIL_INCHES = 0.75;

interface SPCRow {
  Time?: string;
  Size?: string;
  Location?: string;
  County?: string;
  State?: string;
  Lat?: string;
  Lon?: string;
  Comments?: string;
  [key: string]: string | undefined;
}

interface HailReportResponse {
  id: string;
  latitude: number;
  longitude: number;
  size: number;
  timestamp: string; // ISO string — mobile converts to Date
  confidence: number;
  city: string;
  county: string;
  isMetroOKC: boolean;
  source: string;
  groundTruth: boolean;
  comments: string;
}

/**
 * Parse SPC size field.
 * SPC encodes size two ways:
 *   "200" = 2.00 inches (integer hundredths)
 *   "2.00" = 2.00 inches (already decimal)
 */
function parseSPCSize(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.toString().trim();
  if (!s) return 0;
  if (s.includes('.')) return parseFloat(s);
  return parseInt(s, 10) / 100;
}

/**
 * Build timestamp from SPC time field (HHMM UTC) and the date string (YYYY-MM-DD).
 */
function buildTimestamp(dateStr: string, timeRaw: string | undefined): string {
  const time = (timeRaw || '0000').toString().padStart(4, '0');
  const hh = time.slice(0, 2);
  const mm = time.slice(2, 4);
  return `${dateStr}T${hh}:${mm}:00Z`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { date, statewide } = req.query;

  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: 'Invalid date format. Use YYYY-MM-DD',
      received: date
    });
  }

  const [year, month, day] = date.split('-');
  const shortYear = year.slice(2);
  const spcDate = `${shortYear}${month}${day}`;

  // SPC has two CSVs per day:
  //   _rpts_hail.csv          — all hail reports
  //   _rpts_filtered_hail.csv — significant hail only (1"+ typically)
  // We want all reports so canvassers see even marginal hail areas.
  const urls = [
    `https://www.spc.noaa.gov/climo/reports/${spcDate}_rpts_hail.csv`,
    `https://www.spc.noaa.gov/climo/reports/${spcDate}_rpts_filtered_hail.csv`,
  ];

  let rawCsv: string | null = null;
  let usedUrl = '';

  for (const url of urls) {
    try {
      const response = await axios.get<string>(url, {
        timeout: 10000,
        responseType: 'text',
        headers: { 'User-Agent': 'D2D-Sales-Tracker/1.0 (hail canvassing tool)' }
      });
      rawCsv = response.data;
      usedUrl = url;
      console.log(`[SPC Reports] Fetched from ${url} — ${rawCsv.length} bytes`);
      break;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        console.log(`[SPC Reports] 404 at ${url}, trying next`);
        continue;
      }
      console.error(`[SPC Reports] Error fetching ${url}:`, err);
    }
  }

  if (!rawCsv) {
    // No SPC data for this date — could be too recent or too old
    return res.status(200).json({
      date,
      source: 'SPC Storm Reports',
      reports: [],
      total: 0,
      okcMetroTotal: 0,
      note: 'No SPC data available for this date. Data is typically available within 24 hours of a storm.'
    });
  }

  // Parse CSV
  let records: SPCRow[] = [];
  try {
    records = parse(rawCsv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as SPCRow[];
  } catch (parseErr) {
    console.error('[SPC Reports] CSV parse error:', parseErr);
    return res.status(500).json({ error: 'Failed to parse SPC CSV', detail: String(parseErr) });
  }

  console.log(`[SPC Reports] ${records.length} total rows for ${date}`);

  // Filter and convert to HailReport format
  const allOK: HailReportResponse[] = [];
  const okcMetro: HailReportResponse[] = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];

    const lat = parseFloat(row.Lat || '');
    const lon = parseFloat(row.Lon || '');
    const size = parseSPCSize(row.Size);
    const state = (row.State || '').trim().toUpperCase();

    // Skip non-OK, missing coords, or below threshold
    if (state !== 'OK') continue;
    if (isNaN(lat) || isNaN(lon)) continue;
    if (size < MIN_HAIL_INCHES) continue;

    // Must be within Oklahoma bounds
    if (lat < OK_BOUNDS.south || lat > OK_BOUNDS.north ||
        lon < OK_BOUNDS.west || lon > OK_BOUNDS.east) continue;

    const isMetroOKC = (
      lat >= OKC_METRO_BOUNDS.south && lat <= OKC_METRO_BOUNDS.north &&
      lon >= OKC_METRO_BOUNDS.west && lon <= OKC_METRO_BOUNDS.east
    );

    const report: HailReportResponse = {
      id: `SPC_${spcDate}_${i}`,
      latitude: lat,
      longitude: lon,
      size,
      timestamp: buildTimestamp(date, row.Time),
      confidence: 100, // Human-observed ground truth
      city: row.Location || 'Unknown',
      county: row.County || '',
      isMetroOKC,
      source: 'SPC Storm Reports',
      groundTruth: true,
      comments: row.Comments || ''
    };

    allOK.push(report);
    if (isMetroOKC) okcMetro.push(report);
  }

  // By default return OKC Metro only. Pass ?statewide=1 to get all Oklahoma.
  const returnAll = statewide === '1' || statewide === 'true';
  const reports = returnAll ? allOK : okcMetro;

  console.log(`[SPC Reports] ${okcMetro.length} OKC Metro reports, ${allOK.length} total OK reports`);

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
  res.setHeader('X-SPC-Source', usedUrl);

  return res.status(200).json({
    date,
    source: 'SPC Storm Reports',
    reports,
    total: allOK.length,
    okcMetroTotal: okcMetro.length,
    filtered: !returnAll,
    bounds: returnAll ? OK_BOUNDS : OKC_METRO_BOUNDS
  });
}

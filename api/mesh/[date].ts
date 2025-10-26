/**
 * MESH Data Endpoint - Main Hail Swath Data
 * Processes GRIB2 files from IEM Archive to create hail swath maps
 *
 * Flow:
 * 1. Check R2 cache (instant return if cached)
 * 2. Check SPC pre-filter (skip GRIB2 if no significant hail)
 * 3. Download GRIB2 from IEM Archive
 * 4. Decode with eccodes
 * 5. Filter to OKC Metro bounds
 * 6. Cache in R2 (permanent)
 * 7. Return JSON
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { createWriteStream } from 'fs';
import { unlink, stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import os from 'os';

const execPromise = promisify(exec);

// Configuration
const CONFIG = {
  IEM_BASE_URL: 'https://mtarchive.geol.iastate.edu',
  OKC_METRO_BOUNDS: {
    north: 35.7,    // North of Edmond
    south: 35.1,    // South of Norman
    east: -97.1,    // East of Midwest City
    west: -97.8     // West of Yukon
  },
  MIN_HAIL_SIZE: 0.75, // 0.75 inches minimum
  TEMP_DIR: os.tmpdir()
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

interface HailReport {
  id: string;
  latitude: number;
  longitude: number;
  size: number;
  timestamp: string;
  confidence: number;
  city: string;
  source: string;
  meshValue: number;
}

interface MESHResponse {
  date: string;
  generated_at: string;
  data_source: string;
  bounds: typeof CONFIG.OKC_METRO_BOUNDS;
  reports: HailReport[];
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

  try {
    const { date } = req.query;

    // Validate date format
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'Invalid date format. Use YYYY-MM-DD',
        received: date
      });
    }

    // Parse date (UTC-based to avoid timezone bugs)
    const requestedDate = new Date(date + 'T00:00:00Z');

    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date value',
        received: date
      });
    }

    // Validate date is within reasonable range
    const now = new Date();
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    if (requestedDate < twelveMonthsAgo || requestedDate > now) {
      return res.status(400).json({
        error: 'Date must be within the last 12 months',
        minDate: twelveMonthsAgo.toISOString().split('T')[0],
        maxDate: now.toISOString().split('T')[0]
      });
    }

    console.log(`[MESH] Processing request for ${date}`);

    // STEP 1: Check R2 cache
    if (r2Client) {
      try {
        const cacheKey = `mesh/${date}.json`;
        const command = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Key: cacheKey
        });

        const response = await r2Client.send(command);
        const cachedData = await response.Body!.transformToString();
        const data = JSON.parse(cachedData);

        console.log(`[MESH] Cache HIT for ${date}`);

        const responseTime = `${Date.now() - startTime}ms`;

        // Set cache headers
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        res.setHeader('X-Cache-Status', 'HIT');

        return res.status(200).json({
          ...data,
          cached: true,
          responseTime
        });

      } catch (cacheError) {
        console.log(`[MESH] Cache MISS for ${date}`);
        // Continue to processing
      }
    }

    // STEP 2: Check SPC pre-filter
    let spcPreFilter = {
      checked: false,
      hadSignificantHail: null as boolean | null,
      spcReports: 0
    };

    try {
      const spcResponse = await axios.get(
        `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/spc/check-date?date=${date}`,
        { timeout: 5000 }
      );

      spcPreFilter = {
        checked: true,
        hadSignificantHail: spcResponse.data.hasOKCMetroHail,
        spcReports: spcResponse.data.okcMetroReports || 0
      };

      console.log(`[MESH] SPC Pre-filter: ${spcPreFilter.hadSignificantHail ? 'Significant hail detected' : 'No significant hail'}`);

      // If SPC explicitly shows no significant hail, return empty result (don't waste time on GRIB2)
      if (spcPreFilter.hadSignificantHail === false) {
        const emptyResult: MESHResponse = {
          date,
          generated_at: new Date().toISOString(),
          data_source: 'SPC Pre-filter (no GRIB2 processing needed)',
          bounds: CONFIG.OKC_METRO_BOUNDS,
          reports: [],
          summary: {
            totalReports: 0,
            maxSize: 0,
            avgSize: 0
          },
          spcPreFilter,
          responseTime: `${Date.now() - startTime}ms`
        };

        // Cache empty result too (prevents repeated queries)
        if (r2Client) {
          await cacheToR2(date, emptyResult);
        }

        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
        res.setHeader('X-SPC-Prefilter', 'no-significant-hail');

        return res.status(200).json(emptyResult);
      }

    } catch (spcError) {
      console.log(`[MESH] SPC pre-filter failed, continuing with GRIB2 processing:`, spcError);
      // Continue to GRIB2 processing even if SPC check fails
    }

    // STEP 3: Process GRIB2 data
    console.log(`[MESH] Fetching and processing GRIB2 for ${date}...`);

    const meshData = await fetchAndProcessMESH(requestedDate);

    const result: MESHResponse = {
      date,
      generated_at: new Date().toISOString(),
      data_source: 'NOAA MRMS 24-hour Maximum',
      bounds: CONFIG.OKC_METRO_BOUNDS,
      reports: meshData.reports,
      summary: {
        totalReports: meshData.reports.length,
        maxSize: meshData.reports.length > 0
          ? Math.max(...meshData.reports.map(r => r.size))
          : 0,
        avgSize: meshData.reports.length > 0
          ? meshData.reports.reduce((sum, r) => sum + r.size, 0) / meshData.reports.length
          : 0
      },
      spcPreFilter,
      responseTime: `${Date.now() - startTime}ms`
    };

    console.log(`[MESH] Processed ${result.summary.totalReports} reports in ${result.responseTime}`);

    // STEP 4: Cache in R2
    if (r2Client) {
      await cacheToR2(date, result);
    }

    // Set cache headers
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.setHeader('X-Cache-Status', 'MISS');
    res.setHeader('X-SPC-Prefilter', spcPreFilter.hadSignificantHail ? 'significant-hail-detected' : 'unknown');

    return res.status(200).json(result);

  } catch (error) {
    console.error('[MESH] Error:', error);

    return res.status(500).json({
      error: 'Failed to process MESH data',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Fetch and process MESH GRIB2 data from IEM Archive
 */
async function fetchAndProcessMESH(date: Date): Promise<{ reports: HailReport[] }> {
  // Format date for IEM URL (use next day UTC file for local Oklahoma dates)
  const utcDate = new Date(date.toISOString().split('T')[0] + 'T00:00:00Z');
  const nextDay = new Date(utcDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const year = nextDay.getUTCFullYear();
  const month = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nextDay.getUTCDate()).padStart(2, '0');

  // MESH_Max_1440min = 24-hour maximum hail size
  const url = `${CONFIG.IEM_BASE_URL}/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${year}${month}${day}-000000.grib2.gz`;

  console.log(`[MESH] Downloading from: ${url}`);

  const fileName = path.basename(url);
  const gzPath = path.join(CONFIG.TEMP_DIR, `mesh_${Date.now()}_${fileName}`);
  const gribPath = gzPath.replace('.gz', '');

  try {
    // Check eccodes
    try {
      await execPromise('which grib_get_data');
    } catch {
      throw new Error('eccodes not installed. GRIB2 processing unavailable.');
    }

    // Download GRIB2.gz file
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'D2D-Sales-Tracker/1.0 (Hail Intelligence System)'
      }
    });

    await pipeline(response.data, createWriteStream(gzPath));
    console.log(`[MESH] Downloaded: ${gzPath}`);

    // Decompress
    await execPromise(`gunzip -f "${gzPath}"`);
    console.log(`[MESH] Decompressed: ${gribPath}`);

    // Verify file exists and has size
    const stats = await stat(gribPath);
    console.log(`[MESH] GRIB2 file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Extract OKC Metro data using eccodes
    const reports = await extractOKCMetroData(gribPath, date);

    return { reports };

  } finally {
    // Cleanup temp files
    try {
      await unlink(gribPath);
    } catch {}
    try {
      await unlink(gzPath);
    } catch {}
  }
}

/**
 * Extract MESH data for OKC Metro area using eccodes
 */
async function extractOKCMetroData(gribPath: string, date: Date): Promise<HailReport[]> {
  console.log('[MESH] Extracting OKC Metro data with eccodes...');

  const reports: HailReport[] = [];

  try {
    // Use grib_get_data to extract all points
    // Note: We filter in-memory because grib_get_data doesn't support geographic subsetting
    const { stdout } = await execPromise(
      `grib_get_data "${gribPath}"`,
      { maxBuffer: 100 * 1024 * 1024 } // 100MB buffer for large output
    );

    const lines = stdout.split('\n');
    let headerSkipped = false;

    console.log(`[MESH] Processing ${lines.length} lines of GRIB2 data...`);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip header
      if (!headerSkipped) {
        if (trimmed.includes('Latitude') || trimmed.includes('lat')) {
          headerSkipped = true;
        }
        continue;
      }

      // Parse: latitude longitude value
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const lat = parseFloat(parts[0]);
        let lon = parseFloat(parts[1]);
        const meshMM = parseFloat(parts[2]); // MESH value in mm

        // Skip invalid
        if (isNaN(lat) || isNaN(lon) || isNaN(meshMM) || meshMM <= 0) {
          continue;
        }

        // Convert longitude from 0-360 to -180-180 if needed
        if (lon > 180) {
          lon = lon - 360;
        }

        // Filter to OKC Metro bounds
        if (lat >= CONFIG.OKC_METRO_BOUNDS.south &&
            lat <= CONFIG.OKC_METRO_BOUNDS.north &&
            lon >= CONFIG.OKC_METRO_BOUNDS.west &&
            lon <= CONFIG.OKC_METRO_BOUNDS.east) {

          const sizeInches = meshMM / 25.4; // Convert mm to inches

          // Only include significant hail
          if (sizeInches >= CONFIG.MIN_HAIL_SIZE) {
            reports.push({
              id: `mesh_${date.getTime()}_${reports.length}`,
              latitude: lat,
              longitude: lon,
              size: Math.round(sizeInches * 100) / 100,
              timestamp: date.toISOString(),
              confidence: calculateConfidence(sizeInches),
              city: getCityName(lat, lon),
              source: 'IEM MRMS Archive',
              meshValue: meshMM
            });
          }
        }
      }
    }

    console.log(`[MESH] Extracted ${reports.length} hail reports >= ${CONFIG.MIN_HAIL_SIZE}"`);

    return reports;

  } catch (error) {
    console.error('[MESH] eccodes extraction error:', error);
    throw new Error(`Failed to extract GRIB2 data: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * Calculate confidence score based on hail size
 */
function calculateConfidence(sizeInches: number): number {
  if (sizeInches >= 2.0) return 95;
  if (sizeInches >= 1.5) return 90;
  if (sizeInches >= 1.25) return 85;
  if (sizeInches >= 1.0) return 80;
  return 75;
}

/**
 * Get city name from coordinates
 */
function getCityName(lat: number, lon: number): string {
  const cities = [
    { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164, radius: 0.15 },
    { name: 'Edmond', lat: 35.6529, lon: -97.4779, radius: 0.1 },
    { name: 'Moore', lat: 35.3395, lon: -97.4867, radius: 0.08 },
    { name: 'Norman', lat: 35.2226, lon: -97.4395, radius: 0.1 },
    { name: 'Midwest City', lat: 35.4495, lon: -97.3967, radius: 0.08 },
    { name: 'Yukon', lat: 35.5067, lon: -97.7625, radius: 0.08 }
  ];

  for (const city of cities) {
    const distance = Math.sqrt(
      Math.pow(lat - city.lat, 2) + Math.pow(lon - city.lon, 2)
    );
    if (distance <= city.radius) {
      return city.name;
    }
  }

  return 'OKC Metro';
}

/**
 * Cache result to R2
 */
async function cacheToR2(date: string, data: MESHResponse): Promise<void> {
  if (!r2Client) {
    console.log('[MESH] R2 not configured, skipping cache');
    return;
  }

  try {
    const cacheKey = `mesh/${date}.json`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: cacheKey,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=31536000, immutable' // Cache forever (historical data doesn't change)
    });

    await r2Client.send(command);
    console.log(`[MESH] Cached to R2: ${cacheKey}`);

  } catch (error) {
    console.error('[MESH] R2 cache error:', error);
    // Don't fail the request if caching fails
  }
}

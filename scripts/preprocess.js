#!/usr/bin/env node
/**
 * MRMS MESH GRIB2 Local Preprocessor
 *
 * Runs on your Mac (eccodes installed, no memory limits).
 * Decodes a GRIB2 file, extracts OKC Metro hail data, uploads JSON to R2.
 *
 * Usage:
 *   node scripts/preprocess.js <grib2-file-path> [date]
 *   node scripts/preprocess.js 2024-09-24           (downloads from NCEP if available)
 *
 * Examples:
 *   node scripts/preprocess.js mrms-proxy-server/temp/MESH_Max_1440min_00.50_20240925-000000.grib2 2024-09-24
 *   node scripts/preprocess.js 2024-09-24
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
// Use the aws-sdk installed in api/node_modules
const { S3Client, PutObjectCommand } = require(path.join(__dirname, '../api/node_modules/@aws-sdk/client-s3'));
// Load .env from project root if present
try { require(path.join(__dirname, '../api/node_modules/dotenv')).config({ path: path.join(__dirname, '../.env') }); } catch {}

// ─── Configuration ────────────────────────────────────────────────────────────

const OKC_BOUNDS = {
  north: 35.7,
  south: 35.1,
  east:  -97.1,
  west:  -97.8
};

const MIN_HAIL_INCHES = 0.75;

const CITIES = [
  { name: 'Edmond',       lat: 35.6529, lon: -97.4779, radius: 0.12 },
  { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164, radius: 0.18 },
  { name: 'Moore',        lat: 35.3395, lon: -97.4867, radius: 0.09 },
  { name: 'Norman',       lat: 35.2226, lon: -97.4395, radius: 0.12 },
  { name: 'Midwest City', lat: 35.4495, lon: -97.3967, radius: 0.09 },
  { name: 'Yukon',        lat: 35.5067, lon: -97.7625, radius: 0.09 },
  { name: 'Mustang',      lat: 35.3845, lon: -97.7245, radius: 0.08 },
  { name: 'Newcastle',    lat: 35.2426, lon: -97.5987, radius: 0.08 },
  { name: 'Bethany',      lat: 35.5184, lon: -97.6336, radius: 0.07 },
  { name: 'Del City',     lat: 35.4426, lon: -97.4406, radius: 0.07 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCityName(lat, lon) {
  for (const city of CITIES) {
    const dist = Math.sqrt(Math.pow(lat - city.lat, 2) + Math.pow(lon - city.lon, 2));
    if (dist <= city.radius) return city.name;
  }
  return 'OKC Metro';
}

function getConfidence(inches) {
  if (inches >= 2.0)  return 95;
  if (inches >= 1.5)  return 90;
  if (inches >= 1.25) return 85;
  if (inches >= 1.0)  return 80;
  return 75;
}

function checkEccodes() {
  try {
    execSync('which grib_get_data', { stdio: 'ignore' });
  } catch {
    console.error('ERROR: eccodes not found. Install with: brew install eccodes');
    process.exit(1);
  }
}

// ─── GRIB2 Parsing ────────────────────────────────────────────────────────────

function parseGrib2(gribPath, dateStr) {
  return new Promise((resolve, reject) => {
    console.log(`[preprocess] Running grib_get_data on ${path.basename(gribPath)}...`);

    const proc = spawn('grib_get_data', [gribPath]);
    const reports = [];
    let buffer = '';
    let headerSkipped = false;
    let lineCount = 0;
    let reportId = 0;

    const date = new Date(dateStr + 'T12:00:00Z'); // noon local approx

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        lineCount++;
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (!headerSkipped) {
          if (trimmed.startsWith('Latitude') || trimmed.startsWith('lat')) {
            headerSkipped = true;
          }
          continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 3) continue;

        const lat    = parseFloat(parts[0]);
        const lonRaw = parseFloat(parts[1]);
        const meshMM = parseFloat(parts[2]);

        if (isNaN(lat) || isNaN(lonRaw) || isNaN(meshMM) || meshMM <= 0) continue;

        // Convert 0-360 longitude to -180-180
        const lon = lonRaw > 180 ? lonRaw - 360 : lonRaw;

        // Filter to OKC Metro
        if (lat < OKC_BOUNDS.south || lat > OKC_BOUNDS.north) continue;
        if (lon < OKC_BOUNDS.west  || lon > OKC_BOUNDS.east)  continue;

        const inches = meshMM / 25.4;
        if (inches < MIN_HAIL_INCHES) continue;

        reports.push({
          id:         `mesh_${date.getTime()}_${reportId++}`,
          latitude:   Math.round(lat * 10000) / 10000,
          longitude:  Math.round(lon * 10000) / 10000,
          size:       Math.round(inches * 100) / 100,
          meshValue:  meshMM,
          timestamp:  date.toISOString(),
          confidence: getConfidence(inches),
          city:       getCityName(lat, lon),
          source:     'NOAA MRMS MESH (local preprocessor)'
        });
      }
    });

    proc.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.warn(`[grib_get_data] ${msg}`);
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        return reject(new Error(`grib_get_data exited with code ${code}`));
      }
      console.log(`[preprocess] Scanned ${lineCount.toLocaleString()} lines → ${reports.length} OKC hail reports >= ${MIN_HAIL_INCHES}"`);
      resolve(reports);
    });

    proc.on('error', reject);
  });
}

// ─── R2 Upload ────────────────────────────────────────────────────────────────

function buildR2Client() {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME } = process.env;

  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET_NAME) {
    console.warn('[preprocess] R2 env vars not set — skipping upload. Set in .env or Vercel dashboard:');
    console.warn('  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME');
    return null;
  }

  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId:     R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}

async function uploadToR2(client, dateStr, payload) {
  const key = `mesh/${dateStr}.json`;
  console.log(`[preprocess] Uploading to R2: ${key}...`);

  await client.send(new PutObjectCommand({
    Bucket:       process.env.R2_BUCKET_NAME,
    Key:          key,
    Body:         JSON.stringify(payload),
    ContentType:  'application/json',
    CacheControl: 'public, max-age=31536000, immutable'
  }));

  console.log(`[preprocess] Uploaded: ${key}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  checkEccodes();

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node scripts/preprocess.js <grib2-path> [YYYY-MM-DD]');
    console.error('       node scripts/preprocess.js YYYY-MM-DD');
    process.exit(1);
  }

  let gribPath, dateStr;

  // Date-only mode: node preprocess.js 2024-09-24
  if (/^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
    dateStr = args[0];
    // Look for matching file in temp dir
    const tempDir = path.join(__dirname, '../mrms-proxy-server/temp');
    const nextDay = new Date(`${dateStr}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const ny = nextDay.getUTCFullYear();
    const nm = String(nextDay.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(nextDay.getUTCDate()).padStart(2, '0');
    const expectedName = `MESH_Max_1440min_00.50_${ny}${nm}${nd}-000000.grib2`;
    gribPath = path.join(tempDir, expectedName);

    if (!fs.existsSync(gribPath)) {
      console.error(`[preprocess] File not found: ${gribPath}`);
      console.error(`[preprocess] Download it first from:`);
      console.error(`  https://mtarchive.geol.iastate.edu/${ny}/${nm}/${nd}/mrms/ncep/MESH_Max_1440min/`);
      process.exit(1);
    }
  } else {
    // File path mode: node preprocess.js path/to/file.grib2 2024-09-24
    gribPath = path.resolve(args[0]);
    if (!fs.existsSync(gribPath)) {
      console.error(`[preprocess] File not found: ${gribPath}`);
      process.exit(1);
    }
    // Extract date from filename or use arg
    if (args[1] && /^\d{4}-\d{2}-\d{2}$/.test(args[1])) {
      dateStr = args[1];
    } else {
      const match = path.basename(gribPath).match(/(\d{4})(\d{2})(\d{2})/);
      if (match) {
        // GRIB2 files are named with the day AFTER the storm (UTC rollover)
        const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
        fileDate.setUTCDate(fileDate.getUTCDate() - 1);
        dateStr = fileDate.toISOString().split('T')[0];
        console.log(`[preprocess] Inferred storm date from filename: ${dateStr}`);
      } else {
        console.error('[preprocess] Cannot infer date from filename. Pass date as second arg: YYYY-MM-DD');
        process.exit(1);
      }
    }
  }

  console.log(`[preprocess] Storm date: ${dateStr}`);
  console.log(`[preprocess] GRIB2 file: ${gribPath}`);
  console.log(`[preprocess] File size:  ${(fs.statSync(gribPath).size / 1024).toFixed(0)} KB`);
  console.log('');

  const startTime = Date.now();
  const reports = await parseGrib2(gribPath, dateStr);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (reports.length === 0) {
    console.log(`[preprocess] No hail >= ${MIN_HAIL_INCHES}" found in OKC Metro for ${dateStr}.`);
    console.log('[preprocess] This may be correct (no significant hail that day).');
  } else {
    const maxSize = Math.max(...reports.map(r => r.size));
    const avgSize = reports.reduce((s, r) => s + r.size, 0) / reports.length;
    console.log('');
    console.log(`[preprocess] ✓ ${reports.length} hail reports in ${elapsed}s`);
    console.log(`[preprocess]   Max: ${maxSize.toFixed(2)}" | Avg: ${avgSize.toFixed(2)}"`);

    // City breakdown
    const byCityMap = {};
    for (const r of reports) {
      byCityMap[r.city] = (byCityMap[r.city] || 0) + 1;
    }
    const byCity = Object.entries(byCityMap).sort((a, b) => b[1] - a[1]);
    console.log('[preprocess]   By city:');
    for (const [city, count] of byCity) {
      console.log(`[preprocess]     ${city}: ${count} reports`);
    }
  }

  const payload = {
    date:          dateStr,
    generated_at:  new Date().toISOString(),
    data_source:   'NOAA MRMS MESH 24h Maximum (local preprocessor)',
    bounds:        OKC_BOUNDS,
    reports,
    summary: {
      totalReports: reports.length,
      maxSize:      reports.length > 0 ? Math.max(...reports.map(r => r.size)) : 0,
      avgSize:      reports.length > 0 ? reports.reduce((s, r) => s + r.size, 0) / reports.length : 0
    }
  };

  // Upload to R2
  const r2 = buildR2Client();
  if (r2) {
    await uploadToR2(r2, dateStr, payload);
    console.log(`[preprocess] Done. API will now serve /api/mesh/${dateStr} from R2 cache.`);
  } else {
    // Write locally for inspection
    const outPath = path.join(__dirname, `../mrms-proxy-server/preprocessed/${dateStr}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`[preprocess] Saved locally (no R2): ${outPath}`);
  }
}

main().catch((err) => {
  console.error('[preprocess] Fatal error:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * One-time backfill: load already-uploaded MESH dates into Supabase hail_grid
 * by reading the live /api/mesh/[date] R2 cache (no GRIB2 reprocessing).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-hail-grid.js 2024-09-24 2026-03-10 2026-05-08
 *
 * Idempotent: upserts on (date, latitude, longitude); safe to re-run.
 */
const path = require('path');
const { createClient } = require(path.join(__dirname, '../api/node_modules/@supabase/supabase-js'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ibpqwovcrvagwbfrmbgp.supabase.co';
const MESH_BASE = process.env.MESH_BASE || 'https://d2d-sales-tracker-tau.vercel.app';

async function main() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    console.error('Usage: node scripts/backfill-hail-grid.js YYYY-MM-DD [YYYY-MM-DD ...]');
    process.exit(1);
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY env var required');
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, key);

  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.error(`[${date}] invalid date format — skipped`);
      continue;
    }
    const res = await fetch(`${MESH_BASE}/api/mesh/${date}`);
    if (!res.ok) {
      console.error(`[${date}] /api/mesh returned ${res.status} — skipped`);
      continue;
    }
    const payload = await res.json();
    const rows = (payload.reports || []).map(r => ({
      date,
      latitude: r.latitude,
      longitude: r.longitude,
      size_inches: r.size,
    }));
    if (rows.length === 0) {
      console.log(`[${date}] no reports in cache — nothing to insert`);
      continue;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from('hail_grid')
        .upsert(rows.slice(i, i + 500), { onConflict: 'date,latitude,longitude', ignoreDuplicates: true });
      if (error) {
        console.error(`[${date}] upsert failed: ${error.message}`);
        process.exit(1);
      }
    }
    const { count, error: cErr } = await supabase
      .from('hail_grid')
      .select('*', { count: 'exact', head: true })
      .eq('date', date);
    console.log(`[${date}] processed ${rows.length} reports — hail_grid now has ${cErr ? '?' : count} rows for this date`);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

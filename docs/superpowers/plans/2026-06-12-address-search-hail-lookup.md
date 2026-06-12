# Address Search (Autocomplete + Pin) & Address→Hail-Storm Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uber-quality address autocomplete that zooms + pins an address on the Territory Map and shows which uploaded hail storms impacted it (1-mile radius), on both the searched pin and every knock's detail sheet.

**Architecture:** Google Places Autocomplete (New) replaces Nominatim inside the existing `AddressSearchBar` shell. A new Supabase `hail_grid` table (one row per MESH grid point per storm date) answers "which storms hit this point" in a single indexed query via a new `HailHistoryService`; a shared `HailHistoryList` component renders the answer on two surfaces. `scripts/preprocess.js` upserts future storms automatically; a one-time backfill loads the three existing dates from the live `/api/mesh/[date]` cache.

**Tech Stack:** React Native / Expo 54, react-native-maps, Supabase (client-direct query under RLS; service-role writes from scripts), Google Places API (New), Vercel-cached MESH JSON.

**Spec:** `docs/superpowers/specs/2026-06-12-address-search-hail-lookup-design.md`

**Verification gates (project-defined — no jest in this repo):** `npx tsc --noEmit` (0 errors) and `npx expo export` (clean Hermes bundle) after every task, plus runtime checks (curl / node script runs / read-only Supabase MCP SQL) called out per task.

---

## Owner prerequisites (can run in parallel with Tasks 1–8; hard gates marked)

- [ ] **P1 — Google Places API key** (gates Task 9 device test, not the code tasks):
  1. https://console.cloud.google.com → create project `d2d-sales-tracker` (or reuse one).
  2. Billing → add payment method (usage at our volume sits inside the free tier).
  3. APIs & Services → Library → enable **Places API (New)**.
  4. APIs & Services → Credentials → Create credentials → API key. Then **Edit key** →
     Application restrictions: **iOS apps** → bundle ID `com.sigmabiz.d2dsalestracker`;
     API restrictions: **Places API (New)** only.
  5. Create/edit `.env` in the project root (gitignored) and add:
     `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<the key>`
  6. For future EAS cloud builds: `npx eas env:create --name EXPO_PUBLIC_GOOGLE_PLACES_API_KEY --value <the key> --environment production` (OTA publishes from this Mac read `.env`, so step 5 alone unblocks today's work).
- [ ] **P2 — Paste migration** (gates Task 1 Step 4 backfill run): run `migrations/2026-06-12_hail_grid.sql` in the Supabase SQL editor (project `ibpqwovcrvagwbfrmbgp`).
- [ ] **P3 — GitHub secret** (gates nothing today; needed before the next live storm): repo Settings → Secrets and variables → Actions → new secret `SUPABASE_SERVICE_ROLE_KEY` = the service-role key from Supabase → Settings → API.

---

## Task 1: `hail_grid` migration + one-time backfill script

**Files:**
- Create: `migrations/2026-06-12_hail_grid.sql`
- Create: `scripts/backfill-hail-grid.js`

- [ ] **Step 1: Write the migration**

```sql
-- migrations/2026-06-12_hail_grid.sql
-- One row per MESH grid point per storm date. Source of truth for
-- "which uploaded storms hit this address" (spec 2026-06-12).
CREATE TABLE hail_grid (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  size_inches REAL NOT NULL,
  UNIQUE (date, latitude, longitude)
);
CREATE INDEX hail_grid_lat_lng_idx ON hail_grid (latitude, longitude);
CREATE INDEX hail_grid_date_idx ON hail_grid (date);
ALTER TABLE hail_grid ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON hail_grid
  FOR SELECT TO authenticated USING (true);
-- Writes: service role only (no INSERT/UPDATE/DELETE policies on purpose).
```

- [ ] **Step 2: Write the backfill script**

```js
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
```

- [ ] **Step 3: Sanity-check the script fails loudly without prerequisites**

Run: `node scripts/backfill-hail-grid.js`
Expected: `Usage: node scripts/backfill-hail-grid.js YYYY-MM-DD ...`, exit 1.

Run: `node scripts/backfill-hail-grid.js 2024-09-24`
Expected: `SUPABASE_SERVICE_ROLE_KEY env var required`, exit 1.

- [ ] **Step 4 (GATED on owner P2): Run the backfill**

Run: `SUPABASE_SERVICE_ROLE_KEY=<from owner/Vercel env> node scripts/backfill-hail-grid.js 2024-09-24 2026-03-10 2026-05-08`
Expected: three `[date] processed N reports` lines with N ≈ 426 / 158 / 509.

- [ ] **Step 5: Verify counts in the DB (read-only Supabase MCP)**

SQL: `SELECT date, COUNT(*), MAX(size_inches) FROM hail_grid GROUP BY date ORDER BY date;`
Expected: 3 rows; counts match Step 4; max sizes ≈ 2.94 / 2.06 / 2.30.

- [ ] **Step 6: Commit**

```bash
git add migrations/2026-06-12_hail_grid.sql scripts/backfill-hail-grid.js
git commit -m "feat: hail_grid table + one-time backfill script (address→storms lookup data)"
```

---

## Task 2: Auto-ingest future storms (`preprocess.js` + workflow)

**Files:**
- Modify: `scripts/preprocess.js` (add upsert after the R2 upload in `main()`, ~line 300)
- Modify: `.github/workflows/hail-swath.yml:66-73`

- [ ] **Step 1: Add the ingest function to `scripts/preprocess.js`**

Insert after the `uploadToR2` function (after ~line 190, before `main()`):

```js
// ─── Supabase hail_grid ingest ───────────────────────────────────────────────
// Mirrors the R2 upload: same reports, one row per grid point, so the
// address→storms lookup learns about this date automatically.
async function upsertToHailGrid(reports, dateStr) {
  const url = process.env.SUPABASE_URL || 'https://ibpqwovcrvagwbfrmbgp.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.warn('[preprocess] SUPABASE_SERVICE_ROLE_KEY not set — skipping hail_grid ingest.');
    console.warn('[preprocess] Address→storms lookup will not include this date until backfilled:');
    console.warn(`[preprocess]   node scripts/backfill-hail-grid.js ${dateStr}`);
    return;
  }
  const { createClient } = require(path.join(__dirname, '../api/node_modules/@supabase/supabase-js'));
  const supabase = createClient(url, key);
  const rows = reports.map(r => ({
    date: dateStr,
    latitude: r.latitude,
    longitude: r.longitude,
    size_inches: r.size,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('hail_grid')
      .upsert(rows.slice(i, i + 500), { onConflict: 'date,latitude,longitude', ignoreDuplicates: true });
    if (error) throw new Error(`hail_grid upsert failed: ${error.message}`);
  }
  console.log(`[preprocess] ✓ ${rows.length} rows upserted into Supabase hail_grid for ${dateStr}`);
}
```

- [ ] **Step 2: Call it from `main()`**

In `main()`, directly after the R2 upload block (`await uploadToR2(...)` / the local-save `else`), add:

```js
  // Ingest into Supabase hail_grid (address→storms lookup)
  if (reports.length > 0) {
    await upsertToHailGrid(reports, dateStr);
  }
```

- [ ] **Step 3: Fix the workflow (missing deps install — latent pre-existing CI bug) + new secret**

In `.github/workflows/hail-swath.yml`, the preprocessor requires `api/node_modules/@aws-sdk/client-s3` but the job never runs `npm install` (and `api/node_modules` is gitignored), so the CI path could never have completed. Insert a step before "Run preprocessor and upload to R2" and add the new env var:

```yaml
      - name: Install preprocessor deps
        run: npm ci --prefix api

      - name: Run preprocessor and upload to R2
        env:
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
          R2_BUCKET_NAME: ${{ secrets.R2_BUCKET_NAME }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          node scripts/preprocess.js /tmp/mesh.grib2 ${{ github.event.inputs.storm_date }}
```

- [ ] **Step 4: Verify the no-key path degrades loudly, not silently**

Run: `node -e "const p='$PWD/scripts/preprocess.js'; const s=require('fs').readFileSync(p,'utf8'); if(!/upsertToHailGrid/.test(s)) throw new Error('missing'); console.log('syntax+presence OK')" && node --check scripts/preprocess.js && echo PARSE-OK`
Expected: `syntax+presence OK` then `PARSE-OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/preprocess.js .github/workflows/hail-swath.yml
git commit -m "feat: preprocess auto-ingests reports into hail_grid; fix workflow deps install"
```

---

## Task 3: `HailHistoryService` (shared lookup)

**Files:**
- Create: `src/services/hailHistoryService.ts`

- [ ] **Step 1: Write the service**

```ts
/**
 * Address→hail-storms lookup against the Supabase hail_grid table.
 * One bounding-box query per pull; exact haversine + per-date grouping on-device.
 * Spec: docs/superpowers/specs/2026-06-12-address-search-hail-lookup-design.md
 */
import { supabase } from './supabaseClient';

export const HAIL_RADIUS_MILES = 1;

export interface StormHit {
  date: string;           // YYYY-MM-DD (Postgres DATE comes back as a string)
  maxSizeInches: number;
  nearestMiles: number;
}

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export class HailHistoryService {
  /**
   * Every uploaded storm with a MESH point within radiusMiles of (lat, lng),
   * newest first. THROWS on query failure — callers must render an explicit
   * error state (never an empty list that reads as "no storms").
   */
  static async getStormsForPoint(
    lat: number,
    lng: number,
    radiusMiles: number = HAIL_RADIUS_MILES,
  ): Promise<StormHit[]> {
    const dLat = radiusMiles / 69;
    const dLng = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180));
    const { data, error } = await supabase
      .from('hail_grid')
      .select('date, latitude, longitude, size_inches')
      .gte('latitude', lat - dLat)
      .lte('latitude', lat + dLat)
      .gte('longitude', lng - dLng)
      .lte('longitude', lng + dLng);
    if (error) throw new Error(`hail_grid query failed: ${error.message}`);

    const byDate = new Map<string, { maxSize: number; nearest: number }>();
    for (const row of data ?? []) {
      const miles = haversineMiles(lat, lng, row.latitude, row.longitude);
      if (miles > radiusMiles) continue;
      const cur = byDate.get(row.date);
      if (!cur) {
        byDate.set(row.date, { maxSize: row.size_inches, nearest: miles });
      } else {
        cur.maxSize = Math.max(cur.maxSize, row.size_inches);
        cur.nearest = Math.min(cur.nearest, miles);
      }
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, maxSizeInches: v.maxSize, nearestMiles: v.nearest }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3 (after Task 1 backfill): Cross-check the math against SQL**

Pick a known-impacted point (e.g. 35.47, -97.52). Read-only MCP SQL:
`SELECT date, MAX(size_inches) FROM hail_grid WHERE latitude BETWEEN 35.4555 AND 35.4845 AND longitude BETWEEN -97.5379 AND -97.5021 GROUP BY date;`
Expected: dates/sizes match what the device shows in Task 9 for that point.

- [ ] **Step 4: Commit**

```bash
git add src/services/hailHistoryService.ts
git commit -m "feat: HailHistoryService — point→uploaded-storms lookup via hail_grid"
```

---

## Task 4: `PlacesService` (Google Places wrapper) + key config

**Files:**
- Modify: `src/config/api.config.ts` (append)
- Create: `src/services/placesService.ts`

- [ ] **Step 1: Add the key constant to `src/config/api.config.ts`** (append at end of file)

```ts
/**
 * Google Places API (New) — address autocomplete. The key is restricted to the
 * iOS bundle ID + Places API in Google Cloud, so shipping it in the bundle is
 * acceptable. Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in .env (and as an EAS env
 * var for cloud builds). Empty key → AddressSearchBar shows an explicit
 * "Search unavailable" state (never a silent failure).
 */
export const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
```

- [ ] **Step 2: Write `src/services/placesService.ts`**

```ts
/**
 * Google Places API (New) wrapper for address autocomplete.
 * Session tokens group autocomplete keystrokes + the place-details call into
 * one billed session (generate on first keystroke, discard after selection).
 */
import { GOOGLE_PLACES_API_KEY } from '../config/api.config';

export interface PlacePrediction {
  placeId: string;
  mainText: string;      // "12320 S May Ave"
  secondaryText: string; // "Oklahoma City, OK, USA"
}

const OKC_CENTER = { latitude: 35.4676, longitude: -97.5164 };
const BIAS_RADIUS_METERS = 50000; // bias (not restrict) to the OKC metro

export class PlacesService {
  static hasKey(): boolean {
    return GOOGLE_PLACES_API_KEY.length > 0;
  }

  static newSessionToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  static async getPredictions(input: string, sessionToken: string): Promise<PlacePrediction[]> {
    if (!this.hasKey()) throw new Error('Google Places API key not configured');
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify({
        input,
        sessionToken,
        includedRegionCodes: ['us'],
        locationBias: { circle: { center: OKC_CENTER, radius: BIAS_RADIUS_METERS } },
      }),
    });
    if (!res.ok) throw new Error(`Places autocomplete HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions ?? [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => ({
        placeId: s.placePrediction.placeId,
        mainText:
          s.placePrediction.structuredFormat?.mainText?.text ??
          s.placePrediction.text?.text ?? '',
        secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
      }));
  }

  static async getPlaceLocation(
    placeId: string,
    sessionToken: string,
  ): Promise<{ address: string; lat: number; lng: number }> {
    if (!this.hasKey()) throw new Error('Google Places API key not configured');
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
      {
        headers: {
          'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask': 'location,formattedAddress',
        },
      },
    );
    if (!res.ok) throw new Error(`Place details HTTP ${res.status}`);
    const data = await res.json();
    return {
      address: data.formattedAddress ?? '',
      lat: data.location.latitude,
      lng: data.location.longitude,
    };
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4 (GATED on owner P1): Live API smoke test**

Run (key from `.env`):
```bash
source .env 2>/dev/null; curl -s -X POST 'https://places.googleapis.com/v1/places:autocomplete' \
  -H "Content-Type: application/json" -H "X-Goog-Api-Key: $EXPO_PUBLIC_GOOGLE_PLACES_API_KEY" \
  -d '{"input":"12320 S May","includedRegionCodes":["us"],"locationBias":{"circle":{"center":{"latitude":35.4676,"longitude":-97.5164},"radius":50000}}}' | head -c 400
```
Expected: JSON `suggestions` array whose first `placePrediction.text.text` contains "12320 S May Ave, Oklahoma City".
NOTE: bundle-ID-restricted keys may 403 from curl — if so, verify on-device in Task 9 instead; a 403 here is NOT a failure signal by itself.

- [ ] **Step 5: Commit**

```bash
git add src/config/api.config.ts src/services/placesService.ts
git commit -m "feat: PlacesService — Google Places (New) autocomplete + details"
```

---

## Task 5: Rework `AddressSearchBar` onto Google Places

**Files:**
- Modify: `src/components/AddressSearchBar.tsx` (replace data layer; keep visual shell + container styles)

- [ ] **Step 1: Replace the component implementation**

Full new content (styles at the bottom keep the existing `container`/`searchBar`/`resultsContainer` etc. values; new styles appended where marked):

```tsx
import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  FlatList,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlacesService, PlacePrediction } from '../services/placesService';

interface AddressSearchBarProps {
  onAddressSelect: (address: string, lat: number, lng: number) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 300; // Uber-feel; each debounced keystroke = 1 autocomplete request
const MIN_CHARS = 3;

export default function AddressSearchBar({ onAddressSelect, placeholder = "Search address..." }: AddressSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const requestSeq = useRef(0); // drop out-of-order responses

  const fetchPredictions = async (query: string) => {
    if (query.length < MIN_CHARS) {
      setPredictions([]);
      setShowResults(false);
      return;
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = PlacesService.newSessionToken();
    }
    const seq = ++requestSeq.current;
    setIsSearching(true);
    try {
      const results = await PlacesService.getPredictions(query, sessionTokenRef.current);
      if (seq !== requestSeq.current) return; // stale response
      setSearchError(false);
      setPredictions(results);
      setShowResults(true);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('[AddressSearch] prediction error:', error);
      setSearchError(true);
      setPredictions([]);
      setShowResults(true); // show the explicit error row — never fail silently
    } finally {
      if (seq === requestSeq.current) setIsSearching(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchPredictions(text), DEBOUNCE_MS);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    const token = sessionTokenRef.current ?? PlacesService.newSessionToken();
    sessionTokenRef.current = null; // selection ends the billing session
    setShowResults(false);
    Keyboard.dismiss();
    setIsSearching(true);
    try {
      const { address, lat, lng } = await PlacesService.getPlaceLocation(prediction.placeId, token);
      setSearchQuery(address || `${prediction.mainText}, ${prediction.secondaryText}`);
      onAddressSelect(address || prediction.mainText, lat, lng);
    } catch (error) {
      console.error('[AddressSearch] place details error:', error);
      setSearchError(true);
      setShowResults(true);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPredictions([]);
    setShowResults(false);
    setSearchError(false);
    sessionTokenRef.current = null;
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={handleSearchChange}
          onFocus={() => setShowResults(predictions.length > 0 || searchError)}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {isSearching && (
          <ActivityIndicator size="small" color="#1e40af" style={styles.loadingIcon} />
        )}
        {searchQuery.length > 0 && !isSearching && (
          <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {showResults && (
        <View style={styles.resultsContainer}>
          {searchError ? (
            <View style={styles.errorRow}>
              <Ionicons name="cloud-offline" size={16} color="#ef4444" style={styles.resultIcon} />
              <Text style={styles.errorText}>
                {PlacesService.hasKey()
                  ? 'Search unavailable — check connection'
                  : 'Search unavailable — API key missing'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={predictions}
              keyExtractor={item => item.placeId}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectPrediction(item)}
                >
                  <Ionicons name="location" size={16} color="#6b7280" style={styles.resultIcon} />
                  <View style={styles.resultTextBox}>
                    <Text style={styles.resultMain} numberOfLines={1}>{item.mainText}</Text>
                    <Text style={styles.resultSecondary} numberOfLines={1}>{item.secondaryText}</Text>
                  </View>
                </TouchableOpacity>
              )}
              style={styles.resultsList}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      )}
    </View>
  );
}
```

Styles: keep the existing `container`, `searchBar`, `searchIcon`, `searchInput`, `loadingIcon`, `clearButton`, `resultsContainer`, `resultsList`, `resultItem`, `resultIcon` definitions exactly as they are; DELETE `resultText`; APPEND:

```tsx
  resultTextBox: {
    flex: 1,
  },
  resultMain: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  resultSecondary: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#ef4444',
  },
```

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit` → 0 errors. Run: `npx expo export 2>&1 | tail -3` → bundle succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/AddressSearchBar.tsx
git commit -m "feat: AddressSearchBar — Google Places predictions (replaces Nominatim)"
```

---

## Task 6: Searched pin (NativeMap + RealMapScreen state)

**Files:**
- Modify: `src/components/NativeMap.tsx` (props ~line 110-118; render block before knock markers ~line 220)
- Modify: `src/screens/RealMapScreen.tsx` (state ~line 50; `handleAddressSelect` line 743; `<NativeMap …>` props line 755-764)

- [ ] **Step 1: NativeMap — add props + marker**

In `NativeMapProps` add:

```ts
  searchedPin: { lat: number; lng: number; address: string } | null;
  onSearchedPinPress: () => void;
```

Destructure both in the component signature (after `mapType,`):

```ts
  searchedPin,
  onSearchedPinPress,
```

Render the marker INSIDE `<MapView>`, after the SPC spotter markers block and before the knock markers block:

```tsx
      {/* Searched-address pin — blue standard pin, distinct from emoji knocks.
          Press reopens the storm card; never enters the knock "Opened?" gate. */}
      {searchedPin && (
        <Marker
          coordinate={{ latitude: searchedPin.lat, longitude: searchedPin.lng }}
          pinColor="#2563eb"
          onPress={e => {
            e.stopPropagation();
            onSearchedPinPress();
          }}
        />
      )}
```

- [ ] **Step 2: RealMapScreen — state + handler + props**

After the `mapType` state (line ~49) add:

```tsx
  // Searched-address pin + its hail-history card (address search feature)
  const [searchedPin, setSearchedPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [hailCardVisible, setHailCardVisible] = useState(false);
```

Replace `handleAddressSelect` (line 743-745) with:

```tsx
  const handleAddressSelect = (address: string, lat: number, lng: number) => {
    mapRef.current?.centerOnLocation(lat, lng, 0.005);
    setSearchedPin({ lat, lng, address });
    setHailCardVisible(true);
  };

  const clearSearchedPin = () => {
    setSearchedPin(null);
    setHailCardVisible(false);
  };
```

Add the two props to the `<NativeMap>` element (after `mapType={mapType}`):

```tsx
        searchedPin={searchedPin}
        onSearchedPinPress={() => setHailCardVisible(true)}
```

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/NativeMap.tsx src/screens/RealMapScreen.tsx
git commit -m "feat: searched-address pin on the territory map"
```

---

## Task 7: `HailHistoryList` component + searched-pin storm card

**Files:**
- Create: `src/components/HailHistoryList.tsx`
- Modify: `src/screens/RealMapScreen.tsx` (imports ~line 18; card JSX after the `<NotifPanel …/>` block ~line 869; styles at the bottom StyleSheet)

- [ ] **Step 1: Write the shared list component**

```tsx
/**
 * HailHistoryList — "which uploaded storms hit this point" rows.
 * Shared by the searched-pin storm card and the knock detail sheet.
 * Row tap loads that storm's swath ADDITIVELY (other storms' visibility
 * untouched — keeps compatibility with the future swath-visibility filter).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HailHistoryService, StormHit, HAIL_RADIUS_MILES } from '../services/hailHistoryService';
import { MRMSService } from '../services/mrmsService';
import { IEMArchiveService } from '../services/tier2IEMService';

interface HailHistoryListProps {
  lat: number;
  lng: number;
  onStormLoaded?: () => void; // parent refreshes overlays (loadHailData)
}

function formatStormDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

export default function HailHistoryList({ lat, lng, onStormLoaded }: HailHistoryListProps) {
  const [hits, setHits] = useState<StormHit[] | null>(null);
  const [lookupError, setLookupError] = useState(false);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);

  const fetchHits = useCallback(async () => {
    setLookupError(false);
    setHits(null);
    try {
      setHits(await HailHistoryService.getStormsForPoint(lat, lng));
    } catch (err) {
      console.error('[HailHistory] lookup failed:', err);
      setLookupError(true);
    }
  }, [lat, lng]);

  useEffect(() => { fetchHits(); }, [fetchHits]);

  const handleLoadSwath = async (hit: StormHit) => {
    setLoadingDate(hit.date);
    try {
      const reports = await IEMArchiveService.fetchHistoricalStorm(new Date(`${hit.date}T12:00:00`));
      if (reports.length === 0) {
        Alert.alert('No swath data', `No processed swath found for ${formatStormDate(hit.date)}.`);
        return;
      }
      const storm = await MRMSService.groupIntoStormEvents(reports);
      const [y, m, d] = hit.date.split('-').map(Number);
      storm.startTime = new Date(y, m - 1, d, 12, 0, 0); // local noon — avoids UTC date shift
      storm.name = `OKC Metro - ${m}/${d}/${y}`;
      storm.source = 'IEM';
      await MRMSService.saveStormEvent(storm);
      onStormLoaded?.();
    } catch (err) {
      console.error('[HailHistory] swath load failed:', err);
      Alert.alert('Error', 'Failed to load the swath. Check your connection.');
    } finally {
      setLoadingDate(null);
    }
  };

  if (lookupError) {
    return (
      <View style={styles.stateRow}>
        <Text style={styles.errorText}>Couldn't check storms</Text>
        <TouchableOpacity onPress={fetchHits}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (hits === null) {
    return <ActivityIndicator size="small" color="#1e40af" style={styles.stateRow} />;
  }
  if (hits.length === 0) {
    return (
      <Text style={styles.emptyText}>
        No uploaded storms within {HAIL_RADIUS_MILES} mi of this address
      </Text>
    );
  }
  return (
    <View>
      {hits.map(hit => (
        <TouchableOpacity
          key={hit.date}
          style={styles.row}
          onPress={() => handleLoadSwath(hit)}
          disabled={loadingDate !== null}
        >
          <Text style={styles.rowDate}>🌩️ {formatStormDate(hit.date)}</Text>
          <Text style={styles.rowDetail}>
            {hit.maxSizeInches.toFixed(2)}″ max · {hit.nearestMiles.toFixed(1)} mi
          </Text>
          {loadingDate === hit.date
            ? <ActivityIndicator size="small" color="#1e40af" />
            : <Ionicons name="chevron-forward" size={16} color="#9ca3af" />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  rowDetail: {
    fontSize: 13,
    color: '#6b7280',
    marginRight: 8,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#ef4444',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
  },
  emptyText: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
});
```

- [ ] **Step 2: Storm card in RealMapScreen**

Import at the top (with the other component imports):

```tsx
import HailHistoryList from '../components/HailHistoryList';
```

JSX — insert directly AFTER the `<NotifPanel … />` element (line ~869) and before the "Opened?" gate modal:

```tsx
      {/* Searched-address storm card */}
      {searchedPin && hailCardVisible && (
        <View style={styles.hailCard}>
          <View style={styles.hailCardHeader}>
            <Text style={styles.hailCardAddress} numberOfLines={2}>
              📍 {searchedPin.address}
            </Text>
            <TouchableOpacity onPress={clearSearchedPin}>
              <Ionicons name="close-circle" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
          <HailHistoryList
            lat={searchedPin.lat}
            lng={searchedPin.lng}
            onStormLoaded={loadHailData}
          />
        </View>
      )}
```

Styles — append to the screen's StyleSheet:

```tsx
  hailCard: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  hailCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  hailCardAddress: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginRight: 8,
  },
```

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit` → 0 errors. Run: `npx expo export 2>&1 | tail -3` → bundle succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/HailHistoryList.tsx src/screens/RealMapScreen.tsx
git commit -m "feat: hail-history storm card on searched address (shared HailHistoryList)"
```

---

## Task 8: "Hail History" section in the knock detail sheet

**Files:**
- Modify: `src/screens/RealMapScreen.tsx` (detail sheet, after the meta row closing tag at line ~1236, before the Notes block)

- [ ] **Step 1: Insert the section**

Directly after the `</View>` that closes `styles.detailMetaRow` (the block containing the `Storm:` and `📅 DOL:` badges) and BEFORE the `{/* Notes */}` block, add:

```tsx
                {/* Hail history — uploaded storms that hit this address (live lookup) */}
                <View style={styles.contactSection}>
                  <Text style={styles.historySectionTitle}>Hail History</Text>
                  <HailHistoryList
                    lat={detailKnock.latitude}
                    lng={detailKnock.longitude}
                    onStormLoaded={loadHailData}
                  />
                </View>
```

(`styles.contactSection` and `styles.historySectionTitle` already exist — reused as-is.)

- [ ] **Step 2: Gates**

Run: `npx tsc --noEmit` → 0 errors. Run: `npx expo export 2>&1 | tail -3` → bundle succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/screens/RealMapScreen.tsx
git commit -m "feat: Hail History section in knock detail sheet"
```

---

## Task 9: Full gates, device verification, docs, push

- [ ] **Step 1: Run both project gates from clean state**

Run: `npx tsc --noEmit && npx expo export 2>&1 | tail -3`
Expected: 0 type errors; export completes.

- [ ] **Step 2 (GATED on owner P1+P2): Device test checklist** (owner runs the app via `npx expo start` dev client or TestFlight OTA after publish approval)

1. Type 3–4 chars of your own address → predictions list it (bold street, gray city).
2. Select → map zooms tight + blue pin on the rooftop; storm card appears.
3. Known-impacted address (inside the 05/08 swath) → card lists 05/08/2026 and 03/10/2026 with plausible max sizes (≈2.3″ / ≈2.1″ ceilings) and distances.
4. Tap the 05/08 row → swath draws; blue-cloud panel shows it checked; other storms' checkboxes unchanged.
5. Search a far rural address → explicit "No uploaded storms within 1 mi" line.
6. Tap an existing knock → detail sheet shows the same Hail History section.
7. Tap the blue pin after dismissing the card → card reopens. Map tap elsewhere → knock gate behaves exactly as before.
8. Airplane mode: typing shows "Search unavailable — check connection"; storm card shows "Couldn't check storms" + Retry. No fake/empty-success states.

- [ ] **Step 3: Update `.context/STATE.md` + `.context/PLAN.md`**

STATE.md: append a dated feature record (address search + hail lookup: what shipped, commits, pending owner actions status, any new dead-ends hit). PLAN.md: mark C2 as built (it shipped as this feature — note hail_grid now exists, C3 unblocked); add backlog item: "Swath visibility filter (owner 2026-06-12): display rule over HailOverlay checkboxes — modes: all active / most recent only / largest only / off. Needs mini-design: 'largest' definition, persistence, role scoping." Add backlog item: "Replace hardcoded 03/10 + 05/08 buttons in StormSearchScreen with live list (SELECT DISTINCT date FROM hail_grid)."

- [ ] **Step 4: Commit docs + push the branch**

```bash
git add .context/STATE.md .context/PLAN.md docs/superpowers/plans/2026-06-12-address-search-hail-lookup.md
git commit -m "docs: state/plan update — address search + hail lookup shipped"
git push
```

- [ ] **Step 5 (OWNER GATE — outward-facing):** OTA publish to the field crew (`eas update`) and/or Vercel deploy are NOT performed autonomously. Ask the owner after the device test passes.

---

## Notes for the implementer

- **No jest in this repo.** Gates are `npx tsc --noEmit` + `npx expo export` (project CLAUDE.md). Don't add a test framework.
- **`hail_grid.date` arrives as a `'YYYY-MM-DD'` string** from supabase-js. Never `new Date('YYYY-MM-DD')` for display (UTC shift) — format by string split, as `formatStormDate` does.
- **`MRMSService.saveStormEvent` caps storage at 3 storms** (`MAX_STORMS`), evicting the oldest inactive one. Acceptable: the lookup list is DB-backed and unaffected; only map overlays rotate.
- **`groupIntoStormEvents` sets `enabled: true`** (mrmsService.ts:197), so a row-tapped storm renders immediately after `loadHailData()` — no extra toggle call.
- **The searched pin's Marker `onPress` must call `e.stopPropagation()`** (same pattern as knock markers, NativeMap.tsx:226-228) or the map's `onPress` fires and opens the knock gate.
- **Suggestion responses can arrive out of order** — `requestSeq` in AddressSearchBar drops stale ones; keep it.
- **api/node_modules requires:** scripts require supabase-js via `path.join(__dirname, '../api/node_modules/@supabase/supabase-js')` (same pattern as the existing aws-sdk require at preprocess.js:21) so local + CI resolve identically after `npm ci --prefix api`.
- **Owner-gated steps:** Task 1 Step 4 (migration must be pasted first), Task 4 Step 4 (needs key), Task 9 Steps 2/5. Everything else runs without the owner.

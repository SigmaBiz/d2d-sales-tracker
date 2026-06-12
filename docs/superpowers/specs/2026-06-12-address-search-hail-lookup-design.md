# Design: Address Search (autocomplete + pin) & Address→Hail-Storm Lookup
Date: 2026-06-12 · Status: approved pending user spec review · Branch: feature/serverless-backend-migration

## Problem
When a client calls with their address, the owner needs to (1) find that address on the
Territory Map fast and (2) know immediately which uploaded hail storms impacted it. Today the
search bar exists (`AddressSearchBar.tsx`) but predicts poorly — it uses Nominatim, whose
matching engine is not built for partial input and whose usage policy forbids
search-as-you-type. There is no address→storms lookup anywhere in the UI (PLAN.md phase C2
designed one but it was never built; a prototype `getAddressHailHistory` in
`tier2IEMService.ts` is dead code reachable only from an unrouted dashboard screen).

## Requirements (locked with owner, 2026-06-12)
1. Type-ahead address prediction, "Uber popup" quality: suggestions match partial input
   within 3–4 keystrokes for OKC-metro addresses.
2. Selecting a prediction zooms the map to the address (existing
   `centerOnLocation(lat, lng, 0.005)` path) AND drops a distinct **searched-address pin**
   at the rooftop point. One searched pin at a time.
3. Storm lookup checks **all uploaded storms** (every date in `hail_grid`; currently
   2024-09-24, 2026-03-10, 2026-05-08 after backfill).
4. Impact rule: address is impacted by a storm if any MESH grid point for that date lies
   within **1 mile** (code constant `HAIL_RADIUS_MILES = 1`). Display max hail size +
   distance to nearest report, e.g. "05/08/2026 — 2.30″ max · 0.2 mi".
5. Two surfaces, one shared lookup: (a) storm card attached to the searched pin;
   (b) "Hail history" section in the knock detail sheet (computed live from knock coords).
6. Tapping a storm row loads that storm's swath overlay (additive: enables that storm,
   never changes other storms' visibility — keeps compatibility with the future
   swath-visibility-filter feature, see Out of Scope).

## ζ-verdicts
- **Autocomplete provider**: Nominatim (Z₁ — policy forbids autocomplete; generic-UA 403s;
  weak partial matching) → **Google Places Autocomplete (New)** (Z₂ — paid-contract API
  designed for this; the engine behind the Uber UX the owner referenced).
  `ζ-verdict: Z₁→Z₂ (contractual autocomplete, prediction quality)`
- **Lookup data path**: per-lookup R2 multi-fetch (Z₁ — N fetches per pull, fragile in the
  field, needs a list-dates endpoint anyway) → **Supabase `hail_grid` table** (Z₂ — one
  indexed query per pull; reaffirms PLAN.md C2's original verdict).
  `ζ-verdict: Z₁→Z₂ (single DB contract per lookup)`

## Architecture

### A. Search (client)
- **`src/services/placesService.ts` (new)** — wraps Google Places API (New):
  - `getPredictions(input, sessionToken)` → POST
    `https://places.googleapis.com/v1/places:autocomplete` with `X-Goog-Api-Key`,
    `includedRegionCodes: ["US"]`, `locationBias` circle centered on OKC
    (35.4676, −97.5164, ~50 km radius). Returns `{placeId, mainText, secondaryText}[]`.
  - `getPlaceLocation(placeId, sessionToken)` → Place Details (fields: `location`,
    `formattedAddress`) → `{address, lat, lng}`. Session token (uuid per typing session,
    reset on selection) groups autocomplete + details into one billed session.
  - API key in `app.json` → `expo.extra.googlePlacesApiKey`, read via `expo-constants`;
    key restricted in Google Cloud to the iOS bundle ID + Places API only (client-side
    exposure is standard and acceptable under these restrictions).
- **`AddressSearchBar.tsx` (rework internals, keep shell)** — debounce 500→300 ms; min 3
  chars; dropdown rows render bold `mainText` + gray `secondaryText`; Nominatim fetch and
  `SearchResult` shape removed. `onAddressSelect(address, lat, lng)` contract unchanged.
- **`RealMapScreen.tsx`** — `handleAddressSelect` keeps the zoom and now also sets
  `searchedPin: {lat, lng, address} | null`. New search replaces the pin; dismissing the
  card clears it.
- **`NativeMap.tsx`** — new optional prop `searchedPin`; renders a standard map pin in a
  contrasting color (blue, vs. the emoji knock markers) so it cannot be mistaken for a
  knock. Marker press reopens the storm card and must NOT enter the "Opened?" knock gate
  (`doorLockRef` untouched by this path).

### B. Lookup (shared)
- **`src/services/hailHistoryService.ts` (new)** — `getStormsForPoint(lat, lng,
  radiusMiles = HAIL_RADIUS_MILES)`:
  1. Bounding-box prefilter in SQL: `latitude BETWEEN lat±r/69`, `longitude BETWEEN
     lng±r/(69·cos lat)` (client-direct Supabase query, like the notifications feed).
  2. Exact haversine on-device; keep rows ≤ radius.
  3. Group by `date` → `{date, maxSizeInches, nearestMiles}[]`, newest first.
  Row counts per storm are 150–600, so the prefiltered payload is tiny.
- **`src/components/HailHistoryList.tsx` (new, shared)** — renders the storm rows
  (date · max size · distance · chevron) + the explicit empty/error states. Used by both
  surfaces. Row tap → load that storm's swath via the existing
  `IEMArchiveService.fetchHistoricalStorm(date)` → `MRMSService.saveStormEvent` → enabled
  (additive; other storms untouched).

### C. Surfaces
- **Searched-pin storm card** — floating card (same visual family as existing sheets)
  anchored to the bottom when a searched pin is active: address line + `HailHistoryList` +
  dismiss (✕ clears pin + card).
- **Knock detail sheet** — new "Hail history" section (after the storm-date/DOL badges,
  ~RealMapScreen.tsx:1236): `HailHistoryList` fed by the knock's coordinates, fetched on
  sheet open. No schema change; works for all existing knocks.

### D. Ingest (server/data)
- **Migration `migrations/2026-06-12_hail_grid.sql`** (owner pastes in Supabase):
  ```sql
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
  -- writes: service role only (no INSERT/UPDATE policy)
  ```
  The UNIQUE constraint makes ingest idempotent (upsert).
- **`scripts/preprocess.js`** — after the R2 upload step, upsert the same reports into
  `hail_grid` using `SUPABASE_SERVICE_ROLE_KEY` from env. The GitHub Actions workflow
  (`.github/workflows/hail-swath.yml`) gets the env var; owner adds the repo secret.
  Future storm uploads then populate the table automatically.
- **`scripts/backfill-hail-grid.js` (new, one-time)** — for each existing date, fetch the
  cached JSON from `/api/mesh/[date]` (no R2 creds needed) and upsert. Idempotent; safe to
  re-run. Verify via read-only MCP: row counts ≈ 426 (2024-09-24), 158 (2026-03-10),
  509 (2026-05-08).

## Error handling (NO MOCK DATA — every failure explicit)
- Places request fails / quota blocked → inline dropdown row "Search unavailable — check
  connection"; map unaffected.
- `hail_grid` query fails → card/section shows "Couldn't check storms" + Retry. Never an
  empty list on error.
- Zero hits → explicit "No uploaded storms within 1 mi of this address".
- Swath load from row tap fails → alert (existing `fetchHistoricalStorm` error path),
  card stays.

## Edge cases
- Addresses outside OKC metro: predictions are *biased* to the metro, not restricted;
  far-away addresses zoom + pin normally and report no storms.
- Only one searched pin at a time; new search replaces it.
- Searched pin press never triggers the knock gate; map tap elsewhere behaves exactly
  as today.

## Testing / verification gates
1. `npx tsc --noEmit` → 0 errors; `npx expo export` → clean bundle (project gates).
2. Backfill verified in DB via read-only Supabase MCP (counts above).
3. Device checklist (owner):
   - Own address predicted within 3–4 keystrokes; selection zooms + pins rooftop.
   - Known-impacted address lists 05/08/2026 + 03/10/2026 with plausible size/distance.
   - Storm row tap draws that swath; other storm visibility unchanged.
   - Rural far address → explicit no-storms line.
   - Tapping an existing knock shows the same hail history in its detail sheet.
   - Airplane mode: search shows unavailable row; storm card shows retry; no fake data.

## Owner actions (genuine residue)
1. Google Cloud: create project/billing, enable Places API (New), create key restricted to
   iOS bundle ID + Places API (step-by-step guide will be provided). Volume fits free tier.
2. Paste `migrations/2026-06-12_hail_grid.sql` into Supabase SQL editor.
3. Add `SUPABASE_SERVICE_ROLE_KEY` secret to the GitHub repo (for future auto-ingest).
4. Device test checklist above.

## Out of scope (logged as follow-ups in PLAN.md)
- **Swath visibility filter** (owner idea, 2026-06-12): display rule over the existing
  per-storm checkboxes in `HailOverlay.tsx` — modes: all active / most recent only /
  largest only / filter off. Self-contained; needs its own mini-design (definition of
  "largest", persistence, role scoping). The additive row-tap rule above keeps this
  feature compatible.
- Replace hardcoded 03/10 + 05/08 quick-select buttons in `StormSearchScreen.tsx` with a
  live list from `SELECT DISTINCT date FROM hail_grid`.
- C3 re-hit notifications (hail_grid now makes this a SQL join — unblocked, not built).
- Removing the dead `getAddressHailHistory` prototype + unrouted
  `HailIntelligenceDashboard` (cleanup pass; the new service supersedes them).

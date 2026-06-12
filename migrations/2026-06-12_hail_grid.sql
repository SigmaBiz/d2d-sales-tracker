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

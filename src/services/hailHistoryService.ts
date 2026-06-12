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

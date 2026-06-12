/**
 * API Configuration
 * All tiers now served from the Vercel deployment.
 * Set EXPO_PUBLIC_VERCEL_URL in .env to override (e.g. for preview deployments).
 */

const VERCEL_URL =
  process.env.EXPO_PUBLIC_VERCEL_URL || 'https://d2d-sales-tracker-tau.vercel.app';

export const API_CONFIG = {
  vercelApi: VERCEL_URL,
};

export function getRealtimeServerUrl(endpoint: string): string {
  return `${VERCEL_URL}${endpoint}`;
}

export function getHistoricalServerUrl(endpoint: string): string {
  return `${VERCEL_URL}${endpoint}`;
}

export function getProxyServerUrl(endpoint: string): string {
  return `${VERCEL_URL}${endpoint}`;
}

/**
 * Google Places API (New) — address autocomplete. The key is restricted to the
 * iOS bundle ID + Places API in Google Cloud, so shipping it in the bundle is
 * acceptable. Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in .env (and as an EAS env
 * var for cloud builds). Empty key → AddressSearchBar shows an explicit
 * "Search unavailable" state (never a silent failure).
 */
export const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
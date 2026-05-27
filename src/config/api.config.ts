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
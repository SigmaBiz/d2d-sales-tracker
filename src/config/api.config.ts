/**
 * API Configuration
 * Centralized configuration for all API endpoints
 */

interface ApiConfig {
  realTimeServer: string;
  historicalServer: string;
  proxyServer: string;
}

const DEV_CONFIG: ApiConfig = {
  realTimeServer: 'http://192.168.1.111:3003',
  historicalServer: 'http://192.168.1.111:3002',
  proxyServer: 'http://192.168.1.111:3001' // Local IP for physical device testing
};

const PROD_CONFIG: ApiConfig = {
  realTimeServer: process.env.EXPO_PUBLIC_REALTIME_SERVER || 'https://d2d-realtime-server.onrender.com',
  historicalServer: process.env.EXPO_PUBLIC_HISTORICAL_SERVER || 'https://d2d-dynamic-server.onrender.com',
  proxyServer: process.env.EXPO_PUBLIC_PROXY_SERVER || 'https://d2d-dynamic-server.onrender.com'
};

export const API_CONFIG = __DEV__ ? DEV_CONFIG : PROD_CONFIG;

// Helper function to get the appropriate server URL
export function getRealtimeServerUrl(endpoint: string): string {
  return `${API_CONFIG.realTimeServer}${endpoint}`;
}

export function getHistoricalServerUrl(endpoint: string): string {
  return `${API_CONFIG.historicalServer}${endpoint}`;
}

export function getProxyServerUrl(endpoint: string): string {
  return `${API_CONFIG.proxyServer}${endpoint}`;
}
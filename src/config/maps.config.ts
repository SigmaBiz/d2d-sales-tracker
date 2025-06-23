/**
 * Maps Configuration
 * Centralized configuration for map providers
 */

export const MAPS_CONFIG = {
  // Google Maps API Key
  // TODO: Replace with your actual API key
  // Get one at: https://console.cloud.google.com/apis/credentials
  GOOGLE_MAPS_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY',
  
  // Map provider selection
  // Options: 'google' | 'osm'
  MAP_PROVIDER: 'google' as const,
  
  // Default map settings
  DEFAULT_ZOOM: 16,
  MAX_ZOOM: 21,
  MIN_ZOOM: 10,
  
  // OKC Default Center
  DEFAULT_CENTER: {
    lat: 35.4676,
    lng: -97.5164
  }
};

// Validate configuration
if (MAPS_CONFIG.MAP_PROVIDER === 'google' && MAPS_CONFIG.GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY') {
  console.warn('⚠️ Google Maps API key not configured! Update MAPS_CONFIG.GOOGLE_MAPS_API_KEY');
}
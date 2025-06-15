/**
 * Weather Service Configuration
 * Centralized configuration for weather data providers
 */

export interface WeatherConfig {
  provider: 'weatherapi' | 'mrms' | 'proxy' | 'mock';
  apiKey?: string;
  proxyUrl?: string;
  cacheEnabled: boolean;
  cacheTTL: number; // in milliseconds
  rateLimitDelay: number; // in milliseconds
  fallbackEnabled: boolean;
  debugMode: boolean;
}

// Default configuration
export const defaultWeatherConfig: WeatherConfig = {
  provider: 'weatherapi',
  apiKey: process.env.WEATHER_API_KEY,
  cacheEnabled: true,
  cacheTTL: 5 * 60 * 1000, // 5 minutes
  rateLimitDelay: 1000, // 1 second
  fallbackEnabled: true,
  debugMode: __DEV__ || false
};

// Phase 2 configuration (when proxy is ready)
export const proxyWeatherConfig: WeatherConfig = {
  provider: 'proxy',
  proxyUrl: process.env.WEATHER_PROXY_URL || 'https://your-proxy.vercel.app/api/weather',
  cacheEnabled: true,
  cacheTTL: 1 * 60 * 1000, // 1 minute (shorter since proxy has its own cache)
  rateLimitDelay: 100, // 100ms (proxy handles rate limiting)
  fallbackEnabled: true,
  debugMode: false
};

// Development configuration
export const devWeatherConfig: WeatherConfig = {
  provider: 'mock',
  cacheEnabled: false,
  cacheTTL: 0,
  rateLimitDelay: 0,
  fallbackEnabled: false,
  debugMode: true
};

// Get current configuration based on environment
export function getWeatherConfig(): WeatherConfig {
  // Check if we have a WeatherAPI key
  if (process.env.WEATHER_API_KEY && process.env.WEATHER_API_KEY !== 'YOUR_API_KEY_HERE') {
    return defaultWeatherConfig;
  }
  
  // Check if proxy is configured
  if (process.env.WEATHER_PROXY_URL) {
    return proxyWeatherConfig;
  }
  
  // Fall back to development mode
  return devWeatherConfig;
}

// Validate configuration
export function validateWeatherConfig(config: WeatherConfig): boolean {
  if (config.provider === 'weatherapi' && !config.apiKey) {
    console.error('WeatherAPI provider requires an API key');
    return false;
  }
  
  if (config.provider === 'proxy' && !config.proxyUrl) {
    console.error('Proxy provider requires a proxy URL');
    return false;
  }
  
  return true;
}
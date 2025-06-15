/**
 * WeatherAPI.com Integration Service
 * Provides real-time weather data including severe weather alerts
 * Free tier: 1M calls/month
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';

// Configuration
const WEATHER_API_KEY = process.env.EXPO_PUBLIC_WEATHER_API_KEY || 'YOUR_API_KEY_HERE';
const WEATHER_API_BASE = 'https://api.weatherapi.com/v1';

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = '@weather_api_cache';

interface WeatherAlert {
  headline: string;
  msgtype: string;
  severity: string;
  urgency: string;
  areas: string;
  category: string;
  certainty: string;
  event: string;
  note: string;
  effective: string;
  expires: string;
  desc: string;
}

interface WeatherLocation {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  tz_id: string;
  localtime_epoch: number;
  localtime: string;
}

interface WeatherCondition {
  text: string;
  icon: string;
  code: number;
}

interface CurrentWeather {
  temp_c: number;
  temp_f: number;
  condition: WeatherCondition;
  wind_mph: number;
  wind_kph: number;
  wind_degree: number;
  wind_dir: string;
  pressure_mb: number;
  pressure_in: number;
  precip_mm: number;
  precip_in: number;
  humidity: number;
  cloud: number;
  feelslike_c: number;
  feelslike_f: number;
  vis_km: number;
  vis_miles: number;
  uv: number;
  gust_mph: number;
  gust_kph: number;
}

interface WeatherApiResponse {
  location: WeatherLocation;
  current: CurrentWeather;
  alerts?: {
    alert: WeatherAlert[];
  };
}

export class WeatherApiService {
  /**
   * Check if we have a valid API key
   */
  static hasApiKey(): boolean {
    return WEATHER_API_KEY !== 'YOUR_API_KEY_HERE' && WEATHER_API_KEY.length > 0;
  }

  /**
   * Get cached data if available and fresh
   */
  private static async getCachedData(key: string): Promise<any | null> {
    try {
      const cached = await AsyncStorage.getItem(`${CACHE_KEY}_${key}`);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        console.log('Using cached weather data');
        return data;
      }
    } catch (error) {
      console.error('Cache read error:', error);
    }
    return null;
  }

  /**
   * Save data to cache
   */
  private static async setCachedData(key: string, data: any): Promise<void> {
    try {
      await AsyncStorage.setItem(
        `${CACHE_KEY}_${key}`,
        JSON.stringify({
          data,
          timestamp: Date.now()
        })
      );
    } catch (error) {
      console.error('Cache write error:', error);
    }
  }

  /**
   * Fetch weather data for a location
   */
  static async fetchWeatherData(lat: number, lon: number): Promise<WeatherApiResponse | null> {
    if (!this.hasApiKey()) {
      console.warn('WeatherAPI key not configured');
      return null;
    }

    const cacheKey = `weather_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    
    // Check cache first
    const cached = await this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const url = `${WEATHER_API_BASE}/current.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&alerts=yes`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache the response
      await this.setCachedData(cacheKey, data);
      
      return data;
    } catch (error) {
      console.error('WeatherAPI fetch error:', error);
      return null;
    }
  }

  /**
   * Convert weather alerts to hail reports
   */
  static async convertAlertsToHailReports(lat: number, lon: number): Promise<HailReport[]> {
    const weatherData = await this.fetchWeatherData(lat, lon);
    if (!weatherData || !weatherData.alerts?.alert) {
      return [];
    }

    const hailReports: HailReport[] = [];
    const now = new Date();

    // Process each alert
    weatherData.alerts.alert.forEach((alert, index) => {
      // Look for hail-related alerts
      const isHailAlert = 
        alert.event.toLowerCase().includes('hail') ||
        alert.desc.toLowerCase().includes('hail') ||
        alert.headline.toLowerCase().includes('hail') ||
        (alert.event.toLowerCase().includes('thunderstorm') && 
         alert.desc.toLowerCase().includes('large hail'));

      if (isHailAlert) {
        // Extract hail size from description if possible
        let estimatedSize = 1.0; // Default 1 inch
        
        // Common hail size descriptions
        const sizePatterns = [
          { pattern: /softball|grapefruit|4[\s-]?inch/i, size: 4.0 },
          { pattern: /baseball|apple|3[\s-]?inch/i, size: 3.0 },
          { pattern: /tennis\s?ball|2\.5[\s-]?inch/i, size: 2.5 },
          { pattern: /golf\s?ball|1\.75[\s-]?inch/i, size: 1.75 },
          { pattern: /ping\s?pong|walnut|1\.5[\s-]?inch/i, size: 1.5 },
          { pattern: /quarter|1[\s-]?inch/i, size: 1.0 },
          { pattern: /nickel|0\.75[\s-]?inch|3\/4[\s-]?inch/i, size: 0.75 },
          { pattern: /penny|dime|0\.5[\s-]?inch|1\/2[\s-]?inch/i, size: 0.5 }
        ];

        for (const { pattern, size } of sizePatterns) {
          if (pattern.test(alert.desc) || pattern.test(alert.headline)) {
            estimatedSize = size;
            break;
          }
        }

        // Calculate confidence based on alert certainty and severity
        let confidence = 50; // Base confidence
        if (alert.certainty === 'Observed') confidence += 30;
        else if (alert.certainty === 'Likely') confidence += 20;
        else if (alert.certainty === 'Possible') confidence += 10;

        if (alert.severity === 'Extreme') confidence += 20;
        else if (alert.severity === 'Severe') confidence += 15;
        else if (alert.severity === 'Moderate') confidence += 10;

        // Add some random variation around the alert location
        const latOffset = (Math.random() - 0.5) * 0.1; // ~5-10km variation
        const lonOffset = (Math.random() - 0.5) * 0.1;

        hailReports.push({
          id: `weather_api_${now.getTime()}_${index}`,
          latitude: weatherData.location.lat + latOffset,
          longitude: weatherData.location.lon + lonOffset,
          size: estimatedSize,
          timestamp: new Date(alert.effective),
          confidence: Math.min(confidence, 100),
          city: weatherData.location.name,
          isMetroOKC: this.isMetroOKC(weatherData.location.name)
        });
      }
    });

    // Also check current conditions for severe weather
    if (weatherData.current.condition.code >= 1273 && weatherData.current.condition.code <= 1282) {
      // These codes indicate thunderstorm conditions
      const baseConfidence = 30 + (weatherData.current.wind_mph > 50 ? 20 : 0);
      
      hailReports.push({
        id: `weather_current_${now.getTime()}`,
        latitude: weatherData.location.lat,
        longitude: weatherData.location.lon,
        size: 0.75, // Conservative estimate for current conditions
        timestamp: now,
        confidence: baseConfidence,
        city: weatherData.location.name,
        isMetroOKC: this.isMetroOKC(weatherData.location.name)
      });
    }

    return hailReports;
  }

  /**
   * Check if location is in Metro OKC
   */
  private static isMetroOKC(city: string): boolean {
    const metroOKCCities = [
      'Oklahoma City',
      'Norman',
      'Edmond',
      'Moore',
      'Midwest City',
      'Del City',
      'Yukon',
      'Mustang',
      'Bethany',
      'The Village',
      'Nichols Hills',
      'Warr Acres'
    ];

    return metroOKCCities.some(metroCity => 
      city.toLowerCase().includes(metroCity.toLowerCase())
    );
  }

  /**
   * Fetch hail reports for Oklahoma region
   */
  static async fetchOklahomaHailReports(): Promise<HailReport[]> {
    // Key Oklahoma cities to check
    const oklahomaLocations = [
      { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164 },
      { name: 'Norman', lat: 35.2226, lon: -97.4395 },
      { name: 'Edmond', lat: 35.6528, lon: -97.4781 },
      { name: 'Tulsa', lat: 36.1540, lon: -95.9928 },
      { name: 'Lawton', lat: 34.6037, lon: -98.3959 },
      { name: 'Enid', lat: 36.3956, lon: -97.8784 }
    ];

    const allReports: HailReport[] = [];

    // Check each location for alerts
    for (const location of oklahomaLocations) {
      try {
        const reports = await this.convertAlertsToHailReports(location.lat, location.lon);
        allReports.push(...reports);
      } catch (error) {
        console.error(`Error fetching weather for ${location.name}:`, error);
      }
    }

    // Remove duplicates based on proximity
    const uniqueReports = this.deduplicateReports(allReports);
    
    console.log(`WeatherAPI: Found ${uniqueReports.length} hail reports in Oklahoma`);
    return uniqueReports;
  }

  /**
   * Remove duplicate reports that are too close together
   */
  private static deduplicateReports(reports: HailReport[]): HailReport[] {
    const unique: HailReport[] = [];
    const threshold = 0.05; // ~5km

    for (const report of reports) {
      const isDuplicate = unique.some(existing => 
        Math.abs(existing.latitude - report.latitude) < threshold &&
        Math.abs(existing.longitude - report.longitude) < threshold &&
        Math.abs(existing.timestamp.getTime() - report.timestamp.getTime()) < 3600000 // 1 hour
      );

      if (!isDuplicate) {
        unique.push(report);
      }
    }

    return unique;
  }

  /**
   * Test the API connection
   */
  static async testConnection(): Promise<boolean> {
    try {
      const data = await this.fetchWeatherData(35.4676, -97.5164); // OKC
      return data !== null;
    } catch (error) {
      console.error('WeatherAPI test failed:', error);
      return false;
    }
  }
}
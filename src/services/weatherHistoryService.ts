/**
 * Weather History Search Service
 * Allows searching for historical weather events by date, location, etc.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';

const WEATHER_API_KEY = process.env.EXPO_PUBLIC_WEATHER_API_KEY || '';
const WEATHER_API_BASE = 'https://api.weatherapi.com/v1';

// Cache for search results
const SEARCH_CACHE_KEY = '@weather_search_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

export interface SearchParams {
  location?: string; // Address, city, or zip code
  date?: Date; // Specific date to search
  dateRange?: {
    start: Date;
    end: Date;
  };
  radius?: number; // Search radius in miles
}

export interface HistoricalStormEvent {
  date: Date;
  location: {
    name: string;
    lat: number;
    lon: number;
  };
  maxHailSize: number;
  reports: HailReport[];
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  description: string;
}

export class WeatherHistoryService {
  /**
   * Search for historical weather events
   */
  static async searchStorms(params: SearchParams): Promise<HistoricalStormEvent[]> {
    const cacheKey = this.getCacheKey(params);
    
    // Check cache first
    const cached = await this.getCachedSearch(cacheKey);
    if (cached) {
      console.log('Using cached search results');
      return cached;
    }

    const events: HistoricalStormEvent[] = [];

    try {
      // If searching by date range
      if (params.dateRange) {
        const days = this.getDaysBetween(params.dateRange.start, params.dateRange.end);
        
        // WeatherAPI free tier allows up to 7 days of history
        const limitedDays = days.slice(0, 7);
        
        for (const date of limitedDays) {
          const dayEvents = await this.searchByDate(params.location || 'Oklahoma', date);
          events.push(...dayEvents);
        }
      } 
      // If searching by specific date
      else if (params.date) {
        const dayEvents = await this.searchByDate(params.location || 'Oklahoma', params.date);
        events.push(...dayEvents);
      }
      // If searching by location only (last 7 days)
      else if (params.location) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        
        for (let i = 0; i < 7; i++) {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const dayEvents = await this.searchByDate(params.location, date);
          events.push(...dayEvents);
        }
      }

      // Cache the results
      await this.cacheSearch(cacheKey, events);
      
      return events;
    } catch (error) {
      console.error('Weather history search error:', error);
      return events;
    }
  }

  /**
   * Search for events on a specific date
   */
  private static async searchByDate(location: string, date: Date): Promise<HistoricalStormEvent[]> {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    try {
      const url = `${WEATHER_API_BASE}/history.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(location)}&dt=${dateStr}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`History API error for ${dateStr}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      return this.parseHistoricalData(data, date);
    } catch (error) {
      console.error(`Error fetching history for ${dateStr}:`, error);
      return [];
    }
  }

  /**
   * Parse historical weather data into storm events
   */
  private static parseHistoricalData(data: any, date: Date): HistoricalStormEvent[] {
    const events: HistoricalStormEvent[] = [];
    
    if (!data.forecast?.forecastday?.[0]) return events;
    
    const day = data.forecast.forecastday[0];
    const location = data.location;
    
    // Check for severe weather conditions
    const hourlyData = day.hour || [];
    const severeHours = hourlyData.filter((hour: any) => {
      // Check for thunderstorm conditions or high winds
      return (
        hour.condition.code >= 1273 && hour.condition.code <= 1282 || // Thunderstorm codes
        hour.wind_mph > 50 || // High winds
        hour.gust_mph > 60 || // Strong gusts
        hour.condition.text.toLowerCase().includes('hail') ||
        hour.condition.text.toLowerCase().includes('thunder')
      );
    });

    if (severeHours.length > 0) {
      // Find the most severe hour
      const peakHour = severeHours.reduce((max: any, hour: any) => 
        hour.wind_mph > max.wind_mph ? hour : max
      );

      // Create hail reports from severe weather data
      const reports: HailReport[] = severeHours.map((hour: any, index: number) => {
        // Estimate hail size based on conditions
        let estimatedSize = 0.5; // Base size
        if (hour.wind_mph > 60) estimatedSize = 1.0;
        if (hour.wind_mph > 70) estimatedSize = 1.5;
        if (hour.gust_mph > 80) estimatedSize = 2.0;
        if (hour.condition.text.toLowerCase().includes('severe')) estimatedSize = 2.5;

        return {
          id: `historical_${date.getTime()}_${index}`,
          latitude: location.lat + (Math.random() - 0.5) * 0.1,
          longitude: location.lon + (Math.random() - 0.5) * 0.1,
          size: estimatedSize,
          timestamp: new Date(hour.time),
          confidence: 70, // Historical data confidence
          city: location.name,
          isMetroOKC: this.isMetroOKC(location.name)
        };
      });

      // Determine severity
      let severity: 'minor' | 'moderate' | 'severe' | 'extreme' = 'minor';
      const maxWindSpeed = Math.max(...severeHours.map((h: any) => h.wind_mph));
      if (maxWindSpeed > 80) severity = 'extreme';
      else if (maxWindSpeed > 70) severity = 'severe';
      else if (maxWindSpeed > 60) severity = 'moderate';

      events.push({
        date: new Date(day.date),
        location: {
          name: location.name,
          lat: location.lat,
          lon: location.lon
        },
        maxHailSize: Math.max(...reports.map(r => r.size)),
        reports: reports,
        severity: severity,
        description: `${severity.charAt(0).toUpperCase() + severity.slice(1)} weather with ${peakHour.condition.text}. Peak winds: ${maxWindSpeed} mph`
      });
    }

    return events;
  }

  /**
   * Get days between two dates
   */
  private static getDaysBetween(start: Date, end: Date): Date[] {
    const days: Date[] = [];
    const current = new Date(start);
    
    while (current <= end) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return days;
  }

  /**
   * Check if location is in Metro OKC
   */
  private static isMetroOKC(city: string): boolean {
    const metroOKCCities = [
      'Oklahoma City', 'Norman', 'Edmond', 'Moore', 
      'Midwest City', 'Del City', 'Yukon', 'Mustang'
    ];
    
    return metroOKCCities.some(metroCity => 
      city.toLowerCase().includes(metroCity.toLowerCase())
    );
  }

  /**
   * Generate cache key for search params
   */
  private static getCacheKey(params: SearchParams): string {
    return `search_${JSON.stringify(params)}`;
  }

  /**
   * Get cached search results
   */
  private static async getCachedSearch(key: string): Promise<HistoricalStormEvent[] | null> {
    try {
      const cached = await AsyncStorage.getItem(`${SEARCH_CACHE_KEY}_${key}`);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        // Restore Date objects
        return data.map((event: any) => ({
          ...event,
          date: new Date(event.date),
          reports: event.reports.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp)
          }))
        }));
      }
    } catch (error) {
      console.error('Cache read error:', error);
    }
    return null;
  }

  /**
   * Cache search results
   */
  private static async cacheSearch(key: string, data: HistoricalStormEvent[]): Promise<void> {
    try {
      await AsyncStorage.setItem(
        `${SEARCH_CACHE_KEY}_${key}`,
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
   * Search for recent storms in a specific area
   */
  static async searchRecentStorms(zipCode: string): Promise<HistoricalStormEvent[]> {
    return this.searchStorms({
      location: zipCode,
      dateRange: {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        end: new Date()
      }
    });
  }

  /**
   * Get storm history for a specific date
   */
  static async getStormsByDate(date: Date, location: string = 'Oklahoma'): Promise<HistoricalStormEvent[]> {
    return this.searchStorms({
      location,
      date
    });
  }
}
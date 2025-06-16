/**
 * Weather History Search Service
 * Uses IEM Archives for historical storm data
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';
import { IEMArchiveService } from './iemArchiveService';
import { MRMSProxyService } from './mrmsProxyService';

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
  severity: 'low' | 'moderate' | 'severe' | 'extreme';
  hailSize: number; // in inches
  reports: HailReport[];
  confidence: number;
  source: string;
}

export class WeatherHistoryService {
  /**
   * Search for historical storms based on parameters
   */
  static async searchStorms(params: SearchParams): Promise<HistoricalStormEvent[]> {
    // Check cache first
    const cacheKey = JSON.stringify(params);
    const cached = await this.getCachedSearch(cacheKey);
    if (cached) return cached;

    let results: HistoricalStormEvent[] = [];

    try {
      if (params.date) {
        // Single date search using IEM
        console.log('[WeatherHistory] Searching for date:', params.date.toISOString());
        const reports = await IEMArchiveService.fetchHistoricalMESH(params.date);
        console.log('[WeatherHistory] IEM returned', reports.length, 'reports');
        if (reports.length > 0) {
          const stormEvent = this.createStormEvent(params.date, reports);
          console.log('[WeatherHistory] Created storm event:', stormEvent);
          results.push(stormEvent);
        }
      } else if (params.dateRange) {
        // Date range search
        const { start, end } = params.dateRange;
        const current = new Date(start);
        
        while (current <= end) {
          try {
            const reports = await IEMArchiveService.fetchHistoricalMESH(current);
            if (reports.length > 0) {
              results.push(this.createStormEvent(current, reports));
            }
          } catch (error) {
            console.error(`Error fetching ${current.toISOString()}:`, error);
          }
          
          // Move to next day
          current.setDate(current.getDate() + 1);
        }
      } else if (params.location) {
        // Location-based search - get recent storms
        results = await this.searchByLocation(params.location, params.radius || 10);
      } else {
        // Default: Get recent storms (last 7 days)
        results = await this.getRecentStorms();
      }

      // Cache results
      await this.cacheSearch(cacheKey, results);
      
      return results;
    } catch (error) {
      console.error('Storm search error:', error);
      return [];
    }
  }

  /**
   * Get recent storms (last 7 days)
   */
  static async getRecentStorms(): Promise<HistoricalStormEvent[]> {
    const results: HistoricalStormEvent[] = [];
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const current = new Date(startDate);
    while (current <= endDate) {
      try {
        const reports = await IEMArchiveService.fetchHistoricalMESH(current);
        if (reports.length > 0) {
          results.push(this.createStormEvent(current, reports));
        }
      } catch (error) {
        console.error(`Error fetching ${current.toISOString()}:`, error);
      }
      
      current.setDate(current.getDate() + 1);
    }

    return results;
  }

  /**
   * Search by location
   */
  static async searchByLocation(location: string, radiusMiles: number): Promise<HistoricalStormEvent[]> {
    // In production, geocode the location first
    // For now, search recent storms and filter by Oklahoma
    const recent = await this.getRecentStorms();
    
    // Filter by location name if it matches
    return recent.filter(storm => 
      storm.location.name.toLowerCase().includes(location.toLowerCase())
    );
  }

  /**
   * Create storm event from reports
   */
  private static createStormEvent(date: Date, reports: HailReport[]): HistoricalStormEvent {
    console.log('[WeatherHistory] Creating storm event from', reports.length, 'reports');
    const maxSize = Math.max(...reports.map(r => r.size));
    const avgConfidence = reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length;
    
    // Calculate center location
    const centerLat = reports.reduce((sum, r) => sum + r.latitude, 0) / reports.length;
    const centerLon = reports.reduce((sum, r) => sum + r.longitude, 0) / reports.length;
    
    // Determine city name from reports
    const cityName = reports.find(r => r.city)?.city || 'Oklahoma';
    
    console.log('[WeatherHistory] Storm event details - City:', cityName, 'Max size:', maxSize, 'Reports:', reports.length);
    
    return {
      date,
      location: {
        name: cityName,
        lat: centerLat,
        lon: centerLon
      },
      severity: this.getSeverity(maxSize),
      hailSize: maxSize,
      reports,
      confidence: avgConfidence,
      source: reports[0]?.source || 'IEM Archive'
    };
  }

  /**
   * Get severity based on hail size
   */
  private static getSeverity(sizeInches: number): 'low' | 'moderate' | 'severe' | 'extreme' {
    if (sizeInches >= 4) return 'extreme';   // Softball+
    if (sizeInches >= 2) return 'severe';    // Hen egg+
    if (sizeInches >= 1) return 'moderate';  // Quarter+
    return 'low';                            // Smaller
  }

  /**
   * Cache search results
   */
  private static async cacheSearch(key: string, results: HistoricalStormEvent[]): Promise<void> {
    try {
      await AsyncStorage.setItem(
        `${SEARCH_CACHE_KEY}_${key}`,
        JSON.stringify({
          results,
          timestamp: Date.now()
        })
      );
    } catch (error) {
      console.error('Cache error:', error);
    }
  }

  /**
   * Get cached search results
   */
  private static async getCachedSearch(key: string): Promise<HistoricalStormEvent[] | null> {
    try {
      const cached = await AsyncStorage.getItem(`${SEARCH_CACHE_KEY}_${key}`);
      if (!cached) return null;

      const { results, timestamp } = JSON.parse(cached);
      
      // Check if cache is still valid
      if (Date.now() - timestamp > CACHE_DURATION) {
        return null;
      }

      // Restore date objects
      return results.map((event: any) => ({
        ...event,
        date: new Date(event.date),
        reports: event.reports.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp)
        }))
      }));
    } catch (error) {
      console.error('Cache error:', error);
      return null;
    }
  }

  /**
   * Clear search cache
   */
  static async clearCache(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith(SEARCH_CACHE_KEY));
    await AsyncStorage.multiRemove(cacheKeys);
  }

  /**
   * Get pre-defined significant storm dates
   */
  static getSignificantStormDates(): { date: Date; name: string; description: string }[] {
    return [
      {
        date: new Date(2024, 8, 24), // Sept 24, 2024 in local time
        name: 'September 24, 2024',
        description: 'Major hail event - Oklahoma City Metro'
      },
      {
        date: new Date(2024, 4, 15), // May 15, 2024
        name: 'May 15, 2024',
        description: 'Severe storms - Central Oklahoma'
      },
      {
        date: new Date(2023, 5, 14), // June 14, 2023
        name: 'June 14, 2023',
        description: 'Significant hail - Norman area'
      },
      {
        date: new Date(2024, 3, 27), // April 27, 2024
        name: 'April 27, 2024',
        description: 'Widespread hail - OKC to Tulsa'
      },
      {
        date: new Date(2023, 4, 2), // May 2, 2023
        name: 'May 2, 2023',
        description: 'Supercell storms - Moore/Norman'
      },
      {
        date: new Date(2022, 4, 4), // May 4, 2022
        name: 'May 4, 2022',
        description: 'Historic hail outbreak - Statewide'
      }
    ];
  }
}
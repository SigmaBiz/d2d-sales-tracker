/**
 * TIER 2: IEM Archive Service
 * Provides proven, validated hail data for strategic territory planning
 * Data Flow: 24-48hrs Later → IEM Archive → Validated MESH → Territory Planning
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';
import { getHistoricalServerUrl } from '../config/api.config';

export interface IEMArchiveData {
  date: Date;
  meshData: any[];
  validated: boolean;
  confidence: number;
}

export class IEMArchiveService {

  /**
   * Fetch historical storm data from IEM Archive
   * @param date - Date to fetch (24-48 hours in the past for validated data)
   */
  static async fetchHistoricalStorm(date: Date): Promise<HailReport[]> {
    const dateStr = date.toISOString().split('T')[0];
    console.log(`[TIER 2] Fetching MESH data for ${dateStr}`);

    const url = getHistoricalServerUrl(`/api/mesh/${dateStr}`);
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        // Cache cold — no MESH data processed for this date yet.
        // Run: npm run preprocess <date>
        console.log(`[TIER 2] No MESH data for ${dateStr} — run: npm run preprocess ${dateStr}`);
        return [];
      }
      throw new Error(`[TIER 2] Server returned ${response.status} for ${dateStr}`);
    }

    const data = await response.json();
    return (data.reports || []).map((r: any) => ({
      ...r,
      timestamp: new Date(r.timestamp),
    }));
  }

  /**
   * Fetch archive data (needs proxy in production due to CORS)
   */
  /**
   * Fetch last 12 months of storm data for OKC Metro
   */
  static async fetchLast12Months(): Promise<any> {
    try {
      console.log('[TIER 2] Fetching last 12 months of OKC Metro storm data...');
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 12);
      
      // First, get available significant dates
      const availableUrl = getHistoricalServerUrl('/api/mesh/available');
      const availableResponse = await fetch(availableUrl);
      
      if (!availableResponse.ok) {
        throw new Error('Failed to get available dates');
      }
      
      const { availableDates } = await availableResponse.json();
      
      // Fetch data for each significant date
      const allStorms = [];
      
      for (const dateInfo of availableDates) {
        try {
          const reports = await this.fetchHistoricalStorm(new Date(dateInfo.date));
          if (reports.length > 0) {
            allStorms.push({
              date: dateInfo.date,
              description: dateInfo.description,
              reports: reports,
              maxSize: Math.max(...reports.map(r => r.size)),
              totalReports: reports.length
            });
          }
        } catch (error) {
          console.error(`[TIER 2] Error fetching ${dateInfo.date}:`, error);
        }
      }
      
      return {
        period: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        },
        storms: allStorms,
        summary: {
          totalStormDays: allStorms.length,
          totalReports: allStorms.reduce((sum, s) => sum + s.totalReports, 0),
          largestHail: Math.max(...allStorms.map(s => s.maxSize))
        }
      };
      
    } catch (error) {
      console.error('[TIER 2] Error fetching 12-month data:', error);
      throw error;
    }
  }

  /**
   * Get historical storm library (searchable database back to 2019)
   */
  static async getStormLibrary(
    startDate: Date, 
    endDate: Date,
    bounds?: { north: number; south: number; east: number; west: number }
  ): Promise<IEMArchiveData[]> {
    const library: IEMArchiveData[] = [];
    
    // Iterate through date range
    const current = new Date(startDate);
    while (current <= endDate) {
      try {
        const reports = await this.fetchHistoricalStorm(current);
        
        // Filter by bounds if provided
        const filtered = bounds ? 
          reports.filter(r => 
            r.latitude <= bounds.north &&
            r.latitude >= bounds.south &&
            r.longitude <= bounds.east &&
            r.longitude >= bounds.west
          ) : reports;

        if (filtered.length > 0) {
          library.push({
            date: new Date(current),
            meshData: filtered,
            validated: true,
            confidence: 75
          });
        }
      } catch (error) {
        console.error(`[TIER 2] Error fetching ${current.toISOString()}:`, error);
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    return library;
  }

  /**
   * Generate territory heat map (cumulative hail damage probability)
   */
  static async generateTerritoryHeatMap(
    bounds: { north: number; south: number; east: number; west: number },
    dateRange: { start: Date; end: Date }
  ): Promise<any> {
    const gridSize = 0.01;  // ~1km grid
    const heatMap = new Map<string, number>();

    // Get all storms in date range
    const storms = await this.getStormLibrary(dateRange.start, dateRange.end, bounds);

    // Accumulate damage probability
    storms.forEach(storm => {
      storm.meshData.forEach(report => {
        const gridKey = `${Math.floor(report.latitude / gridSize)},${Math.floor(report.longitude / gridSize)}`;
        const current = heatMap.get(gridKey) || 0;
        
        // Weight by hail size
        const weight = report.size >= 2 ? 1.0 : 
                      report.size >= 1.5 ? 0.7 :
                      report.size >= 1 ? 0.5 : 0.3;
        
        heatMap.set(gridKey, current + weight);
      });
    });

    return {
      bounds,
      gridSize,
      data: Array.from(heatMap.entries()).map(([key, value]) => {
        const [latIdx, lonIdx] = key.split(',').map(Number);
        return {
          lat: latIdx * gridSize,
          lon: lonIdx * gridSize,
          probability: value / storms.length  // Normalize
        };
      })
    };
  }

  /**
   * Customer presentation mode - show historical impact at address
   */
  static async getAddressHailHistory(
    latitude: number,
    longitude: number,
    radiusMiles: number = 1
  ): Promise<any> {
    const radiusDegrees = radiusMiles / 69;  // Rough conversion
    const history: any[] = [];

    // Check last 5 years
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5);

    // Get cached data first
    const cacheKey = `@address_history_${latitude.toFixed(3)}_${longitude.toFixed(3)}`;
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (new Date().getTime() - new Date(data.cached).getTime() < 7 * 24 * 60 * 60 * 1000) {
        return data.history;
      }
    }

    // Fetch yearly data
    for (let year = startDate.getFullYear(); year <= endDate.getFullYear(); year++) {
      // Check key storm dates for each year
      const stormDates = await this.getSignificantStormDates(year);
      
      for (const date of stormDates) {
        const reports = await this.fetchHistoricalStorm(date);
        const nearby = reports.filter(r => {
          const distance = Math.sqrt(
            Math.pow(r.latitude - latitude, 2) + 
            Math.pow(r.longitude - longitude, 2)
          );
          return distance <= radiusDegrees;
        });

        if (nearby.length > 0) {
          history.push({
            date,
            reports: nearby,
            maxSize: Math.max(...nearby.map(r => r.size)),
            distance: Math.min(...nearby.map(r => 
              Math.sqrt(
                Math.pow(r.latitude - latitude, 2) + 
                Math.pow(r.longitude - longitude, 2)
              ) * 69  // Convert to miles
            ))
          });
        }
      }
    }

    // Cache results
    await AsyncStorage.setItem(cacheKey, JSON.stringify({
      history,
      cached: new Date()
    }));

    return history;
  }

  /**
   * Get significant storm dates for a year
   */
  private static async getSignificantStormDates(year: number): Promise<Date[]> {
    // In production, this would query IEM for storm event days
    // For now, return some known significant dates
    const knownStorms: { [key: number]: string[] } = {
      2024: ['2024-09-24', '2024-05-15', '2024-04-27'],
      2023: ['2023-06-14', '2023-05-02', '2023-04-19'],
      2022: ['2022-05-04', '2022-04-30', '2022-04-23']
    };

    return (knownStorms[year] || []).map(d => new Date(d));
  }
}
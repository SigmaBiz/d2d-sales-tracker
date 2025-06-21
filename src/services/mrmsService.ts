/**
 * MRMS Service - WITHOUT WeatherAPI dependency
 * Uses only NOAA MRMS and IEM data sources
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MRMSParser } from './mrmsParser';
import { ConfidenceScoring } from './confidenceScoring';
import { MRMSProxyService } from './mrmsProxyService';
import { NCEPMRMSService } from './tier1NCEPService';
import { IEMArchiveService } from './tier2IEMService';

export interface HailReport {
  id: string;
  latitude: number;
  longitude: number;
  size: number; // in inches
  timestamp: Date;
  confidence: number;
  city?: string;
  isMetroOKC?: boolean;
  source?: string;
  meshValue?: number; // Raw MESH value in mm
  polygon?: number[][]; // For contour data
  groundTruth?: boolean; // True if verified by Storm Events Database
  confidenceFactors?: {
    sizeScore: number;
    temporalScore: number;
    spatialScore: number;
    multiRadarScore: number;
  };
}

export interface StormEvent {
  id: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  reports: HailReport[];
  maxSize: number;
  center: { lat: number; lon: number };
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  isActive: boolean;
  enabled?: boolean;
  source: 'MRMS' | 'IEM' | 'Mock';
  confidence: number;
}

export class MRMSService {
  private static STORAGE_KEY = '@mrms_storms';
  private static LAST_UPDATE_KEY = '@mrms_last_update';
  private static MAX_STORMS = 3;
  private static UPDATE_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

  /**
   * Fetch current hail data - NOAA MRMS ONLY
   */
  static async fetchCurrentHailData(): Promise<HailReport[]> {
    try {
      console.log('[MRMS] Fetching real-time data from NOAA MRMS...');
      
      // Try TIER 1: NCEP MRMS first
      let reports = await NCEPMRMSService.checkForNewStorms();
      
      if (reports && reports.length > 0) {
        console.log(`[MRMS] Found ${reports.length} reports from NCEP MRMS`);
        return reports;
      }

      // Try proxy if direct NCEP fails
      reports = await MRMSProxyService.fetchRealtimeMRMS();
      
      if (reports && reports.length > 0) {
        console.log(`[MRMS] Found ${reports.length} reports from MRMS Proxy`);
        return reports;
      }

      // If no current storms, check recent historical (last 2 hours)
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
      
      reports = await IEMArchiveService.fetchHistoricalStorm(twoHoursAgo);
      
      if (reports && reports.length > 0) {
        console.log(`[MRMS] Found ${reports.length} recent reports from IEM`);
        return reports;
      }

      console.log('[MRMS] No active hail detected');
      return [];

    } catch (error) {
      console.error('[MRMS] Error fetching data:', error);
      
      // Last resort: return mock data for testing ONLY
      if (__DEV__) {
        console.warn('[MRMS] Using mock data in development mode');
        return this.generateMockData();
      }
      
      return [];
    }
  }

  /**
   * Get active storms from storage
   */
  static async getActiveStorms(): Promise<StormEvent[]> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      if (!stored) return [];
      
      const storms: StormEvent[] = JSON.parse(stored);
      
      // Convert date strings back to Date objects
      return storms.map(storm => ({
        ...storm,
        startTime: new Date(storm.startTime),
        endTime: storm.endTime ? new Date(storm.endTime) : undefined,
        reports: storm.reports.map(report => ({
          ...report,
          timestamp: new Date(report.timestamp)
        }))
      }));
    } catch (error) {
      console.error('[MRMS] Error loading storms:', error);
      return [];
    }
  }

  /**
   * Save storm event
   */
  static async saveStormEvent(storm: StormEvent): Promise<void> {
    const storms = await this.getActiveStorms();
    
    // Check if storm already exists
    const existingIndex = storms.findIndex(s => s.id === storm.id);
    
    if (existingIndex >= 0) {
      storms[existingIndex] = storm;
    } else {
      storms.push(storm);
      
      // Maintain max storms limit
      if (storms.length > this.MAX_STORMS) {
        // Remove oldest inactive storm
        const inactiveStorms = storms.filter(s => !s.isActive);
        if (inactiveStorms.length > 0) {
          const oldest = inactiveStorms.sort((a, b) => 
            a.startTime.getTime() - b.startTime.getTime()
          )[0];
          const index = storms.findIndex(s => s.id === oldest.id);
          storms.splice(index, 1);
        }
      }
    }
    
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(storms));
  }

  /**
   * Group reports into storm events
   */
  static async groupIntoStormEvents(reports: HailReport[]): Promise<StormEvent> {
    if (reports.length === 0) {
      throw new Error('No reports to group');
    }
    
    // Calculate storm center
    const center = this.calculateCenter(reports);
    
    // Calculate bounds
    const bounds = this.calculateBounds(reports);
    
    // Calculate average confidence
    const avgConfidence = reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length;
    
    // Determine source more accurately
    const source = reports[0]?.source?.includes('NCEP') || reports[0]?.source?.includes('MRMS') ? 'MRMS' :
                  reports[0]?.source?.includes('IEM') || reports[0]?.source?.includes('Archive') ? 'IEM' : 'Mock';
    
    const storm: StormEvent = {
      id: `storm_${Date.now()}`,
      name: `Storm ${new Date().toLocaleTimeString()}`,
      startTime: new Date(Math.min(...reports.map(r => r.timestamp.getTime()))),
      reports: reports,
      maxSize: Math.max(...reports.map(r => r.size)),
      center: center,
      bounds: bounds,
      isActive: true,
      enabled: true,
      source: source,
      confidence: avgConfidence
    };
    
    return storm;
  }

  /**
   * Calculate center of reports
   */
  private static calculateCenter(reports: HailReport[]): { lat: number; lon: number } {
    const sum = reports.reduce((acc, report) => ({
      lat: acc.lat + report.latitude,
      lon: acc.lon + report.longitude
    }), { lat: 0, lon: 0 });
    
    return {
      lat: sum.lat / reports.length,
      lon: sum.lon / reports.length
    };
  }

  /**
   * Calculate bounds of reports
   */
  private static calculateBounds(reports: HailReport[]): { north: number; south: number; east: number; west: number } {
    if (reports.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }
    
    const lats = reports.map(r => r.latitude);
    const lons = reports.map(r => r.longitude);
    
    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lons),
      west: Math.min(...lons)
    };
  }

  /**
   * Check if update is needed
   */
  static async shouldUpdate(): Promise<boolean> {
    const lastUpdate = await AsyncStorage.getItem(this.LAST_UPDATE_KEY);
    if (!lastUpdate) return true;
    
    const lastUpdateTime = new Date(lastUpdate).getTime();
    const now = new Date().getTime();
    
    return (now - lastUpdateTime) > this.UPDATE_INTERVAL;
  }

  /**
   * Mark last update time
   */
  static async markUpdated(): Promise<void> {
    await AsyncStorage.setItem(this.LAST_UPDATE_KEY, new Date().toISOString());
  }

  /**
   * Clear all storms
   */
  static async clearAllStorms(): Promise<void> {
    await AsyncStorage.multiRemove([this.STORAGE_KEY, this.LAST_UPDATE_KEY]);
  }

  /**
   * Generate mock data for development ONLY
   */
  private static generateMockData(): HailReport[] {
    if (!__DEV__) return [];
    
    console.warn('[MRMS] Generating mock data for development');
    
    const mockReports: HailReport[] = [
      {
        id: `mock_${Date.now()}_1`,
        latitude: 35.4676,
        longitude: -97.5164,
        size: 1.75,
        timestamp: new Date(),
        confidence: 65,
        city: 'Oklahoma City',
        isMetroOKC: true,
        source: 'Mock Data',
        meshValue: 44.5
      },
      {
        id: `mock_${Date.now()}_2`,
        latitude: 35.2226,
        longitude: -97.4395,
        size: 1.25,
        timestamp: new Date(),
        confidence: 70,
        city: 'Norman',
        isMetroOKC: true,
        source: 'Mock Data',
        meshValue: 31.75
      }
    ];
    
    return mockReports;
  }

  /**
   * Toggle storm active status
   */
  static async toggleStormActive(stormId: string): Promise<void> {
    const storms = await this.getActiveStorms();
    const storm = storms.find(s => s.id === stormId);
    
    if (storm) {
      storm.isActive = !storm.isActive;
      if (!storm.isActive && !storm.endTime) {
        storm.endTime = new Date();
      }
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(storms));
    }
  }

  /**
   * Toggle storm enabled status (for display on map)
   */
  static async toggleStorm(stormId: string, enabled: boolean): Promise<void> {
    const storms = await this.getActiveStorms();
    const storm = storms.find(s => s.id === stormId);
    
    if (storm) {
      // Add enabled property if it doesn't exist
      (storm as any).enabled = enabled;
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(storms));
    }
  }

  /**
   * Delete a storm
   */
  static async deleteStorm(stormId: string): Promise<void> {
    const storms = await this.getActiveStorms();
    const filteredStorms = storms.filter(s => s.id !== stormId);
    await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredStorms));
  }

  /**
   * Focus on a specific storm (placeholder for future implementation)
   */
  static async focusOnStorm(stormId: string): Promise<void> {
    // This will be implemented to center the map on the storm
    console.log(`Focusing on storm: ${stormId}`);
  }

  /**
   * Get data source status
   */
  static async getDataSourceStatus(): Promise<{
    primary: 'MRMS' | 'IEM' | 'Mock';
    isLive: boolean;
    lastUpdate: Date | null;
  }> {
    const storms = await this.getActiveStorms();
    const lastUpdate = await AsyncStorage.getItem(this.LAST_UPDATE_KEY);
    
    // Check most recent storm source
    const recentStorm = storms
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0];
    
    return {
      primary: recentStorm?.source || 'MRMS',
      isLive: recentStorm?.source === 'MRMS',
      lastUpdate: lastUpdate ? new Date(lastUpdate) : null
    };
  }
}
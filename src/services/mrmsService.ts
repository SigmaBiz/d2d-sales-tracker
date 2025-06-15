/**
 * MRMS (Multi-Radar Multi-Sensor) Service
 * Fetches real-time hail data from NOAA
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MRMSParser } from './mrmsParser';
import { ConfidenceScoring, ConfidenceFactors } from './confidenceScoring';

// MRMS API endpoints
const MRMS_BASE_URL = 'https://mrms.ncep.noaa.gov/data/realtime/';
const MESH_ENDPOINT = 'MESH_Max_1440min'; // Maximum Expected Size of Hail (24hr)

// Oklahoma bounds
const OKLAHOMA_BOUNDS = {
  north: 37.0,
  south: 33.6,
  east: -94.4,
  west: -103.0
};

// Metro OKC cities for priority alerts
const METRO_OKC_CITIES = [
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

export interface HailReport {
  id: string;
  latitude: number;
  longitude: number;
  size: number; // in inches
  timestamp: Date;
  confidence: number; // 0-100%
  confidenceFactors?: ConfidenceFactors; // Detailed confidence breakdown
  city?: string;
  isMetroOKC?: boolean;
}

export interface StormEvent {
  id: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  peakSize: number;
  reports: HailReport[];
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  enabled: boolean;
}

export class MRMSService {
  private static STORAGE_KEY = '@hail_data';
  private static ALERT_LOG_KEY = '@hail_alerts';
  private static ACTIVE_STORMS_KEY = '@active_storms';
  
  /**
   * Fetch current MESH data for Oklahoma
   */
  static async fetchCurrentHailData(): Promise<HailReport[]> {
    try {
      // Try multiple data sources in order of preference
      let reports: HailReport[] = [];
      
      // 1. Try real MRMS data first
      try {
        reports = await MRMSParser.fetchLatestMESH();
        if (reports.length > 0) {
          console.log(`Fetched ${reports.length} real MRMS reports`);
          // Apply confidence scoring
          reports = await this.applyConfidenceScoring(reports);
          return reports;
        }
      } catch (error) {
        console.log('MRMS direct fetch failed, trying Mesonet...');
      }
      
      // 2. Try Iowa State Mesonet as backup
      try {
        reports = await MRMSParser.fetchFromMesonet();
        if (reports.length > 0) {
          console.log(`Fetched ${reports.length} reports from Mesonet`);
          // Apply confidence scoring
          reports = await this.applyConfidenceScoring(reports);
          return reports;
        }
      } catch (error) {
        console.log('Mesonet fetch failed, using mock data...');
      }
      
      // 3. Fall back to mock data for development
      console.log('Using mock data for development');
      reports = await this.getMockHailData();
      // Apply confidence scoring to mock data too
      reports = await this.applyConfidenceScoring(reports);
      return reports;
    } catch (error) {
      console.error('Error fetching MRMS data:', error);
      throw error;
    }
  }
  
  /**
   * Get mock hail data for development
   */
  private static async getMockHailData(): Promise<HailReport[]> {
    // Simulate real hail reports across Oklahoma
    const reports: HailReport[] = [];
    const now = new Date();
    
    // Always generate at least 3-5 reports for testing
    const numReports = Math.floor(Math.random() * 3) + 3; // 3-5 reports
    
    // Add reports in Metro OKC area
    for (let i = 0; i < Math.min(2, numReports); i++) {
      const lat = 35.4676 + (Math.random() - 0.5) * 0.3;
      const lng = -97.5164 + (Math.random() - 0.5) * 0.3;
      console.log(`Mock report ${i} OKC: lat=${lat}, lng=${lng}`);
      
      reports.push({
        id: `hail_${Date.now()}_${i}`,
        latitude: lat,
        longitude: lng,
        size: Math.random() * 2 + 0.75, // 0.75 to 2.75 inches
        timestamp: now,
        confidence: 70 + Math.random() * 30,
        city: 'Oklahoma City',
        isMetroOKC: true
      });
    }
    
    // Add reports in Norman area
    for (let i = 2; i < numReports; i++) {
      const lat = 35.2226 + (Math.random() - 0.5) * 0.2;
      const lng = -97.4395 + (Math.random() - 0.5) * 0.2;
      console.log(`Mock report ${i} Norman: lat=${lat}, lng=${lng}`);
      
      reports.push({
        id: `hail_${Date.now()}_${i}`,
        latitude: lat,
        longitude: lng,
        size: Math.random() * 1.5 + 0.75,
        timestamp: now,
        confidence: 60 + Math.random() * 40,
        city: 'Norman',
        isMetroOKC: true
      });
    }
    
    console.log(`Generated ${reports.length} mock hail reports`);
    return reports;
  }
  
  /**
   * Group hail reports into storm events
   */
  static async groupIntoStormEvents(reports: HailReport[]): Promise<StormEvent> {
    const now = new Date();
    const stormId = `storm_${now.toISOString().split('T')[0]}_${now.getHours()}`;
    
    // Calculate storm bounds
    const lats = reports.map(r => r.latitude);
    const lngs = reports.map(r => r.longitude);
    
    console.log('Storm bounds calculation:');
    console.log('Latitudes:', lats);
    console.log('Longitudes:', lngs);
    
    const bounds = {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs)
    };
    
    console.log('Calculated bounds:', bounds);
    
    const storm: StormEvent = {
      id: stormId,
      name: `${now.toLocaleDateString()} Oklahoma Storm`,
      startTime: new Date(Math.min(...reports.map(r => r.timestamp.getTime()))),
      peakSize: Math.max(...reports.map(r => r.size)),
      reports: reports,
      bounds: bounds,
      enabled: true
    };
    
    return storm;
  }
  
  /**
   * Save storm event to storage
   */
  static async saveStormEvent(storm: StormEvent): Promise<void> {
    try {
      const storms = await this.getActiveStorms();
      
      // Check if storm already exists
      const existingIndex = storms.findIndex(s => s.id === storm.id);
      if (existingIndex >= 0) {
        storms[existingIndex] = storm;
      } else {
        // Add new storm and manage 3-storm limit
        storms.push(storm);
        
        // If more than 3 storms, remove oldest
        if (storms.length > 3) {
          storms.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
          storms.pop(); // Remove oldest
        }
      }
      
      await AsyncStorage.setItem(this.ACTIVE_STORMS_KEY, JSON.stringify(storms));
    } catch (error) {
      console.error('Error saving storm event:', error);
      throw error;
    }
  }
  
  /**
   * Get active storm events
   */
  static async getActiveStorms(): Promise<StormEvent[]> {
    try {
      const data = await AsyncStorage.getItem(this.ACTIVE_STORMS_KEY);
      if (!data) return [];
      
      const storms = JSON.parse(data);
      // Convert date strings back to Date objects
      return storms.map((storm: any) => ({
        ...storm,
        startTime: new Date(storm.startTime),
        endTime: storm.endTime ? new Date(storm.endTime) : undefined,
        reports: storm.reports.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp)
        }))
      }));
    } catch (error) {
      console.error('Error getting active storms:', error);
      return [];
    }
  }
  
  /**
   * Toggle storm visibility
   */
  static async toggleStorm(stormId: string, enabled: boolean): Promise<void> {
    const storms = await this.getActiveStorms();
    const storm = storms.find(s => s.id === stormId);
    if (storm) {
      storm.enabled = enabled;
      await AsyncStorage.setItem(this.ACTIVE_STORMS_KEY, JSON.stringify(storms));
    }
  }
  
  /**
   * Disable all storms except the specified one
   */
  static async focusOnStorm(stormId: string): Promise<void> {
    const storms = await this.getActiveStorms();
    storms.forEach(storm => {
      storm.enabled = storm.id === stormId;
    });
    await AsyncStorage.setItem(this.ACTIVE_STORMS_KEY, JSON.stringify(storms));
  }
  
  /**
   * Delete a storm event
   */
  static async deleteStorm(stormId: string): Promise<void> {
    const storms = await this.getActiveStorms();
    const filtered = storms.filter(s => s.id !== stormId);
    await AsyncStorage.setItem(this.ACTIVE_STORMS_KEY, JSON.stringify(filtered));
  }
  
  /**
   * Check if location is in Metro OKC
   */
  static isInMetroOKC(lat: number, lng: number): boolean {
    // Simplified check - in production would use proper geocoding
    const OKC_CENTER = { lat: 35.4676, lng: -97.5164 };
    const distance = Math.sqrt(
      Math.pow(lat - OKC_CENTER.lat, 2) + 
      Math.pow(lng - OKC_CENTER.lng, 2)
    );
    return distance < 0.5; // Roughly 50 mile radius
  }
  
  /**
   * Apply confidence scoring to hail reports
   */
  private static async applyConfidenceScoring(reports: HailReport[]): Promise<HailReport[]> {
    // Calculate confidence for each report
    return reports.map(report => {
      // Find nearby reports for density scoring
      const nearbyReports = reports.filter(r => {
        if (r.id === report.id) return false;
        const distance = Math.sqrt(
          Math.pow(report.latitude - r.latitude, 2) + 
          Math.pow(report.longitude - r.longitude, 2)
        );
        return distance < 0.1; // ~10 miles
      });
      
      // Calculate confidence factors
      const confidenceFactors = ConfidenceScoring.calculateConfidence(
        report,
        nearbyReports,
        [] // Social media data would go here in production
      );
      
      return {
        ...report,
        confidence: confidenceFactors.totalScore,
        confidenceFactors
      };
    });
  }
  
  /**
   * Log alert for history
   */
  static async logAlert(alert: {
    timestamp: Date;
    message: string;
    hailSize: number;
    location: string;
    dismissed: boolean;
  }): Promise<void> {
    try {
      const logs = await this.getAlertLog();
      logs.push(alert);
      
      // Keep only last 100 alerts
      if (logs.length > 100) {
        logs.splice(0, logs.length - 100);
      }
      
      await AsyncStorage.setItem(this.ALERT_LOG_KEY, JSON.stringify(logs));
    } catch (error) {
      console.error('Error logging alert:', error);
    }
  }
  
  /**
   * Get alert history
   */
  static async getAlertLog(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem(this.ALERT_LOG_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting alert log:', error);
      return [];
    }
  }
}
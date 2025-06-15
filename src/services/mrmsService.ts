/**
 * MRMS (Multi-Radar Multi-Sensor) Service
 * Fetches real-time hail data from NOAA
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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
      // MRMS provides data in GRIB2 format
      // For MVP, we'll use a simplified approach
      // In production, we'd parse GRIB2 or use a proxy service
      
      // Simulated data for development
      // TODO: Implement actual GRIB2 parsing or proxy service
      const mockData = await this.getMockHailData();
      
      return mockData;
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
    
    // Add some reports in Metro OKC
    if (Math.random() > 0.5) {
      reports.push({
        id: `hail_${Date.now()}_1`,
        latitude: 35.4676 + (Math.random() - 0.5) * 0.2,
        longitude: -97.5164 + (Math.random() - 0.5) * 0.2,
        size: Math.random() * 2 + 0.5, // 0.5 to 2.5 inches
        timestamp: now,
        confidence: 70 + Math.random() * 30,
        city: 'Oklahoma City',
        isMetroOKC: true
      });
    }
    
    // Add some reports in Norman
    if (Math.random() > 0.7) {
      reports.push({
        id: `hail_${Date.now()}_2`,
        latitude: 35.2226 + (Math.random() - 0.5) * 0.1,
        longitude: -97.4395 + (Math.random() - 0.5) * 0.1,
        size: Math.random() * 1.5 + 0.75,
        timestamp: now,
        confidence: 60 + Math.random() * 40,
        city: 'Norman',
        isMetroOKC: true
      });
    }
    
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
    
    const storm: StormEvent = {
      id: stormId,
      name: `${now.toLocaleDateString()} Oklahoma Storm`,
      startTime: new Date(Math.min(...reports.map(r => r.timestamp.getTime()))),
      peakSize: Math.max(...reports.map(r => r.size)),
      reports: reports,
      bounds: {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs)
      },
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
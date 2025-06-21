/**
 * TIER 1: NCEP MRMS Real-Time Service
 * Catches storms as they happen for immediate canvassing deployment
 * Data Flow: New Storm → NCEP MRMS Real-Time → Immediate Alerts → Team Deployment
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';
import { MRMSProxyService } from './mrmsProxyService';

export interface NCEPMRMSData {
  meshValue: number;  // in mm
  latitude: number;
  longitude: number;
  timestamp: Date;
  confidence: number;
}

export class NCEPMRMSService {
  // NCEP MRMS endpoints
  private static readonly ENDPOINTS = {
    mesh30min: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_30min/',
    mesh60min: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_60min/',
    mesh1440min: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_1440min/',
    latest: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_30min/latest.json'
  };

  private static readonly UPDATE_INTERVAL = 2 * 60 * 1000; // 2 minutes
  private static monitoringInterval: NodeJS.Timeout | null = null;

  /**
   * Start real-time monitoring (every 2 minutes during active weather)
   */
  static async startRealTimeMonitoring(): Promise<void> {
    console.log('[TIER 1] Starting NCEP MRMS real-time monitoring...');
    
    try {
      // Connect to our real-time server (use actual host IP for physical device)
      const serverUrl = __DEV__ 
        ? 'http://localhost:3003/api/monitoring/start'
        : 'https://your-production-server.com/api/monitoring/start';
        
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('[TIER 1] Real-time monitoring started:', data.message);
        
        // Start local monitoring interval
        this.monitoringInterval = setInterval(async () => {
          await this.checkForNewStorms();
        }, this.UPDATE_INTERVAL);
        
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (error) {
      console.error('[TIER 1] Failed to start monitoring:', error);
      // Fall back to local polling
      this.monitoringInterval = setInterval(async () => {
        await this.checkForNewStorms();
      }, this.UPDATE_INTERVAL);
    }
  }

  /**
   * Stop real-time monitoring
   */
  static stopRealTimeMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[TIER 1] Stopped NCEP MRMS monitoring');
    }
  }

  /**
   * Check for new storms from NCEP MRMS
   */
  static async checkForNewStorms(): Promise<HailReport[]> {
    try {
      console.log('[TIER 1] Checking NCEP MRMS for new storms...');
      
      // Connect to our real-time server
      const serverUrl = __DEV__ 
        ? 'http://localhost:3003/api/storms/current'
        : 'https://your-production-server.com/api/storms/current';
        
      const response = await fetch(serverUrl);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[TIER 1] Real-time server returned ${data.storms.length} storms`);
        
        // Convert to HailReport format
        const reports: HailReport[] = data.storms.map((storm: any) => ({
          id: storm.id,
          latitude: storm.latitude,
          longitude: storm.longitude,
          size: storm.size,
          timestamp: new Date(storm.timestamp),
          confidence: storm.confidence,
          source: storm.source,
          meshValue: storm.meshValue
        }));
        
        // Check for alert-level storms
        const alertStorms = reports.filter(r => r.size >= 1.25);
        if (alertStorms.length > 0) {
          console.log(`[TIER 1] 🚨 Found ${alertStorms.length} alert-level storms!`);
          await this.triggerAlerts(alertStorms);
        }
        
        return reports;
      } else {
        throw new Error(`Real-time server error: ${response.status}`);
      }
      
    } catch (error) {
      console.error('[TIER 1] Error checking real-time server:', error);
      
      // Fallback to proxy if real-time server is down
      try {
        console.log('[TIER 1] Falling back to proxy server...');
        const data = await MRMSProxyService.fetchRealtimeMRMS();
        return this.processMESHData(data);
      } catch (fallbackError) {
        console.error('[TIER 1] Fallback also failed:', fallbackError);
        return [];
      }
    }
  }

  /**
   * Attempt direct NCEP MRMS fetch (requires proxy in production)
   */
  private static async fetchDirectNCEP(): Promise<any[]> {
    try {
      // In a real implementation, you'd need to:
      // 1. Fetch GRIB2 file from NCEP
      // 2. Parse GRIB2 format
      // 3. Extract MESH values
      // This requires server-side processing due to CORS and binary format
      
      // For now, return empty to trigger proxy fallback
      return [];
    } catch (error) {
      console.error('[TIER 1] Direct NCEP fetch failed:', error);
      return [];
    }
  }

  /**
   * Process MESH data into hail reports
   */
  private static processMESHData(rawData: any[]): HailReport[] {
    const reports: HailReport[] = [];
    const processedLocations = new Set<string>();

    rawData.forEach((item, index) => {
      const lat = item.lat || item.latitude;
      const lon = item.lon || item.longitude;
      const meshMM = item.mesh_mm || item.meshValue || 25;
      
      // Create location key to avoid duplicates
      const locationKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      
      if (!processedLocations.has(locationKey) && meshMM > 0) {
        processedLocations.add(locationKey);
        
        // Calculate confidence score
        // Real-time data gets base score of 60-70%
        let confidence = 60;
        
        // Add confidence based on MESH value
        if (meshMM >= 50) confidence += 10;  // 2+ inch hail
        else if (meshMM >= 25) confidence += 5;  // 1+ inch hail
        
        reports.push({
          id: `ncep_${Date.now()}_${index}`,
          latitude: lat,
          longitude: lon,
          size: meshMM / 25.4,  // Convert mm to inches
          timestamp: new Date(),
          confidence: confidence,
          source: 'NCEP MRMS Real-Time',
          meshValue: meshMM
        });
      }
    });

    return reports;
  }

  /**
   * Trigger alerts for significant hail
   */
  private static async triggerAlerts(reports: HailReport[]): Promise<void> {
    // Store latest alerts
    await AsyncStorage.setItem(
      '@tier1_latest_alerts',
      JSON.stringify({
        timestamp: new Date(),
        reports: reports
      })
    );

    // In production, trigger push notifications here
    console.log('[TIER 1] Alert triggered for areas:', 
      reports.map(r => `${r.latitude.toFixed(2)}, ${r.longitude.toFixed(2)}`).join('; ')
    );
  }

  /**
   * Get storm timeline (progression and intensity changes)
   */
  static async getStormTimeline(stormId: string): Promise<any[]> {
    try {
      const timelineKey = `@storm_timeline_${stormId}`;
      const stored = await AsyncStorage.getItem(timelineKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('[TIER 1] Error getting storm timeline:', error);
      return [];
    }
  }

  /**
   * Quick deploy mode - one-tap area selection
   */
  static async enableQuickDeploy(bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  }): Promise<void> {
    await AsyncStorage.setItem('@quick_deploy_bounds', JSON.stringify(bounds));
    console.log('[TIER 1] Quick deploy mode enabled for area:', bounds);
  }
}
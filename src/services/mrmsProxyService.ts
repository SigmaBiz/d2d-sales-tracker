/**
 * MRMS Proxy Service - Uses FREE Vercel proxy
 * No CORS issues, no GRIB2 complexity, completely free!
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HailReport } from './mrmsService';

// Your FREE Vercel proxy URL
const PROXY_URL = process.env.EXPO_PUBLIC_MRMS_PROXY_URL || 'https://mrms-proxy-1749991977.vercel.app';

export class MRMSProxyService {
  private static CACHE_KEY = '@mrms_proxy_cache';
  private static CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetch real-time MRMS data through free proxy
   */
  static async fetchRealtimeMRMS(): Promise<HailReport[]> {
    try {
      const response = await fetch(`${PROXY_URL}/api/mrms?type=realtime`);
      const data = await response.json();
      
      return this.convertToHailReports(data.reports);
    } catch (error) {
      console.error('MRMS proxy error:', error);
      return [];
    }
  }

  /**
   * Fetch historical MRMS data (including Sept 24, 2024!)
   */
  static async fetchHistoricalMRMS(date: Date): Promise<HailReport[]> {
    const dateStr = date.toISOString().split('T')[0];
    
    // Check cache first
    const cacheKey = `historical_${dateStr}`;
    const cached = await this.getCached(cacheKey);
    if (cached) {
      console.log('[MRMSProxy] Returning cached data for', dateStr);
      return cached;
    }

    try {
      const url = `${PROXY_URL}/api/mrms?type=historical&date=${dateStr}`;
      console.log('[MRMSProxy] Fetching from:', url);
      
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('[MRMSProxy] Response:', data);
      
      if (!data.reports || !Array.isArray(data.reports)) {
        console.log('[MRMSProxy] No reports in response');
        return [];
      }
      
      const reports = this.convertToHailReports(data.reports);
      console.log('[MRMSProxy] Converted', reports.length, 'reports');
      
      // Cache the results
      await this.setCached(cacheKey, reports);
      
      return reports;
    } catch (error) {
      console.error('[MRMSProxy] Historical MRMS error:', error);
      return [];
    }
  }

  /**
   * Fetch storm validation data
   */
  static async fetchStormValidation(date: Date): Promise<any[]> {
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      const response = await fetch(
        `${PROXY_URL}/api/mrms?type=validation&date=${dateStr}`
      );
      const data = await response.json();
      
      return data.reports;
    } catch (error) {
      console.error('Storm validation error:', error);
      return [];
    }
  }

  /**
   * Convert proxy data to HailReport format
   */
  private static convertToHailReports(proxyReports: any[]): HailReport[] {
    return proxyReports.map((report, index) => ({
      id: `mrms_${Date.now()}_${index}`,
      latitude: report.lat || report.latitude,
      longitude: report.lon || report.longitude,
      size: report.mesh_inches || ((report.mesh_mm || 25) / 25.4), // Use mesh_inches if available, otherwise convert mm to inches
      timestamp: new Date(report.timestamp || Date.now()),
      confidence: report.confidence || 85,
      city: report.city || 'Unknown',
      isMetroOKC: this.isMetroOKC(report.lat || report.latitude, report.lon || report.longitude),
      source: 'IEM Archive', // Historical data from IEM via proxy
      meshValue: report.mesh_mm || (report.mesh_inches ? report.mesh_inches * 25.4 : 25)
    }));
  }

  /**
   * Check if coordinates are in Metro OKC
   */
  private static isMetroOKC(lat: number, lon: number): boolean {
    const OKC_CENTER = { lat: 35.4676, lon: -97.5164 };
    const distance = Math.sqrt(
      Math.pow(lat - OKC_CENTER.lat, 2) + 
      Math.pow(lon - OKC_CENTER.lon, 2)
    );
    return distance < 0.5;
  }

  /**
   * Get cached data
   */
  private static async getCached(key: string): Promise<HailReport[] | null> {
    try {
      const cached = await AsyncStorage.getItem(`${this.CACHE_KEY}_${key}`);
      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < this.CACHE_DURATION) {
        return data.map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp)
        }));
      }
    } catch (error) {
      console.error('Cache error:', error);
    }
    return null;
  }

  /**
   * Set cached data
   */
  private static async setCached(key: string, data: HailReport[]): Promise<void> {
    try {
      await AsyncStorage.setItem(
        `${this.CACHE_KEY}_${key}`,
        JSON.stringify({
          data,
          timestamp: Date.now()
        })
      );
    } catch (error) {
      console.error('Cache error:', error);
    }
  }
}
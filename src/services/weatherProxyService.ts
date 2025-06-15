/**
 * Weather Proxy Service
 * Handles communication with proxy server for CORS-free weather data access
 * This will be used in Phase 2 of the implementation
 */

import { HailReport } from './mrmsService';
import { getWeatherConfig } from '../config/weatherConfig';

export interface ProxyResponse {
  success: boolean;
  data?: any;
  error?: string;
  source: 'noaa' | 'weatherapi' | 'cache';
  timestamp: number;
}

export class WeatherProxyService {
  private static config = getWeatherConfig();
  
  /**
   * Fetch weather data through proxy
   */
  static async fetchWeatherData(): Promise<HailReport[]> {
    if (!this.config.proxyUrl) {
      throw new Error('Proxy URL not configured');
    }
    
    try {
      const response = await fetch(`${this.config.proxyUrl}/hail/current`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': '1.0.0'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Proxy returned ${response.status}`);
      }
      
      const data: ProxyResponse = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Unknown proxy error');
      }
      
      return this.parseProxyData(data);
    } catch (error) {
      console.error('Proxy fetch error:', error);
      throw error;
    }
  }
  
  /**
   * Parse proxy response into HailReport format
   */
  private static parseProxyData(response: ProxyResponse): HailReport[] {
    const reports: HailReport[] = [];
    
    if (!response.data || !response.data.reports) {
      return reports;
    }
    
    response.data.reports.forEach((item: any) => {
      reports.push({
        id: item.id || `proxy_${Date.now()}_${Math.random()}`,
        latitude: item.latitude,
        longitude: item.longitude,
        size: item.size,
        timestamp: new Date(item.timestamp),
        confidence: item.confidence || 75,
        city: item.city,
        isMetroOKC: item.isMetroOKC
      });
    });
    
    return reports;
  }
  
  /**
   * Fetch historical data through proxy
   */
  static async fetchHistoricalData(date: Date): Promise<HailReport[]> {
    if (!this.config.proxyUrl) {
      throw new Error('Proxy URL not configured');
    }
    
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      const response = await fetch(`${this.config.proxyUrl}/hail/historical/${dateStr}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': '1.0.0'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Proxy returned ${response.status}`);
      }
      
      const data: ProxyResponse = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Unknown proxy error');
      }
      
      return this.parseProxyData(data);
    } catch (error) {
      console.error('Proxy historical fetch error:', error);
      throw error;
    }
  }
  
  /**
   * Check proxy health
   */
  static async checkHealth(): Promise<boolean> {
    if (!this.config.proxyUrl) {
      return false;
    }
    
    try {
      const response = await fetch(`${this.config.proxyUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });
      
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
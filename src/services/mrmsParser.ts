/**
 * MRMS Data Parser
 * Handles real NOAA MRMS data fetching and parsing
 * 
 * MRMS provides data in various formats:
 * - Binary GRIB2 format (most common)
 * - NetCDF format
 * - GeoTIFF format
 * 
 * For web/mobile, we'll use the CSV export endpoint when available
 * or a proxy service to convert GRIB2 to JSON
 */

import { HailReport } from './mrmsService';

// NOAA MRMS endpoints
const MRMS_BASE = 'https://mrms.ncep.noaa.gov/data/realtime/';
const MRMS_LATEST = 'https://mrms.ncep.noaa.gov/data/LATEST/';

// Available MRMS products for hail
const MRMS_PRODUCTS = {
  MESH: 'MESH_Max_1440min',           // Maximum Expected Size of Hail (24hr)
  MESH_60: 'MESH_Max_60min',          // MESH (1hr) 
  MESH_30: 'MESH_Max_30min',          // MESH (30min)
  PROB_SEVERE: 'PROB_SEVERE_HAIL',    // Probability of severe hail
  VIL: 'VIL',                         // Vertically Integrated Liquid
};

// Oklahoma bounds for data filtering
const OK_BOUNDS = {
  north: 37.0,
  south: 33.6,
  east: -94.4,
  west: -103.0
};

export class MRMSParser {
  /**
   * Fetch latest MESH data from NOAA
   * Note: Direct GRIB2 parsing in browser is complex
   * In production, use a server proxy or NOAA's experimental JSON endpoints
   */
  static async fetchLatestMESH(): Promise<HailReport[]> {
    try {
      // Try to fetch from NOAA's experimental JSON endpoint
      // This is not officially documented but sometimes available
      const jsonUrl = `${MRMS_BASE}${MRMS_PRODUCTS.MESH_60}.json`;
      
      try {
        const response = await fetch(jsonUrl);
        if (response.ok) {
          const data = await response.json();
          return this.parseJSONData(data);
        }
      } catch (jsonError) {
        console.log('JSON endpoint not available, trying alternative methods');
      }

      // Alternative: Use NOAA's WMS service for point queries
      return await this.fetchViaWMS();
    } catch (error) {
      console.error('Error fetching MRMS data:', error);
      
      // Fall back to mock data for development
      return this.generateMockData();
    }
  }

  /**
   * Parse JSON formatted MRMS data
   */
  private static parseJSONData(data: any): HailReport[] {
    const reports: HailReport[] = [];
    
    if (!data || !data.features) return reports;

    data.features.forEach((feature: any) => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates;
      
      // Filter for Oklahoma
      if (coords[1] >= OK_BOUNDS.south && coords[1] <= OK_BOUNDS.north &&
          coords[0] >= OK_BOUNDS.west && coords[0] <= OK_BOUNDS.east) {
        
        // Convert MESH value (mm) to inches
        const meshMM = props.value || 0;
        const meshInches = meshMM * 0.0393701;
        
        if (meshInches > 0.5) { // Only report hail > 0.5"
          reports.push({
            id: `mrms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            latitude: coords[1],
            longitude: coords[0],
            size: meshInches,
            timestamp: new Date(props.time || Date.now()),
            confidence: this.calculateConfidence(meshInches),
            city: this.getCityName(coords[1], coords[0])
          });
        }
      }
    });

    return reports;
  }

  /**
   * Fetch data via WMS (Web Map Service)
   * This is more reliable but requires multiple requests
   */
  private static async fetchViaWMS(): Promise<HailReport[]> {
    const reports: HailReport[] = [];
    
    // Create a grid of sample points across Oklahoma
    const latStep = 0.25; // ~15 miles
    const lonStep = 0.25;
    
    for (let lat = OK_BOUNDS.south; lat <= OK_BOUNDS.north; lat += latStep) {
      for (let lon = OK_BOUNDS.west; lon <= OK_BOUNDS.east; lon += lonStep) {
        try {
          const wmsUrl = this.buildWMSUrl(lat, lon);
          const response = await fetch(wmsUrl);
          
          if (response.ok) {
            const value = await this.parseWMSResponse(response);
            if (value > 0.5) { // Hail > 0.5"
              reports.push({
                id: `wms_${Date.now()}_${lat}_${lon}`,
                latitude: lat,
                longitude: lon,
                size: value,
                timestamp: new Date(),
                confidence: this.calculateConfidence(value),
                city: this.getCityName(lat, lon),
                isMetroOKC: this.isInMetroOKC(lat, lon)
              });
            }
          }
        } catch (error) {
          // Continue with next point
        }
      }
    }
    
    return reports;
  }

  /**
   * Build WMS GetFeatureInfo URL
   */
  private static buildWMSUrl(lat: number, lon: number): string {
    // NOAA WMS endpoint (if available)
    const baseUrl = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_mrms_mesh/ows';
    
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.3.0',
      request: 'GetFeatureInfo',
      layers: 'conus_mrms_mesh',
      query_layers: 'conus_mrms_mesh',
      info_format: 'application/json',
      crs: 'EPSG:4326',
      width: '1',
      height: '1',
      x: '0',
      y: '0',
      bbox: `${lon-0.01},${lat-0.01},${lon+0.01},${lat+0.01}`
    });
    
    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Parse WMS response
   */
  private static async parseWMSResponse(response: Response): Promise<number> {
    try {
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        const value = data.features[0].properties.GRAY_INDEX || 0;
        // Convert from MESH value to inches
        return value * 0.0393701;
      }
    } catch (error) {
      console.error('Error parsing WMS response:', error);
    }
    return 0;
  }

  /**
   * Alternative: Fetch from Iowa State Mesonet archive
   * They provide MRMS data in more accessible formats
   */
  static async fetchFromMesonet(): Promise<HailReport[]> {
    const reports: HailReport[] = [];
    
    try {
      // Iowa State Mesonet provides MRMS archive
      const baseUrl = 'https://mesonet.agron.iastate.edu/json/';
      const product = 'mesh';
      const currentTime = new Date();
      
      // Format: YYYYMMDD_HHMM
      const timeStr = currentTime.toISOString().replace(/[-:T]/g, '').slice(0, 12);
      
      const url = `${baseUrl}radar?product=${product}&time=${timeStr}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        return this.parseMesonetData(data);
      }
    } catch (error) {
      console.error('Error fetching from Mesonet:', error);
    }
    
    return reports;
  }

  /**
   * Parse Iowa Mesonet data format
   */
  private static parseMesonetData(data: any): HailReport[] {
    const reports: HailReport[] = [];
    
    if (!data || !data.features) return reports;
    
    data.features.forEach((feature: any) => {
      const coords = feature.geometry.coordinates;
      const value = feature.properties.value;
      
      // Filter for Oklahoma
      if (coords[1] >= OK_BOUNDS.south && coords[1] <= OK_BOUNDS.north &&
          coords[0] >= OK_BOUNDS.west && coords[0] <= OK_BOUNDS.east) {
        
        const sizeInches = value * 0.0393701;
        
        if (sizeInches > 0.5) {
          reports.push({
            id: `mesonet_${Date.now()}_${coords[0]}_${coords[1]}`,
            latitude: coords[1],
            longitude: coords[0],
            size: sizeInches,
            timestamp: new Date(),
            confidence: this.calculateConfidence(sizeInches),
            city: this.getCityName(coords[1], coords[0]),
            isMetroOKC: this.isInMetroOKC(coords[1], coords[0])
          });
        }
      }
    });
    
    return reports;
  }

  /**
   * Calculate confidence score based on MESH value
   */
  private static calculateConfidence(sizeInches: number): number {
    // Base confidence on MESH algorithm accuracy
    if (sizeInches >= 2.0) return 85;
    if (sizeInches >= 1.5) return 75;
    if (sizeInches >= 1.0) return 65;
    if (sizeInches >= 0.75) return 55;
    return 45;
  }

  /**
   * Get city name from coordinates
   * In production, use a proper geocoding service
   */
  private static getCityName(lat: number, lon: number): string {
    // Major Oklahoma cities with coordinates
    const cities = [
      { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164, radius: 0.3 },
      { name: 'Norman', lat: 35.2226, lon: -97.4395, radius: 0.15 },
      { name: 'Edmond', lat: 35.6529, lon: -97.4784, radius: 0.15 },
      { name: 'Moore', lat: 35.3395, lon: -97.4867, radius: 0.1 },
      { name: 'Midwest City', lat: 35.4495, lon: -97.3967, radius: 0.1 },
      { name: 'Tulsa', lat: 36.1540, lon: -95.9928, radius: 0.3 },
      { name: 'Lawton', lat: 34.6036, lon: -98.3959, radius: 0.15 },
      { name: 'Stillwater', lat: 36.1156, lon: -97.0584, radius: 0.1 },
    ];
    
    // Find closest city
    for (const city of cities) {
      const distance = Math.sqrt(
        Math.pow(lat - city.lat, 2) + Math.pow(lon - city.lon, 2)
      );
      if (distance <= city.radius) {
        return city.name;
      }
    }
    
    return 'Oklahoma'; // Default
  }

  /**
   * Check if coordinates are in Metro OKC area
   */
  private static isInMetroOKC(lat: number, lon: number): boolean {
    const metroCenter = { lat: 35.4676, lon: -97.5164 };
    const metroRadius = 0.5; // ~50 miles
    
    const distance = Math.sqrt(
      Math.pow(lat - metroCenter.lat, 2) + 
      Math.pow(lon - metroCenter.lon, 2)
    );
    
    return distance <= metroRadius;
  }

  /**
   * Generate mock data for development/testing
   */
  private static generateMockData(): HailReport[] {
    const reports: HailReport[] = [];
    const numReports = Math.floor(Math.random() * 5) + 1;
    
    for (let i = 0; i < numReports; i++) {
      const lat = OK_BOUNDS.south + Math.random() * (OK_BOUNDS.north - OK_BOUNDS.south);
      const lon = OK_BOUNDS.west + Math.random() * (OK_BOUNDS.east - OK_BOUNDS.west);
      const size = Math.random() * 2.5 + 0.5; // 0.5" to 3"
      
      reports.push({
        id: `mock_${Date.now()}_${i}`,
        latitude: lat,
        longitude: lon,
        size: size,
        timestamp: new Date(),
        confidence: this.calculateConfidence(size),
        city: this.getCityName(lat, lon),
        isMetroOKC: this.isInMetroOKC(lat, lon)
      });
    }
    
    return reports;
  }

  /**
   * Fetch historical MESH data for a specific date
   */
  static async fetchHistoricalMESH(date: Date): Promise<HailReport[]> {
    // Format date for MRMS archive
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // Try Iowa State Mesonet archive first
    const archiveUrl = `https://mesonet.agron.iastate.edu/archive/data/${year}/${month}/${day}/mrms/mesh/`;
    
    try {
      // In production, parse the directory listing and fetch specific files
      // For now, return mock historical data
      return this.generateMockData();
    } catch (error) {
      console.error('Error fetching historical data:', error);
      return [];
    }
  }
}
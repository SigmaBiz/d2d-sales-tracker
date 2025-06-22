/**
 * IEM Archive Service - Real MRMS Historical Data
 * Implements Tier 2 of our data flow architecture
 * 
 * Data Flow: Iowa Environmental Mesonet Archive → Historical MESH → Map Overlays
 * Coverage: October 2019 - Present
 */

import { HailReport } from './mrmsService';

export class IEMArchiveService {
  // IEM Archive base URL
  private static readonly BASE_URL = 'https://mrms.agron.iastate.edu';
  
  // Date range: October 2019 - Present
  private static readonly MIN_DATE = new Date('2019-10-01');
  
  /**
   * Fetch historical MESH data from IEM Archive
   * @param date - Date to fetch (format: YYYY-MM-DD)
   * @returns Array of hail reports with MESH values
   */
  static async fetchHistoricalMESH(date: Date): Promise<HailReport[]> {
    try {
      // Validate date range
      if (date < this.MIN_DATE || date > new Date()) {
        console.log('[IEM Archive] Date out of range:', date.toISOString());
        return [];
      }

      // Format date for proxy server
      console.log('[IEM Archive] Input date:', date.toISOString(), 'Local:', date.toString());
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      // Use production server for consistent data access
      const PROXY_URL = 'https://d2d-dynamic-server.onrender.com';
      const url = `${PROXY_URL}/api/mesh/${dateStr}`;
      
      console.log('[IEM Archive] Formatted date string:', dateStr);
      console.log('[IEM Archive] Using production server:', PROXY_URL);
      console.log('[IEM Archive] Fetching from proxy:', url);
      
      try {
        const response = await fetch(url);
        
        // Check if response is OK
        if (!response.ok) {
          console.log('[IEM Archive] Proxy error:', response.status, response.statusText);
          throw new Error(`Proxy returned ${response.status}`);
        }
        
        // Try to parse JSON
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          console.log('[IEM Archive] Invalid JSON from proxy:', text.substring(0, 100));
          throw new Error('Invalid JSON response from proxy');
        }
        
        if (data.reports && Array.isArray(data.reports)) {
          console.log('[IEM Archive] Got', data.reports.length, 'MESH reports from proxy');
          console.log('[IEM Archive] First report:', data.reports[0]);
          console.log('[IEM Archive] Last report:', data.reports[data.reports.length - 1]);
          return data.reports.map((report: any) => ({
            ...report,
            timestamp: new Date(report.timestamp)
          }));
        }
        
        console.log('[IEM Archive] No reports in proxy response');
        return [];
        
      } catch (fetchError) {
        console.log('[IEM Archive] Proxy error details:', fetchError);
        console.log('[IEM Archive] Proxy not available for date:', dateStr);
        // Return empty array instead of mock data
        return [];
      }
    } catch (error) {
      console.error('[IEM Archive] Error fetching historical MESH:', error);
      return [];
    }
  }
  
  /**
   * Process GRIB2 file to extract MESH values
   * This would be implemented server-side due to binary format
   */
  private static processGRIB2(data: ArrayBuffer): HailReport[] {
    // GRIB2 is a binary meteorological format
    // Requires specialized libraries to decode
    // Would be processed server-side
    console.log('[IEM Archive] GRIB2 processing requires server-side implementation');
    return [];
  }
  
  /**
   * Mock data for development/testing
   * Shows what real MESH data would look like
   */
  private static getMockHistoricalData(date: Date): HailReport[] {
    // Known storm dates with mock MESH data
    const dateStr = date.toISOString().split('T')[0];
    
    const knownStorms: { [key: string]: HailReport[] } = {
      '2024-09-24': [
        {
          id: 'iem_2024092420_001',
          latitude: 35.4676,
          longitude: -97.5164,
          size: 2.25, // inches (MESH algorithm output)
          timestamp: new Date('2024-09-24T20:30:00Z'),
          confidence: 92, // High confidence from MESH algorithm
          city: 'Oklahoma City',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 57.15 // mm
        },
        {
          id: 'iem_2024092420_002',
          latitude: 35.3395,
          longitude: -97.4867,
          size: 1.75,
          timestamp: new Date('2024-09-24T20:45:00Z'),
          confidence: 88,
          city: 'Moore',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 44.45
        },
        {
          id: 'iem_2024092420_003',
          latitude: 35.2226,
          longitude: -97.4395,
          size: 1.5,
          timestamp: new Date('2024-09-24T21:00:00Z'),
          confidence: 85,
          city: 'Norman',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 38.1
        }
      ],
      '2024-11-03': [
        {
          id: 'iem_2024110318_001',
          latitude: 35.4676,
          longitude: -97.5164,
          size: 1.75,
          timestamp: new Date('2024-11-03T18:30:00Z'),
          confidence: 88,
          city: 'Oklahoma City',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 44.45
        },
        {
          id: 'iem_2024110318_002',
          latitude: 35.6528,
          longitude: -97.4781,
          size: 2.0,
          timestamp: new Date('2024-11-03T18:45:00Z'),
          confidence: 90,
          city: 'Edmond',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 50.8
        },
        {
          id: 'iem_2024110319_003',
          latitude: 35.5514,
          longitude: -97.4079,
          size: 1.5,
          timestamp: new Date('2024-11-03T19:00:00Z'),
          confidence: 85,
          city: 'Edmond',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 38.1
        },
        {
          id: 'iem_2024110319_004',
          latitude: 35.4934,
          longitude: -97.2891,
          size: 1.25,
          timestamp: new Date('2024-11-03T19:15:00Z'),
          confidence: 82,
          city: 'Midwest City',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 31.75
        }
      ],
      '2025-05-17': [
        {
          id: 'iem_2025051720_001',
          latitude: 35.3395,
          longitude: -97.4867,
          size: 3.0,
          timestamp: new Date('2025-05-17T20:00:00Z'),
          confidence: 95,
          city: 'Moore',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 76.2
        },
        {
          id: 'iem_2025051720_002',
          latitude: 35.2226,
          longitude: -97.4395,
          size: 2.5,
          timestamp: new Date('2025-05-17T20:15:00Z'),
          confidence: 93,
          city: 'Norman',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 63.5
        },
        {
          id: 'iem_2025051720_003',
          latitude: 35.4676,
          longitude: -97.5164,
          size: 2.25,
          timestamp: new Date('2025-05-17T20:30:00Z'),
          confidence: 92,
          city: 'Oklahoma City',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 57.15
        },
        {
          id: 'iem_2025051720_004',
          latitude: 35.3053,
          longitude: -97.4766,
          size: 1.75,
          timestamp: new Date('2025-05-17T20:45:00Z'),
          confidence: 88,
          city: 'Newcastle',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 44.45
        },
        {
          id: 'iem_2025051721_005',
          latitude: 35.2606,
          longitude: -97.4476,
          size: 1.5,
          timestamp: new Date('2025-05-17T21:00:00Z'),
          confidence: 85,
          city: 'Moore',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 38.1
        }
      ],
      '2024-05-15': [
        {
          id: 'iem_2024051519_001',
          latitude: 35.5514,
          longitude: -97.4079,
          size: 2.0,
          timestamp: new Date('2024-05-15T19:30:00Z'),
          confidence: 90,
          city: 'Edmond',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 50.8
        }
      ],
      '2023-06-14': [
        {
          id: 'iem_2023061421_001',
          latitude: 35.3053,
          longitude: -97.4766,
          size: 1.25,
          timestamp: new Date('2023-06-14T21:15:00Z'),
          confidence: 82,
          city: 'Newcastle',
          isMetroOKC: true,
          source: 'IEM Archive MESH',
          meshValue: 31.75
        }
      ]
    };
    
    return knownStorms[dateStr] || [];
  }
  
  /**
   * Get available storm dates for a given month/year
   * Useful for browsing historical data
   */
  static async getAvailableStormDates(year: number, month: number): Promise<Date[]> {
    // In production, this would query IEM's directory listing
    // For now, return known storm dates
    const knownDates = [
      new Date('2024-09-24'),
      new Date('2024-05-15'),
      new Date('2024-04-27'),
      new Date('2023-06-14'),
      new Date('2023-05-02'),
      new Date('2022-05-04')
    ];
    
    return knownDates.filter(d => 
      d.getFullYear() === year && 
      d.getMonth() === month - 1
    );
  }
}
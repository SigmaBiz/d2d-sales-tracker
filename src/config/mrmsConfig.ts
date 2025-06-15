/**
 * MRMS Configuration
 * Settings for connecting to NOAA MRMS data sources
 */

export const MRMS_CONFIG = {
  // Data source priority (in order of preference)
  dataSources: [
    {
      name: 'NOAA Direct',
      enabled: true,
      endpoints: {
        mesh24hr: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_1440min/',
        mesh1hr: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_60min/',
        mesh30min: 'https://mrms.ncep.noaa.gov/data/realtime/MESH_Max_30min/',
      }
    },
    {
      name: 'Iowa State Mesonet',
      enabled: true,
      endpoints: {
        current: 'https://mesonet.agron.iastate.edu/json/radar',
        archive: 'https://mesonet.agron.iastate.edu/archive/data/',
      }
    },
    {
      name: 'NOAA WMS',
      enabled: false, // Disabled by default due to rate limits
      endpoints: {
        wms: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_mrms_mesh/ows',
      }
    }
  ],

  // Update intervals (milliseconds)
  updateIntervals: {
    realtime: 5 * 60 * 1000,      // 5 minutes for real-time monitoring
    historical: 60 * 60 * 1000,    // 1 hour for historical data refresh
  },

  // Data filtering
  filters: {
    minHailSize: 0.5,              // Minimum hail size in inches to report
    maxDataAge: 30 * 60 * 1000,    // Maximum age of data in milliseconds (30 min)
  },

  // Performance settings
  performance: {
    maxConcurrentRequests: 3,       // Max simultaneous API requests
    requestTimeout: 10000,          // Request timeout in milliseconds
    retryAttempts: 2,               // Number of retry attempts on failure
    cacheExpiry: 5 * 60 * 1000,     // Cache expiry time (5 minutes)
  },

  // Geographic settings for Oklahoma
  coverage: {
    oklahoma: {
      bounds: {
        north: 37.0,
        south: 33.6,
        east: -94.4,
        west: -103.0
      },
      gridResolution: 0.25,         // Grid resolution in degrees (~15 miles)
    },
    metroOKC: {
      center: { lat: 35.4676, lon: -97.5164 },
      radius: 50,                   // Radius in miles
      cities: [
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
      ]
    }
  },

  // Proxy server configuration (for production)
  proxy: {
    enabled: false,                 // Enable if using proxy server
    url: 'https://your-proxy-server.com/mrms',
    apiKey: process.env.MRMS_PROXY_API_KEY || '',
  },

  // Development settings
  development: {
    useMockData: true,              // Use mock data when real data unavailable
    mockDataProbability: 0.3,       // Probability of generating mock hail reports
    logRequests: true,              // Log all API requests
  }
};

/**
 * Get data source by name
 */
export function getDataSource(name: string) {
  return MRMS_CONFIG.dataSources.find(source => source.name === name);
}

/**
 * Check if point is in Metro OKC
 */
export function isInMetroOKC(lat: number, lon: number): boolean {
  const center = MRMS_CONFIG.coverage.metroOKC.center;
  const radiusInDegrees = MRMS_CONFIG.coverage.metroOKC.radius / 69; // Rough conversion
  
  const distance = Math.sqrt(
    Math.pow(lat - center.lat, 2) + 
    Math.pow(lon - center.lon, 2)
  );
  
  return distance <= radiusInDegrees;
}

/**
 * Get city name if in Metro OKC
 */
export function getMetroOKCCity(lat: number, lon: number): string | null {
  if (!isInMetroOKC(lat, lon)) return null;
  
  // In production, use proper geocoding
  // For now, return "Metro OKC" as placeholder
  return 'Metro OKC';
}
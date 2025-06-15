/**
 * Data Source Priority Configuration
 * Defines the fallback chain for hail data sources
 */

export interface DataSourceConfig {
  name: string;
  type: 'realtime' | 'historical' | 'mock';
  enabled: boolean;
  priority: number;
  endpoint?: string;
  requiresProxy: boolean;
  updateInterval?: number;
}

// AFTER WeatherAPI Removal - Clean Architecture
export const DATA_SOURCES_CLEAN: DataSourceConfig[] = [
  {
    name: 'NCEP MRMS Real-Time',
    type: 'realtime',
    enabled: true,
    priority: 1,
    endpoint: 'https://mrms.ncep.noaa.gov/data/realtime/',
    requiresProxy: true,
    updateInterval: 2 * 60 * 1000 // 2 minutes
  },
  {
    name: 'MRMS Proxy',
    type: 'realtime',
    enabled: true,
    priority: 2,
    endpoint: process.env.EXPO_PUBLIC_MRMS_PROXY_URL,
    requiresProxy: false,
    updateInterval: 5 * 60 * 1000 // 5 minutes
  },
  {
    name: 'IEM Recent Archive',
    type: 'historical',
    enabled: true,
    priority: 3,
    endpoint: 'https://mrms.agron.iastate.edu/',
    requiresProxy: true,
    updateInterval: 60 * 60 * 1000 // 1 hour
  },
  {
    name: 'Mock Data',
    type: 'mock',
    enabled: __DEV__, // Only in development
    priority: 99,
    requiresProxy: false
  }
];

// BEFORE - With WeatherAPI (Current Implementation)
export const DATA_SOURCES_WITH_WEATHERAPI: DataSourceConfig[] = [
  {
    name: 'WeatherAPI',
    type: 'realtime',
    enabled: true,
    priority: 1, // Currently highest priority
    endpoint: 'https://api.weatherapi.com/v1/',
    requiresProxy: false,
    updateInterval: 15 * 60 * 1000 // 15 minutes
  },
  {
    name: 'MRMS Proxy',
    type: 'realtime',
    enabled: true,
    priority: 2,
    endpoint: process.env.EXPO_PUBLIC_MRMS_PROXY_URL,
    requiresProxy: false
  },
  {
    name: 'Mock Data',
    type: 'mock',
    enabled: true,
    priority: 3,
    requiresProxy: false
  }
];

/**
 * Data Quality Comparison
 */
export const DATA_QUALITY_METRICS = {
  'NCEP MRMS': {
    accuracy: 95,
    coverage: 100,
    updateFrequency: 2,
    resolution: '1km',
    scientificGrade: true,
    cost: 0
  },
  'IEM Archive': {
    accuracy: 95,
    coverage: 100,
    updateFrequency: 60,
    resolution: '1km',
    scientificGrade: true,
    cost: 0
  },
  'WeatherAPI': {
    accuracy: 70,
    coverage: 30, // Major cities only
    updateFrequency: 15,
    resolution: 'City-level',
    scientificGrade: false,
    cost: 65 // per month
  },
  'Mock Data': {
    accuracy: 0,
    coverage: 5,
    updateFrequency: 0,
    resolution: 'N/A',
    scientificGrade: false,
    cost: 0
  }
};

/**
 * Migration Path
 */
export const MIGRATION_STEPS = [
  {
    step: 1,
    action: 'Deploy CORS proxy',
    status: 'pending',
    critical: true
  },
  {
    step: 2,
    action: 'Test NCEP MRMS through proxy',
    status: 'pending',
    critical: true
  },
  {
    step: 3,
    action: 'Test IEM Archives through proxy',
    status: 'pending',
    critical: true
  },
  {
    step: 4,
    action: 'Update mrmsService.ts',
    status: 'pending',
    critical: true
  },
  {
    step: 5,
    action: 'Remove WeatherAPI service',
    status: 'pending',
    critical: false
  },
  {
    step: 6,
    action: 'Update environment variables',
    status: 'pending',
    critical: false
  },
  {
    step: 7,
    action: 'Test complete data flow',
    status: 'pending',
    critical: true
  }
];

/**
 * Get current data source configuration
 */
export function getCurrentDataSources(): DataSourceConfig[] {
  // TODO: After proxy deployment, return DATA_SOURCES_CLEAN
  return DATA_SOURCES_WITH_WEATHERAPI;
}

/**
 * Check if migration is ready
 */
export function isMigrationReady(): boolean {
  const criticalSteps = MIGRATION_STEPS.filter(s => s.critical);
  return criticalSteps.every(s => s.status === 'complete');
}
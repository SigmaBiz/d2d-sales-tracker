/**
 * Optimization Configuration
 * Toggle between original and optimized implementations for testing
 */

// Set to true to use optimized components
export const USE_OPTIMIZED_COMPONENTS = true;

// Individual optimization flags for granular testing
export const OPTIMIZATIONS = {
  USE_CLUSTERED_MAP: true,      // WebMapOptimized with clustering
  USE_MEMOIZED_SCREEN: true,    // RealMapScreenOptimized with memoization
  USE_OPTIMIZED_SYNC: true,     // AutoSyncServiceOptimized with cleanup
  USE_DEBOUNCED_LOCATION: true, // Debounced GPS updates
};

// Performance monitoring
export const PERFORMANCE_MONITORING = {
  LOG_RENDER_TIMES: true,
  LOG_MEMORY_USAGE: true,
  LOG_SYNC_OPERATIONS: true,
  LOG_MAP_OPERATIONS: true,
};

// Testing helpers
export const generateTestKnocks = (count: number) => {
  console.log(`Generating ${count} test knocks...`);
  return Array.from({ length: count }, (_, i) => ({
    id: `test-${Date.now()}-${i}`,
    latitude: 35.4676 + (Math.random() - 0.5) * 0.2,
    longitude: -97.5164 + (Math.random() - 0.5) * 0.2,
    outcome: ['not_home', 'lead', 'sale', 'convo', 'not_interested'][Math.floor(Math.random() * 5)] as any,
    timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time in last week
    address: `${Math.floor(Math.random() * 9999)} Test Street`,
    notes: i % 3 === 0 ? 'Test note for performance testing' : '',
    syncStatus: 'synced' as const,
    history: i % 5 === 0 ? [{
      outcome: 'not_home' as any,
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
      notes: 'Previous visit'
    }] : undefined
  }));
};
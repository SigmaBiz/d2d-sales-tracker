/**
 * Core Initialization Module
 * Essential services needed for basic app functionality
 */

import { SupabaseService } from '../services/supabaseService';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageServiceWrapper';
import { AutoSyncServiceOptimized } from '../services/autoSyncServiceOptimized';

export async function initCore(): Promise<void> {
  console.log('[INIT] Starting core initialization...');
  
  try {
    // 1. Initialize Supabase (needed for auth/sync)
    console.log('[INIT] Initializing Supabase...');
    SupabaseService.initialize();
    
    // 2. Request location permissions (needed for map)
    console.log('[INIT] Requesting location permissions...');
    try {
      await LocationService.requestPermissions();
    } catch (permError) {
      console.warn('[INIT] Location permission error (may be Expo Go):', permError.message);
      // Continue without location permissions - Expo Go handles this differently
    }
    
    // 3. Initialize Auto-Sync Service
    console.log('[INIT] Initializing auto-sync service...');
    await AutoSyncServiceOptimized.initialize();
    
    // 4. Wrap saveKnock for auto-sync integration
    const originalSaveKnock = StorageService.saveKnock.bind(StorageService);
    StorageService.saveKnock = async (knock) => {
      await originalSaveKnock(knock);
      AutoSyncServiceOptimized.incrementPendingChanges();
    };
    
    console.log('[INIT] Core initialization complete');
  } catch (error) {
    console.error('[INIT] Core initialization failed:', error);
    // Don't throw if it's just a location permission error in Expo Go
    if (error.message && error.message.includes('NSLocation')) {
      console.warn('[INIT] Continuing without location permissions (Expo Go)');
      return; // Let initialization continue
    }
    throw error; // Other errors should still fail
  }
}

export function cleanupCore(): void {
  console.log('[INIT] Cleaning up core services...');
  
  // Clean up auto-sync service
  AutoSyncServiceOptimized.cleanup();
  
  // Note: We don't restore saveKnock here as it's still needed
}
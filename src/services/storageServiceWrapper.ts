import { USE_OPTIMIZED_COMPONENTS, OPTIMIZATIONS } from '../config/optimization';
import { StorageService as StorageServiceOriginal } from './storageService';
import { StorageServiceOptimized } from './storageServiceOptimized';
import { StorageServiceNative } from './storageServiceNative';

/**
 * Wrapper to switch between original, optimized, and native StorageService
 * Priority: Native (if enabled) > Optimized > Original
 */
export const StorageService = OPTIMIZATIONS.USE_NATIVE_STORAGE 
  ? StorageServiceNative
  : USE_OPTIMIZED_COMPONENTS 
    ? StorageServiceOptimized 
    : StorageServiceOriginal;

// Log which version is being used
if (OPTIMIZATIONS.USE_NATIVE_STORAGE) {
  console.log('[Performance] Using NATIVE StorageService (SQLite with fallback)');
} else if (USE_OPTIMIZED_COMPONENTS) {
  console.log('[Performance] Using OPTIMIZED StorageService (15ft location matching)');
} else {
  console.log('[Performance] Using ORIGINAL StorageService (36ft location matching)');
}
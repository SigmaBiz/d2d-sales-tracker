import { USE_OPTIMIZED_COMPONENTS } from '../config/optimization';
import { StorageService as StorageServiceOriginal } from './storageService';
import { StorageServiceOptimized } from './storageServiceOptimized';

/**
 * Wrapper to switch between original and optimized StorageService
 * This allows the 15-foot location matching to be toggled with the optimization flag
 */
export const StorageService = USE_OPTIMIZED_COMPONENTS 
  ? StorageServiceOptimized 
  : StorageServiceOriginal;

// Log which version is being used
if (USE_OPTIMIZED_COMPONENTS) {
  console.log('[Performance] Using OPTIMIZED StorageService (15ft location matching)');
} else {
  console.log('[Performance] Using ORIGINAL StorageService (36ft location matching)');
}
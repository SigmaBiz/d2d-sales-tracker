/**
 * Hail System Initialization Module
 * 3-Tier Hail Intelligence System - can be deferred
 */

import { IntegratedHailIntelligence } from '../services/integratedHailIntelligence';
import { HailAlertService } from '../services/hailAlertService';

export async function initHailSystem(): Promise<void> {
  console.log('[INIT] Starting hail system initialization...');
  
  try {
    // Initialize 3-Tier Hail Intelligence System
    await IntegratedHailIntelligence.initialize({
      enableRealTime: true,
      enableHistorical: true,
      enableValidation: true,
      alertThreshold: 25  // 1 inch hail
    });
    
    console.log('[INIT] Hail system initialization complete');
  } catch (error) {
    console.error('[INIT] Hail system initialization failed:', error);
    // Don't throw - hail system is not critical for basic functionality
  }
}

export function cleanupHailSystem(): void {
  console.log('[INIT] Cleaning up hail system...');
  
  // Stop hail monitoring
  HailAlertService.stopMonitoring();
}
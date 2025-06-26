/**
 * Initialization Orchestrator
 * Manages app initialization in phases
 */

import { initCore, cleanupCore } from './initCore';
import { initHailSystem, cleanupHailSystem } from './initHailSystem';
import { initNotifications, cleanupNotifications } from './initNotifications';
import { InteractionManager } from 'react-native';

export interface InitializationState {
  coreInitialized: boolean;
  hailSystemInitialized: boolean;
  notificationsInitialized: boolean;
  notificationListeners: any;
}

const state: InitializationState = {
  coreInitialized: false,
  hailSystemInitialized: false,
  notificationsInitialized: false,
  notificationListeners: null
};

/**
 * Phase 1: Initialize only core services needed for basic functionality
 */
export async function initializePhase1(): Promise<void> {
  console.log('[INIT] === Phase 1: Core Initialization ===');
  
  // Core must succeed
  await initCore();
  state.coreInitialized = true;
  
  // Notifications can fail without breaking the app
  state.notificationListeners = initNotifications();
  state.notificationsInitialized = true;
}

/**
 * Phase 2: Initialize non-critical services in background
 */
export async function initializePhase2(): Promise<void> {
  console.log('[INIT] === Phase 2: Background Initialization ===');
  
  // Wait for interactions to complete before heavy initialization
  InteractionManager.runAfterInteractions(async () => {
    console.log('[INIT] Starting background services...');
    
    // Hail system is heavy but not critical for basic use
    await initHailSystem();
    state.hailSystemInitialized = true;
  });
}

/**
 * Initialize all phases based on configuration
 */
export async function initializeApp(options: {
  deferNonCritical?: boolean;
} = {}): Promise<void> {
  const { deferNonCritical = true } = options;
  
  console.log('[INIT] Starting app initialization...');
  console.log('[INIT] Defer non-critical:', deferNonCritical);
  
  // Always do Phase 1
  await initializePhase1();
  
  if (deferNonCritical) {
    // Defer Phase 2 to background
    setTimeout(() => {
      initializePhase2();
    }, 1000); // 1 second delay to let UI settle
  } else {
    // Initialize everything immediately (old behavior)
    await initHailSystem();
    state.hailSystemInitialized = true;
  }
}

/**
 * Clean up all initialized services
 */
export function cleanupApp(): void {
  console.log('[INIT] Cleaning up app services...');
  
  if (state.notificationsInitialized && state.notificationListeners) {
    cleanupNotifications(state.notificationListeners);
    state.notificationsInitialized = false;
  }
  
  if (state.hailSystemInitialized) {
    cleanupHailSystem();
    state.hailSystemInitialized = false;
  }
  
  if (state.coreInitialized) {
    cleanupCore();
    state.coreInitialized = false;
  }
}

/**
 * Get current initialization state
 */
export function getInitializationState(): InitializationState {
  return { ...state };
}
/**
 * Native Module Manager
 * Handles all native modules with automatic fallback to JavaScript implementations
 * Following the fortified protocol: preserve exact functionality
 */

import { NativeModules, Platform } from 'react-native';
import { OPTIMIZATIONS } from '../config/optimization';

// Type definitions for our native modules
export interface NativeStorageModule {
  // Exact same interface as StorageService
  saveKnock: (knock: any) => Promise<void>;
  getKnocks: () => Promise<any[]>;
  getVisibleKnocks: () => Promise<any[]>;
  getRecentKnocks: (limit: number, includeCleared: boolean) => Promise<any[]>;
  getKnocksByDateRange: (startDate: string, endDate: string, includeCleared: boolean) => Promise<any[]>;
  clearKnock: (knockId: string) => Promise<void>;
  getClearedKnockIds: () => Promise<string[]>;
  deleteKnock: (knockId: string) => Promise<void>;
  
  // Kill switch
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => Promise<boolean>;
}

export interface NativeMapModule {
  // Exact same interface as WebMap
  renderMap: (params: any) => Promise<void>;
  updateKnocks: (knocks: any[]) => Promise<void>;
  centerOnLocation: (lat: number, lng: number, zoom?: number) => Promise<void>;
  
  // Kill switch
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => Promise<boolean>;
}

class NativeModuleManagerClass {
  private storageModule: NativeStorageModule | null = null;
  private mapModule: NativeMapModule | null = null;
  
  constructor() {
    this.initializeModules();
  }
  
  private initializeModules() {
    // Check if native modules are available (iOS only for now)
    if (Platform.OS === 'ios') {
      this.storageModule = NativeModules.D2DNativeStorage || null;
      this.mapModule = NativeModules.D2DNativeMap || null;
    } else if (Platform.OS === 'android') {
      // Android modules will be added later
      console.log('[NativeModuleManager] Android native modules not yet implemented');
    }
    
    // Log availability
    console.log('[NativeModuleManager] Available modules:', {
      storage: !!this.storageModule,
      map: !!this.mapModule,
      platform: Platform.OS,
      iosOnly: true
    });
  }
  
  // Storage module getter with kill switch check
  get storage(): NativeStorageModule | null {
    if (!OPTIMIZATIONS.USE_NATIVE_STORAGE) {
      console.log('[NativeModuleManager] Native storage disabled by kill switch');
      return null;
    }
    return this.storageModule;
  }
  
  // Map module getter with kill switch check
  get map(): NativeMapModule | null {
    if (!OPTIMIZATIONS.USE_NATIVE_MAP) {
      console.log('[NativeModuleManager] Native map disabled by kill switch');
      return null;
    }
    return this.mapModule;
  }
  
  // Check if any native modules are available and enabled
  hasNativeModules(): boolean {
    return !!(
      (this.storage && OPTIMIZATIONS.USE_NATIVE_STORAGE) ||
      (this.map && OPTIMIZATIONS.USE_NATIVE_MAP)
    );
  }
  
  // Disable all native modules (emergency kill switch)
  disableAllNativeModules() {
    console.warn('[NativeModuleManager] EMERGENCY KILL SWITCH ACTIVATED');
    
    if (this.storageModule) {
      this.storageModule.setEnabled(false);
    }
    
    if (this.mapModule) {
      this.mapModule.setEnabled(false);
    }
    
    // Also update config
    OPTIMIZATIONS.USE_NATIVE_STORAGE = false;
    OPTIMIZATIONS.USE_NATIVE_MAP = false;
    OPTIMIZATIONS.USE_NATIVE_KNOCK_LOGIC = false;
    OPTIMIZATIONS.USE_NATIVE_HAIL = false;
  }
  
  // Get performance metrics
  async getPerformanceMetrics() {
    const metrics: any = {
      nativeModulesAvailable: this.hasNativeModules(),
      platform: Platform.OS,
    };
    
    if (this.storageModule) {
      metrics.storageEnabled = await this.storageModule.isEnabled();
    }
    
    if (this.mapModule) {
      metrics.mapEnabled = await this.mapModule.isEnabled();
    }
    
    return metrics;
  }
}

// Singleton instance
export const NativeModuleManager = new NativeModuleManagerClass();
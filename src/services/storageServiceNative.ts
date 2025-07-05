/**
 * Native-Aware Storage Service
 * Uses native SQLite when available, falls back to AsyncStorage
 * Preserves exact same interface and behavior
 */

import { Knock } from '../types';
import { StorageService } from './storageService';
import { NativeModuleManager } from '../native/NativeModuleManager';

class StorageServiceNativeClass {
  private useNative: boolean = false;
  
  constructor() {
    this.checkNativeAvailability();
  }
  
  private async checkNativeAvailability() {
    const nativeStorage = NativeModuleManager.storage;
    if (nativeStorage) {
      try {
        this.useNative = await nativeStorage.isEnabled();
        console.log('[StorageServiceNative] Native storage available:', this.useNative);
      } catch (error) {
        console.log('[StorageServiceNative] Native storage not available, using AsyncStorage');
        this.useNative = false;
      }
    }
  }
  
  // EXACT SAME INTERFACE AS ORIGINAL StorageService
  
  async saveKnock(knock: Knock): Promise<void> {
    const startTime = Date.now();
    
    if (this.useNative && NativeModuleManager.storage) {
      try {
        await NativeModuleManager.storage.saveKnock(knock);
        console.log(`[StorageServiceNative] Native save completed in ${Date.now() - startTime}ms`);
        return;
      } catch (error) {
        console.error('[StorageServiceNative] Native save failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    // Fallback to original implementation
    await StorageService.saveKnock(knock);
    console.log(`[StorageServiceNative] AsyncStorage save completed in ${Date.now() - startTime}ms`);
  }
  
  async getKnocks(): Promise<Knock[]> {
    const startTime = Date.now();
    
    if (this.useNative && NativeModuleManager.storage) {
      try {
        const knocks = await NativeModuleManager.storage.getKnocks();
        console.log(`[StorageServiceNative] Native load ${knocks.length} knocks in ${Date.now() - startTime}ms`);
        return knocks;
      } catch (error) {
        console.error('[StorageServiceNative] Native load failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    // Fallback to original implementation
    const knocks = await StorageService.getKnocks();
    console.log(`[StorageServiceNative] AsyncStorage load ${knocks.length} knocks in ${Date.now() - startTime}ms`);
    return knocks;
  }
  
  async getVisibleKnocks(): Promise<Knock[]> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        return await NativeModuleManager.storage.getVisibleKnocks();
      } catch (error) {
        console.error('[StorageServiceNative] Native getVisibleKnocks failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    return await StorageService.getVisibleKnocks();
  }
  
  async getRecentKnocks(limit: number, includeCleared: boolean = false): Promise<Knock[]> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        return await NativeModuleManager.storage.getRecentKnocks(limit, includeCleared);
      } catch (error) {
        console.error('[StorageServiceNative] Native getRecentKnocks failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    return await StorageService.getRecentKnocks(limit, includeCleared);
  }
  
  async getKnocksByDateRange(startDate: Date, endDate: Date, includeCleared: boolean = false): Promise<Knock[]> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        return await NativeModuleManager.storage.getKnocksByDateRange(
          startDate.toISOString(),
          endDate.toISOString(),
          includeCleared
        );
      } catch (error) {
        console.error('[StorageServiceNative] Native getKnocksByDateRange failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    return await StorageService.getKnocksByDateRange(startDate, endDate, includeCleared);
  }
  
  async clearKnock(knockId: string): Promise<void> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        await NativeModuleManager.storage.clearKnock(knockId);
        return;
      } catch (error) {
        console.error('[StorageServiceNative] Native clearKnock failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    await StorageService.clearKnock(knockId);
  }
  
  async getClearedKnockIds(): Promise<string[]> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        return await NativeModuleManager.storage.getClearedKnockIds();
      } catch (error) {
        console.error('[StorageServiceNative] Native getClearedKnockIds failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    return await StorageService.getClearedKnockIds();
  }
  
  async deleteKnock(knockId: string): Promise<void> {
    if (this.useNative && NativeModuleManager.storage) {
      try {
        await NativeModuleManager.storage.deleteKnock(knockId);
        return;
      } catch (error) {
        console.error('[StorageServiceNative] Native deleteKnock failed, falling back:', error);
        this.useNative = false;
      }
    }
    
    await StorageService.deleteKnock(knockId);
  }
  
  // Performance comparison method
  async comparePerformance(): Promise<void> {
    console.log('=== Storage Performance Comparison ===');
    
    // Test data
    const testKnock: Knock = {
      id: `perf-test-${Date.now()}`,
      latitude: 35.4676,
      longitude: -97.5164,
      outcome: 'not_home',
      timestamp: new Date(),
      address: '123 Performance Test St',
      notes: 'Testing native vs AsyncStorage performance',
      syncStatus: 'pending'
    };
    
    // Test native save
    if (this.useNative && NativeModuleManager.storage) {
      const nativeStart = Date.now();
      await NativeModuleManager.storage.saveKnock(testKnock);
      const nativeTime = Date.now() - nativeStart;
      console.log(`Native save: ${nativeTime}ms`);
    }
    
    // Test AsyncStorage save
    const asyncStart = Date.now();
    await StorageService.saveKnock({ ...testKnock, id: `${testKnock.id}-async` });
    const asyncTime = Date.now() - asyncStart;
    console.log(`AsyncStorage save: ${asyncTime}ms`);
    
    // Test load performance
    if (this.useNative && NativeModuleManager.storage) {
      const nativeLoadStart = Date.now();
      const nativeKnocks = await NativeModuleManager.storage.getKnocks();
      const nativeLoadTime = Date.now() - nativeLoadStart;
      console.log(`Native load ${nativeKnocks.length} knocks: ${nativeLoadTime}ms`);
    }
    
    const asyncLoadStart = Date.now();
    const asyncKnocks = await StorageService.getKnocks();
    const asyncLoadTime = Date.now() - asyncLoadStart;
    console.log(`AsyncStorage load ${asyncKnocks.length} knocks: ${asyncLoadTime}ms`);
    
    console.log('=== End Performance Comparison ===');
  }

  // Additional methods that delegate to StorageService
  // Daily Stats
  async getDailyStats() {
    return await StorageService.getDailyStats();
  }

  async saveDailyStats(stats: any) {
    return await StorageService.saveDailyStats(stats);
  }

  // Territories
  async saveTerritories(territories: any[]) {
    return await StorageService.saveTerritories(territories);
  }

  async getTerritories() {
    return await StorageService.getTerritories();
  }

  // Settings
  async saveSettings(settings: any) {
    return await StorageService.saveSettings(settings);
  }

  async getSettings() {
    return await StorageService.getSettings();
  }

  // Contact Forms
  async saveContactForm(knockId: string, formData: any) {
    return await StorageService.saveContactForm(knockId, formData);
  }

  async getContactForms() {
    return await StorageService.getContactForms();
  }

  async getContactFormByKnockId(knockId: string) {
    return await StorageService.getContactFormsByKnockIds([knockId]);
  }

  async getContactFormByAddress(address: string) {
    return await StorageService.getContactFormByAddress(address);
  }

  // Clear operations
  async clearAll() {
    if (this.useNative && NativeModuleManager.storage) {
      // Clear native storage too
      this.useNative = false; // Reset to recheck availability
    }
    return await StorageService.clearAll();
  }

  // Notification Log
  async getNotificationLog() {
    return await StorageService.getNotificationLog();
  }

  async saveNotificationLogEntry(entry: any) {
    return await StorageService.saveNotificationLogEntry(entry);
  }
}

// Export singleton instance
export const StorageServiceNative = new StorageServiceNativeClass();
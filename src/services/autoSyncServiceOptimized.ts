import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import { StorageService } from './storageServiceWrapper';
import { SupabaseService } from './supabaseService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Industry standard sync intervals (PRESERVED from CORE_ARCHITECTURE_SNAPSHOT.md)
const SYNC_INTERVALS = {
  ACTIVE_USE: 30 * 1000,        // 30 seconds during active use
  BACKGROUND: 5 * 60 * 1000,    // 5 minutes in background
  ON_APP_FOREGROUND: 0,         // Immediate sync when app returns
  ON_NETWORK_RECONNECT: 0,      // Immediate sync when network returns
  ON_SIGNIFICANT_CHANGE: 0,     // Immediate sync after 10+ knocks
  LOW_BATTERY: 30 * 60 * 1000,  // 30 minutes when battery < 20%
  RETRY_BACKOFF: [1, 2, 5, 10, 30] // Minutes for retry attempts
};

export class AutoSyncServiceOptimized {
  private static syncInterval: NodeJS.Timeout | null = null;
  private static lastSyncTime: Date | null = null;
  private static pendingChanges: number = 0;
  private static isActive: boolean = true;
  private static retryCount: number = 0;
  private static isConnected: boolean = true;
  private static autoSyncEnabled: boolean = true;
  private static syncInProgress: boolean = false;
  
  // OPTIMIZATION: Track subscriptions for cleanup
  private static appStateSubscription: any = null;
  private static netInfoSubscription: NetInfoSubscription | null = null;
  private static retryTimeout: NodeJS.Timeout | null = null;

  static async initialize() {
    console.log('[AutoSync] Initializing auto-sync service...');
    
    // OPTIMIZATION: Clean up any existing subscriptions first
    this.cleanup();
    
    // Load settings
    const settings = await StorageService.getSettings();
    this.autoSyncEnabled = settings.autoSyncEnabled !== false;
    
    // Load last sync time
    this.lastSyncTime = await StorageService.getLastSyncTime();
    
    // Set up app state listener with proper cleanup tracking
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    
    // Set up network listener with proper cleanup tracking
    this.netInfoSubscription = NetInfo.addEventListener(state => {
      this.handleNetworkChange(state.isConnected || false);
    });
    
    // Start sync interval
    if (this.autoSyncEnabled) {
      this.startSyncInterval();
    }
    
    // Perform initial sync if needed
    const timeSinceLastSync = Date.now() - (this.lastSyncTime?.getTime() || 0);
    if (timeSinceLastSync > SYNC_INTERVALS.BACKGROUND) {
      this.performSync();
    }
  }

  // OPTIMIZATION: Add cleanup method
  static cleanup() {
    console.log('[AutoSync] Cleaning up auto-sync service...');
    
    // Clear sync interval
    this.stopSyncInterval();
    
    // Clear retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    
    // Remove app state listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    
    // Remove network listener
    if (this.netInfoSubscription) {
      this.netInfoSubscription();
      this.netInfoSubscription = null;
    }
  }

  static setAutoSyncEnabled(enabled: boolean) {
    this.autoSyncEnabled = enabled;
    if (enabled && !this.syncInterval) {
      this.startSyncInterval();
    } else if (!enabled && this.syncInterval) {
      this.stopSyncInterval();
    }
  }

  static incrementPendingChanges() {
    this.pendingChanges++;
    
    // Trigger sync if significant changes
    if (this.pendingChanges >= 10 && this.autoSyncEnabled) {
      console.log('[AutoSync] Significant changes detected, triggering sync...');
      this.performSync();
    }
  }

  private static startSyncInterval() {
    this.stopSyncInterval(); // Clear any existing interval
    
    const interval = this.isActive 
      ? SYNC_INTERVALS.ACTIVE_USE 
      : SYNC_INTERVALS.BACKGROUND;

    console.log(`[AutoSync] Starting sync interval: ${interval / 1000}s`);
    
    this.syncInterval = setInterval(() => {
      if (this.autoSyncEnabled) {
        this.performSync();
      }
    }, interval);
  }

  private static stopSyncInterval() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // OPTIMIZATION: Use arrow function to preserve context
  private static handleAppStateChange = (nextAppState: AppStateStatus) => {
    const wasActive = this.isActive;
    this.isActive = nextAppState === 'active';
    
    if (!wasActive && this.isActive) {
      // App came to foreground
      console.log('[AutoSync] App came to foreground, triggering sync...');
      this.performSync();
    }
    
    // Restart interval with new timing
    if (this.autoSyncEnabled) {
      this.startSyncInterval();
    }
  };

  private static handleNetworkChange = (isConnected: boolean) => {
    const wasConnected = this.isConnected;
    this.isConnected = isConnected;
    
    if (!wasConnected && isConnected) {
      // Network reconnected
      console.log('[AutoSync] Network reconnected, triggering sync...');
      this.performSync();
    }
  };

  static async performSync() {
    // Skip if already syncing
    if (this.syncInProgress) {
      console.log('[AutoSync] Sync already in progress, skipping...');
      return;
    }
    
    // Skip if not connected
    if (!this.isConnected) {
      console.log('[AutoSync] No network connection, skipping sync...');
      return;
    }
    
    this.syncInProgress = true;
    
    try {
      console.log('[AutoSync] Starting sync...');
      
      // Get all knocks (not just visible ones - we sync everything)
      const knocks = await StorageService.getKnocks();
      const clearedIds = await StorageService.getClearedKnockIds();
      
      // Sync knocks with metadata about cleared status
      await SupabaseService.syncKnocks(knocks, {
        clearedIds,
        deviceId: await this.getDeviceId(),
        syncTime: new Date()
      });
      
      // Update last sync time
      this.lastSyncTime = new Date();
      await StorageService.setLastSyncTime(this.lastSyncTime);
      
      // Reset pending changes and retry count
      this.pendingChanges = 0;
      this.retryCount = 0;
      
      console.log(`[AutoSync] Sync completed: ${knocks.length} knocks, ${clearedIds.length} cleared`);
    } catch (error) {
      console.error('[AutoSync] Sync failed:', error);
      this.handleSyncError();
    } finally {
      this.syncInProgress = false;
    }
  }

  private static handleSyncError() {
    this.retryCount++;
    
    if (this.retryCount < SYNC_INTERVALS.RETRY_BACKOFF.length) {
      const retryDelay = SYNC_INTERVALS.RETRY_BACKOFF[this.retryCount] * 60 * 1000;
      console.log(`[AutoSync] Will retry in ${retryDelay / 1000}s`);
      
      // OPTIMIZATION: Clear any existing retry timeout
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout);
      }
      
      this.retryTimeout = setTimeout(() => {
        this.performSync();
        this.retryTimeout = null;
      }, retryDelay);
    }
  }

  private static async getDeviceId(): Promise<string> {
    let deviceId = await AsyncStorage.getItem('@device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem('@device_id', deviceId);
    }
    return deviceId;
  }

  static getStatus() {
    return {
      enabled: this.autoSyncEnabled,
      lastSyncTime: this.lastSyncTime,
      pendingChanges: this.pendingChanges,
      isConnected: this.isConnected,
      syncInProgress: this.syncInProgress,
      retryCount: this.retryCount,
    };
  }

  static async manualSync() {
    console.log('[AutoSync] Manual sync triggered');
    this.retryCount = 0; // Reset retry count for manual sync
    await this.performSync();
  }
}
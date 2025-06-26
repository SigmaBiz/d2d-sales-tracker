import AsyncStorage from '@react-native-async-storage/async-storage';
import { Knock, DailyStats, Settings } from '../types';
import NetInfo from '@react-native-community/netinfo';
import { KnockDebugger, logLocationMatch } from '../utils/knockDebugger';

// PRESERVATION: All storage keys exactly as defined in CORE_ARCHITECTURE_SNAPSHOT.md
const KEYS = {
  KNOCKS: '@knocks',
  DAILY_STATS: '@daily_stats_',
  SETTINGS: '@settings',
  CLEARED_KNOCKS: '@cleared_knocks',
  LAST_SYNC: '@last_sync',
};

export class StorageServiceOptimized {
  // OPTIMIZATION: Add configurable location matching precision
  // Default: 0.00004 degrees ≈ 4.4 meters (15 feet) - optimal for typical suburban houses
  // Original: 0.0001 degrees ≈ 11 meters (36 feet) - too broad for close houses
  // Research shows typical house-to-house distance is 10-20 feet with 5-10 foot setbacks
  private static LOCATION_MATCH_PRECISION = 0.00004;

  // Allow dynamic adjustment for different scenarios
  static setLocationMatchPrecision(degrees: number) {
    // Validate range: 0.00001 (1.1m) to 0.0001 (11m)
    if (degrees >= 0.00001 && degrees <= 0.0001) {
      this.LOCATION_MATCH_PRECISION = degrees;
      console.log(`[StorageService] Location match precision set to ${degrees} degrees (≈${degrees * 111000}m)`);
    }
  }

  static async saveKnock(knock: Knock): Promise<void> {
    KnockDebugger.log('🔍 StorageService.saveKnock called', {
      knockId: knock.id,
      location: { lat: knock.latitude, lng: knock.longitude },
      address: knock.address
    });
    
    const knocks = await this.getKnocks();
    KnockDebugger.log(`📊 Found ${knocks.length} existing knocks`);
    
    // PRESERVATION: One tag per location system with history tracking
    // Check if there's already a knock at this address/location
    let existingIndex = -1;
    for (let i = 0; i < knocks.length; i++) {
      const k = knocks[i];
      
      // Check address match
      if (k.address && k.address === knock.address) {
        KnockDebugger.log('🏠 Found matching address', {
          existingAddress: k.address,
          newAddress: knock.address
        });
        existingIndex = i;
        break;
      }
      
      // Check location match
      const latDiff = Math.abs(k.latitude - knock.latitude);
      const lngDiff = Math.abs(k.longitude - knock.longitude);
      const distance = Math.max(latDiff, lngDiff);
      
      if (latDiff < this.LOCATION_MATCH_PRECISION && 
          lngDiff < this.LOCATION_MATCH_PRECISION) {
        logLocationMatch(
          knock.latitude,
          knock.longitude,
          k,
          distance,
          this.LOCATION_MATCH_PRECISION
        );
        existingIndex = i;
        break;
      }
    }
    
    if (existingIndex !== -1) {
      // PRESERVATION: Update existing knock and maintain history
      const existingKnock = knocks[existingIndex];
      
      console.log('🔵 DEBUG - Updating existing knock:', {
        id: existingKnock.id,
        oldOutcome: existingKnock.outcome,
        newOutcome: knock.outcome,
        address: existingKnock.address,
      });
      
      // Add current state to history before updating
      if (!existingKnock.history) {
        existingKnock.history = [];
      }
      existingKnock.history.push({
        outcome: existingKnock.outcome,
        timestamp: existingKnock.timestamp,
        notes: existingKnock.notes,
      });
      
      // Update with new data
      knocks[existingIndex] = {
        ...existingKnock,
        ...knock,
        id: existingKnock.id, // Preserve original ID
        timestamp: existingKnock.timestamp, // Preserve original timestamp
        history: existingKnock.history,
      };
      
      // IMPORTANT: Remove from cleared list if it was cleared before
      const clearedIds = await this.getClearedKnockIds();
      const updatedClearedIds = clearedIds.filter(id => id !== existingKnock.id);
      if (clearedIds.length !== updatedClearedIds.length) {
        await AsyncStorage.setItem(KEYS.CLEARED_KNOCKS, JSON.stringify(updatedClearedIds));
        console.log('🟢 DEBUG - Removed knock from cleared list:', existingKnock.id);
      }
      
      console.log('🟢 DEBUG - Knock updated successfully:', {
        id: knocks[existingIndex].id,
        outcome: knocks[existingIndex].outcome,
        notes: knocks[existingIndex].notes,
      });
      
      console.log('Updated existing knock at location:', knock.address || `${knock.latitude}, ${knock.longitude}`);
    } else {
      // Create new knock with generated ID if not provided
      if (!knock.id) {
        knock.id = Date.now().toString();
      }
      knocks.push(knock);
      console.log('Created new knock at location:', knock.address || `${knock.latitude}, ${knock.longitude}`);
    }
    
    await AsyncStorage.setItem(KEYS.KNOCKS, JSON.stringify(knocks));
    await this.updateDailyStats(knock);
  }

  static async getKnocks(): Promise<Knock[]> {
    try {
      const knocksJson = await AsyncStorage.getItem(KEYS.KNOCKS);
      if (!knocksJson) return [];
      
      const knocks = JSON.parse(knocksJson);
      // Ensure dates are properly parsed
      return knocks.map((k: any) => ({
        ...k,
        timestamp: new Date(k.timestamp),
        history: k.history?.map((h: any) => ({
          ...h,
          timestamp: new Date(h.timestamp),
        })),
      }));
    } catch (error) {
      console.error('Error loading knocks:', error);
      return [];
    }
  }

  static async getKnockById(id: string): Promise<Knock | null> {
    const knocks = await this.getKnocks();
    return knocks.find(k => k.id === id) || null;
  }

  static async deleteKnock(id: string): Promise<void> {
    const knocks = await this.getKnocks();
    const filtered = knocks.filter(k => k.id !== id);
    await AsyncStorage.setItem(KEYS.KNOCKS, JSON.stringify(filtered));
  }

  static async getUnsyncedKnocks(): Promise<Knock[]> {
    const knocks = await this.getKnocks();
    return knocks.filter(k => k.syncStatus !== 'synced');
  }

  static async markKnocksSynced(ids: string[]): Promise<void> {
    const knocks = await this.getKnocks();
    knocks.forEach(knock => {
      if (ids.includes(knock.id)) {
        knock.syncStatus = 'synced';
      }
    });
    await AsyncStorage.setItem(KEYS.KNOCKS, JSON.stringify(knocks));
  }

  // PRESERVATION: All daily stats functionality
  static async updateDailyStats(knock: Knock): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `${KEYS.DAILY_STATS}${today}`;
    
    const existingStats = await AsyncStorage.getItem(key);
    let stats: DailyStats = existingStats ? JSON.parse(existingStats) : {
      date: today,
      knocks: 0,
      contacts: 0,
      leads: 0,
      sales: 0,
      revenue: 0,
    };
    
    stats.knocks++;
    
    if (['convo', 'lead', 'sale', 'callback', 'inspected'].includes(knock.outcome)) {
      stats.contacts++;
    }
    
    if (knock.outcome === 'lead') {
      stats.leads++;
    }
    
    if (knock.outcome === 'sale') {
      stats.sales++;
      // TODO: Add revenue tracking
    }
    
    await AsyncStorage.setItem(key, JSON.stringify(stats));
  }

  static async getDailyStats(days: number = 7): Promise<DailyStats[]> {
    const stats: DailyStats[] = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const key = `${KEYS.DAILY_STATS}${dateStr}`;
      
      const data = await AsyncStorage.getItem(key);
      if (data) {
        stats.push(JSON.parse(data));
      } else {
        stats.push({
          date: date,
          knocks: 0,
          contacts: 0,
          leads: 0,
          sales: 0,
          revenue: 0,
        });
      }
    }
    
    return stats.reverse();
  }

  // PRESERVATION: All settings functionality
  static async getSettings(): Promise<Settings> {
    try {
      const settingsJson = await AsyncStorage.getItem(KEYS.SETTINGS);
      if (!settingsJson) {
        return {
          userName: '',
          teamName: '',
          notifications: true,
          gpsTracking: true,
          autoSync: true,
          mapType: 'standard',
        };
      }
      return JSON.parse(settingsJson);
    } catch (error) {
      console.error('Error loading settings:', error);
      return {
        userName: '',
        teamName: '',
        notifications: true,
        gpsTracking: true,
        autoSync: true,
        mapType: 'standard',
      };
    }
  }

  static async saveSettings(settings: Settings): Promise<void> {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  static async clearAllData(): Promise<void> {
    await AsyncStorage.multiRemove([
      KEYS.KNOCKS,
      KEYS.SETTINGS,
      ...Array.from({ length: 30 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - i);
        return `${KEYS.DAILY_STATS}${date.toISOString().split('T')[0]}`;
      }),
    ]);
  }

  // PRESERVATION: Knock clearing functionality
  static async clearKnock(knockId: string): Promise<void> {
    const clearedIds = await this.getClearedKnockIds();
    if (!clearedIds.includes(knockId)) {
      clearedIds.push(knockId);
      await AsyncStorage.setItem(KEYS.CLEARED_KNOCKS, JSON.stringify(clearedIds));
    }
  }

  static async getClearedKnockIds(): Promise<string[]> {
    try {
      const clearedJson = await AsyncStorage.getItem(KEYS.CLEARED_KNOCKS);
      return clearedJson ? JSON.parse(clearedJson) : [];
    } catch (error) {
      console.error('Error loading cleared knocks:', error);
      return [];
    }
  }

  static async getVisibleKnocks(): Promise<Knock[]> {
    const allKnocks = await this.getKnocks();
    const clearedIds = await this.getClearedKnockIds();
    return allKnocks.filter(knock => !clearedIds.includes(knock.id));
  }

  // PHASE 2: Progressive loading methods
  static async getRecentKnocks(limit: number, includeCleared: boolean = false): Promise<Knock[]> {
    const knocks = includeCleared ? await this.getKnocks() : await this.getVisibleKnocks();
    
    // Sort by timestamp descending (newest first)
    const sorted = knocks.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return sorted.slice(0, limit);
  }

  static async getKnocksByDateRange(startDate: Date, endDate: Date, includeCleared: boolean = false): Promise<Knock[]> {
    const knocks = includeCleared ? await this.getKnocks() : await this.getVisibleKnocks();
    
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    
    return knocks.filter(knock => {
      const knockTime = new Date(knock.timestamp).getTime();
      return knockTime >= startTime && knockTime <= endTime;
    });
  }

  static async getKnocksNearLocation(lat: number, lng: number, radiusInDegrees: number = 0.01, includeCleared: boolean = false): Promise<Knock[]> {
    const knocks = includeCleared ? await this.getKnocks() : await this.getVisibleKnocks();
    
    return knocks.filter(knock => {
      const latDiff = Math.abs(knock.latitude - lat);
      const lngDiff = Math.abs(knock.longitude - lng);
      return latDiff <= radiusInDegrees && lngDiff <= radiusInDegrees;
    });
  }

  // PRESERVATION: Sync timing functionality
  static async getLastSyncTime(): Promise<Date | null> {
    try {
      const timeStr = await AsyncStorage.getItem(KEYS.LAST_SYNC);
      return timeStr ? new Date(timeStr) : null;
    } catch (error) {
      console.error('Error loading last sync time:', error);
      return null;
    }
  }

  static async setLastSyncTime(time: Date): Promise<void> {
    await AsyncStorage.setItem(KEYS.LAST_SYNC, time.toISOString());
  }

  // Helper method to debug location matching issues
  static async findNearbyKnocks(latitude: number, longitude: number, radiusDegrees?: number): Promise<Knock[]> {
    const knocks = await this.getKnocks();
    const radius = radiusDegrees || this.LOCATION_MATCH_PRECISION;
    
    return knocks.filter(k => 
      Math.abs(k.latitude - latitude) < radius && 
      Math.abs(k.longitude - longitude) < radius
    );
  }

  // PRESERVATION: Contact form methods (required by KnockScreen)
  static async saveContactForm(form: any): Promise<void> {
    const forms = await this.getContactForms();
    forms.push(form);
    await AsyncStorage.setItem('@contact_forms', JSON.stringify(forms));
  }

  static async getContactForms(): Promise<any[]> {
    try {
      const data = await AsyncStorage.getItem('@contact_forms');
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting contact forms:', error);
      return [];
    }
  }

  static async getContactFormByAddress(address: string): Promise<any | null> {
    const forms = await this.getContactForms();
    const knocks = await this.getKnocks();
    
    // Find the most recent form for this address
    const addressKnocks = knocks.filter(k => k.address === address);
    const knockIds = addressKnocks.map(k => k.id);
    
    const addressForms = forms.filter((f: any) => knockIds.includes(f.knockId));
    
    if (addressForms.length === 0) {
      return null;
    }
    
    // Return the most recent form
    return addressForms.sort((a: any, b: any) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  // PRESERVATION: Daily stats save method (typo in original, should be updateDailyStats)
  static async saveDailyStats(stats: any): Promise<void> {
    // This appears to be unused - the correct method is updateDailyStats
    // Keeping for compatibility
    const key = `${KEYS.DAILY_STATS}${stats.date}`;
    await AsyncStorage.setItem(key, JSON.stringify(stats));
  }
}
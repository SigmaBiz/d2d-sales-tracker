import AsyncStorage from '@react-native-async-storage/async-storage';
import { Knock, Territory, DailyStats } from '../types';

const KEYS = {
  KNOCKS: '@knocks',
  TERRITORIES: '@territories',
  DAILY_STATS: '@daily_stats',
  USER: '@user',
  SETTINGS: '@settings',
};

export class StorageService {
  // Knocks
  static async saveKnock(knock: Knock): Promise<void> {
    const knocks = await this.getKnocks();
    knocks.push(knock);
    await AsyncStorage.setItem(KEYS.KNOCKS, JSON.stringify(knocks));
  }

  static async getKnocks(): Promise<Knock[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.KNOCKS);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting knocks:', error);
      return [];
    }
  }

  static async getUnsyncedKnocks(): Promise<Knock[]> {
    const knocks = await this.getKnocks();
    return knocks.filter(k => k.syncStatus === 'pending');
  }

  static async markKnocksSynced(knockIds: string[]): Promise<void> {
    const knocks = await this.getKnocks();
    const updatedKnocks = knocks.map(knock => 
      knockIds.includes(knock.id) 
        ? { ...knock, syncStatus: 'synced' as const }
        : knock
    );
    await AsyncStorage.setItem(KEYS.KNOCKS, JSON.stringify(updatedKnocks));
  }

  // Territories
  static async saveTerritories(territories: Territory[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.TERRITORIES, JSON.stringify(territories));
  }

  static async getTerritories(): Promise<Territory[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.TERRITORIES);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting territories:', error);
      return [];
    }
  }

  // Daily Stats
  static async saveDailyStats(stats: DailyStats): Promise<void> {
    const allStats = await this.getDailyStats();
    const index = allStats.findIndex(s => 
      new Date(s.date).toDateString() === new Date(stats.date).toDateString()
    );
    
    if (index >= 0) {
      allStats[index] = stats;
    } else {
      allStats.push(stats);
    }
    
    await AsyncStorage.setItem(KEYS.DAILY_STATS, JSON.stringify(allStats));
  }

  static async getDailyStats(): Promise<DailyStats[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.DAILY_STATS);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting daily stats:', error);
      return [];
    }
  }

  // Settings
  static async saveSettings(settings: any): Promise<void> {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  static async getSettings(): Promise<any> {
    try {
      const data = await AsyncStorage.getItem(KEYS.SETTINGS);
      return data ? JSON.parse(data) : {};
    } catch (error) {
      console.error('Error getting settings:', error);
      return {};
    }
  }

  // Clear all data
  static async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  }
}
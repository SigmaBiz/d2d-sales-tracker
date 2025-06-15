import AsyncStorage from '@react-native-async-storage/async-storage';
import { Knock, Territory, DailyStats, ContactForm, ContactFormData } from '../types';

const KEYS = {
  KNOCKS: '@knocks',
  TERRITORIES: '@territories',
  DAILY_STATS: '@daily_stats',
  USER: '@user',
  SETTINGS: '@settings',
  CONTACT_FORMS: '@contact_forms',
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

  // Contact Forms
  static async saveContactForm(knockId: string, formData: ContactFormData): Promise<void> {
    const forms = await this.getContactForms();
    const form: ContactForm = {
      id: Date.now().toString(),
      knockId,
      formData,
      createdAt: new Date(),
    };
    forms.push(form);
    await AsyncStorage.setItem(KEYS.CONTACT_FORMS, JSON.stringify(forms));
  }

  static async getContactForms(): Promise<ContactForm[]> {
    try {
      const data = await AsyncStorage.getItem(KEYS.CONTACT_FORMS);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error getting contact forms:', error);
      return [];
    }
  }

  static async getContactFormByAddress(address: string): Promise<ContactForm | null> {
    const forms = await this.getContactForms();
    const knocks = await this.getKnocks();
    
    // Find the most recent form for this address
    const addressKnocks = knocks.filter(k => k.address === address);
    const knockIds = addressKnocks.map(k => k.id);
    
    const addressForms = forms.filter(f => knockIds.includes(f.knockId));
    
    if (addressForms.length === 0) {
      return null;
    }
    
    // Return the most recent form
    return addressForms.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
  }

  static async getContactFormsByKnockIds(knockIds: string[]): Promise<ContactForm[]> {
    const forms = await this.getContactForms();
    return forms.filter(f => knockIds.includes(f.knockId));
  }

  // Clear all data
  static async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  }
}
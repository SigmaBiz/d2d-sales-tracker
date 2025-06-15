/**
 * Hail Alert Service
 * Manages push notifications and alert logic for hail events
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { MRMSService, HailReport, StormEvent } from './mrmsService';
import { StorageService } from './storageService';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface AlertConfig {
  minHailSize: number; // inches
  quietHoursStart?: number; // 24hr format (e.g., 22 for 10pm)
  quietHoursEnd?: number; // 24hr format (e.g., 6 for 6am)
  alertZones: string[]; // cities to monitor
  teamBroadcast: boolean;
}

export class HailAlertService {
  private static checkInterval: NodeJS.Timeout | null = null;
  private static lastCheckTime: Date | null = null;
  private static activeStormId: string | null = null;
  
  /**
   * Initialize alert service and request permissions
   */
  static async initialize(): Promise<void> {
    // Request notification permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      throw new Error('Notification permissions not granted');
    }
    
    // Register for push notifications
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('hail-alerts', {
        name: 'Hail Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
  }
  
  /**
   * Start monitoring for hail
   */
  static async startMonitoring(intervalMinutes: number = 5): Promise<void> {
    // Clear any existing interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    // Initial check
    await this.checkForHail();
    
    // Set up recurring checks
    this.checkInterval = setInterval(async () => {
      await this.checkForHail();
    }, intervalMinutes * 60 * 1000);
  }
  
  /**
   * Stop monitoring
   */
  static stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  /**
   * Check for new hail reports
   */
  private static async checkForHail(): Promise<void> {
    try {
      // Get user's alert preferences
      const settings = await StorageService.getSettings();
      const alertConfig: AlertConfig = {
        minHailSize: settings.minHailSize || 0, // Default: any size
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        alertZones: settings.alertZones || ['all'], // Default: all Oklahoma
        teamBroadcast: settings.teamBroadcast !== false, // Default: true
      };
      
      // Check if in quiet hours
      if (this.isInQuietHours(alertConfig)) {
        return;
      }
      
      // Fetch current hail data
      const reports = await MRMSService.fetchCurrentHailData();
      
      // Filter reports based on preferences
      const relevantReports = reports.filter(report => {
        // Check minimum size
        if (report.size < alertConfig.minHailSize) return false;
        
        // Check zones
        if (!alertConfig.alertZones.includes('all')) {
          if (!report.city || !alertConfig.alertZones.includes(report.city)) {
            return false;
          }
        }
        
        return true;
      });
      
      // Process each relevant report
      for (const report of relevantReports) {
        await this.processHailReport(report, alertConfig);
      }
      
      this.lastCheckTime = new Date();
    } catch (error) {
      console.error('Error checking for hail:', error);
    }
  }
  
  /**
   * Process individual hail report and send alerts if needed
   */
  private static async processHailReport(
    report: HailReport, 
    config: AlertConfig
  ): Promise<void> {
    // Determine alert type and message
    let alertType: 'initial' | 'escalation' | 'expansion' = 'initial';
    let message = '';
    
    // Get or create active storm
    const storms = await MRMSService.getActiveStorms();
    let activeStorm = storms.find(s => 
      s.id === this.activeStormId && 
      !s.endTime
    );
    
    if (activeStorm) {
      // Check if this is an escalation or expansion
      const existingReportsInArea = activeStorm.reports.filter(r => 
        Math.abs(r.latitude - report.latitude) < 0.1 &&
        Math.abs(r.longitude - report.longitude) < 0.1
      );
      
      if (existingReportsInArea.length > 0) {
        const maxExistingSize = Math.max(...existingReportsInArea.map(r => r.size));
        if (report.size > maxExistingSize) {
          alertType = 'escalation';
          message = `⚠️ Hail increasing to ${report.size.toFixed(1)}" in ${report.city || 'Oklahoma'}`;
        } else {
          // Don't alert for same or smaller size in same area
          return;
        }
      } else {
        alertType = 'expansion';
        message = `⚠️ Hail spreading to ${report.city || 'new area'} - ${report.size.toFixed(1)}"`;
      }
      
      // Add report to existing storm
      activeStorm.reports.push(report);
      activeStorm.peakSize = Math.max(activeStorm.peakSize, report.size);
      await MRMSService.saveStormEvent(activeStorm);
    } else {
      // Create new storm event
      alertType = 'initial';
      const sizeEmoji = report.size >= 2 ? '🚨' : '⚠️';
      message = `${sizeEmoji} Hail detected in ${report.city || 'Oklahoma'} - ${report.size.toFixed(1)}" hail`;
      
      const newStorm = await MRMSService.groupIntoStormEvents([report]);
      await MRMSService.saveStormEvent(newStorm);
      this.activeStormId = newStorm.id;
      
      // Auto-disable other storms for new alert
      await MRMSService.focusOnStorm(newStorm.id);
    }
    
    // Send notification
    await this.sendHailAlert(message, report, alertType);
    
    // Log alert
    await MRMSService.logAlert({
      timestamp: new Date(),
      message,
      hailSize: report.size,
      location: report.city || 'Unknown',
      dismissed: false
    });
  }
  
  /**
   * Send push notification for hail alert
   */
  private static async sendHailAlert(
    message: string, 
    report: HailReport,
    type: 'initial' | 'escalation' | 'expansion'
  ): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: message,
        body: 'Tap to view hail map and start canvassing',
        data: {
          type: 'hail_alert',
          alertType: type,
          reportId: report.id,
          stormId: this.activeStormId,
          latitude: report.latitude,
          longitude: report.longitude,
          hailSize: report.size,
        },
        categoryIdentifier: 'hail_alert',
      },
      trigger: null, // Send immediately
    });
  }
  
  /**
   * Check if currently in quiet hours
   */
  private static isInQuietHours(config: AlertConfig): boolean {
    if (!config.quietHoursStart || !config.quietHoursEnd) {
      return false;
    }
    
    const now = new Date();
    const currentHour = now.getHours();
    
    // Handle overnight quiet hours (e.g., 22 to 6)
    if (config.quietHoursStart > config.quietHoursEnd) {
      return currentHour >= config.quietHoursStart || currentHour < config.quietHoursEnd;
    } else {
      return currentHour >= config.quietHoursStart && currentHour < config.quietHoursEnd;
    }
  }
  
  /**
   * Handle notification response (when user taps notification)
   */
  static async handleNotificationResponse(
    response: Notifications.NotificationResponse
  ): Promise<any> {
    const data = response.notification.request.content.data;
    
    if (data.type === 'hail_alert') {
      return {
        action: 'OPEN_MAP',
        stormId: data.stormId,
        location: {
          latitude: data.latitude,
          longitude: data.longitude,
        },
        autoDisableOthers: true,
      };
    }
    
    return null;
  }
  
  /**
   * Get alert configuration for current user
   */
  static async getAlertConfig(): Promise<AlertConfig> {
    const settings = await StorageService.getSettings();
    return {
      minHailSize: settings.minHailSize || 0,
      quietHoursStart: settings.quietHoursStart,
      quietHoursEnd: settings.quietHoursEnd,
      alertZones: settings.alertZones || ['all'],
      teamBroadcast: settings.teamBroadcast !== false,
    };
  }
  
  /**
   * Update alert configuration
   */
  static async updateAlertConfig(config: Partial<AlertConfig>): Promise<void> {
    const settings = await StorageService.getSettings();
    await StorageService.saveSettings({
      ...settings,
      ...config,
    });
  }
}
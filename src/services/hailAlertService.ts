/**
 * Hail Alert Service
 * Manages push notifications and alert logic for hail events
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MRMSService, HailReport, StormEvent } from './mrmsService';
import { StorageService } from './storageService';
import { ConfidenceScoring } from './confidenceScoring';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface AlertConfig {
  minHailSize: number; // inches
  quietHoursStart?: number; // 24hr format (e.g., 22 for 10pm)
  quietHoursEnd?: number; // 24hr format (e.g., 6 for 6am)
  alertZones: string[]; // cities to monitor
  teamBroadcast: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  phone?: string;
  pushToken?: string;
  active: boolean;
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
   * Manually trigger a hail check (for testing)
   */
  static async checkNow(): Promise<void> {
    console.log('[HailAlert] Manual check triggered');
    await this.checkForHail();
  }
  
  /**
   * Check for new hail reports
   */
  private static async checkForHail(): Promise<void> {
    try {
      // Get user's alert preferences
      const settings = await StorageService.getSettings();
      const alertConfig: AlertConfig = {
        minHailSize: settings.minHailSize || 1.0, // Default: 1 inch
        quietHoursStart: settings.quietHoursStart,
        quietHoursEnd: settings.quietHoursEnd,
        alertZones: settings.alertZones || ['all'], // Default: all Oklahoma
        teamBroadcast: settings.teamBroadcast !== false, // Default: true
      };
      
      // Check if in quiet hours
      if (this.isInQuietHours(alertConfig)) {
        return;
      }
      
      // Try real-time server first
      let reports: HailReport[] = [];
      try {
        const serverUrl = __DEV__ 
          ? 'http://localhost:3003/api/storms/current'
          : 'https://your-production-server.com/api/storms/current';
        
        const response = await fetch(serverUrl);
        if (response.ok) {
          const data = await response.json();
          if (data.storms && data.storms.length > 0) {
            console.log(`[HailAlert] Found ${data.storms.length} storms from real-time server`);
            reports = data.storms;
          }
        }
      } catch (error) {
        console.log('[HailAlert] Real-time server unavailable, falling back');
      }
      
      // Fallback to MRMSService if no real-time data
      if (reports.length === 0) {
        reports = await MRMSService.fetchCurrentHailData();
      }
      
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
      activeStorm.maxSize = Math.max(activeStorm.maxSize, report.size);
      await MRMSService.saveStormEvent(activeStorm);
    } else {
      // Create new storm event
      alertType = 'initial';
      
      // Choose emoji based on both size and confidence
      let sizeEmoji = '⚠️';
      if (report.confidence >= 85 && report.size >= 1.5) {
        sizeEmoji = '🚨'; // High confidence + large hail
      } else if (report.size >= 2) {
        sizeEmoji = '🚨'; // Very large hail
      } else if (report.confidence >= 70) {
        sizeEmoji = '⚠️'; // High confidence
      }
      
      message = `${sizeEmoji} Hail detected in ${report.city || 'Oklahoma'} - ${report.size.toFixed(1)}" hail`;
      
      const newStorm = await MRMSService.groupIntoStormEvents([report]);
      await MRMSService.saveStormEvent(newStorm);
      this.activeStormId = newStorm.id;
      
      // Auto-disable other storms for new alert
      await MRMSService.focusOnStorm(newStorm.id);
    }
    
    // Send notification
    await this.sendHailAlert(message, report, alertType);
    
    // Log alert to console for now (TODO: implement logAlert in MRMSService)
    console.log('[HailAlert] Alert triggered:', {
      timestamp: new Date(),
      message,
      hailSize: report.size,
      location: report.city || 'Unknown'
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
    // Get confidence level for enhanced messaging
    const confidenceLevel = ConfidenceScoring.getConfidenceLevel(report.confidence);
    
    // Enhance message with confidence info
    const enhancedMessage = `${message} (${report.confidence}% confidence)`;
    
    // Set priority based on confidence
    let priority = Notifications.AndroidNotificationPriority.HIGH;
    if (report.confidence >= 85) {
      priority = Notifications.AndroidNotificationPriority.MAX;
    } else if (report.confidence < 50) {
      priority = Notifications.AndroidNotificationPriority.DEFAULT;
    }
    
    // Create body with recommendation
    let body = 'Tap to view hail map and start canvassing';
    if (report.confidence >= 70) {
      body = `${confidenceLevel.recommendation}. Tap to view map.`;
    }
    
    await Notifications.scheduleNotificationAsync({
      content: {
        title: enhancedMessage,
        body: body,
        data: {
          type: 'hail_alert',
          alertType: type,
          reportId: report.id,
          stormId: this.activeStormId,
          latitude: report.latitude,
          longitude: report.longitude,
          hailSize: report.size,
          confidence: report.confidence,
          confidenceFactors: report.confidenceFactors,
        },
        categoryIdentifier: 'hail_alert',
        priority: priority,
      },
      trigger: null, // Send immediately
    });
    
    // Handle team broadcast if enabled
    const settings = await StorageService.getSettings();
    if (settings.teamBroadcast) {
      await this.broadcastToTeam(message, report, type);
    }
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
  
  /**
   * Broadcast alert to all team members
   */
  private static async broadcastToTeam(
    message: string,
    report: HailReport,
    type: 'initial' | 'escalation' | 'expansion'
  ): Promise<void> {
    try {
      // Get team members from storage
      const teamData = await AsyncStorage.getItem('@team_members');
      if (!teamData) return;
      
      const teamMembers: TeamMember[] = JSON.parse(teamData);
      const activeMembers = teamMembers.filter(m => m.active && m.pushToken);
      
      console.log(`[HailAlert] Broadcasting to ${activeMembers.length} team members`);
      
      // Send notifications to all active team members
      const notifications = activeMembers.map(member => ({
        to: member.pushToken,
        title: `Team Alert: ${message}`,
        body: `${member.name}, a storm has been detected. Check the app for details.`,
        data: {
          type: 'team_broadcast',
          alertType: type,
          reportId: report.id,
          latitude: report.latitude,
          longitude: report.longitude,
          memberName: member.name
        },
        priority: 'high',
      }));
      
      // Send all notifications (in production, use Expo's push notification service)
      // For now, just log them
      console.log('[HailAlert] Team broadcast notifications prepared:', notifications.length);
      
      // TODO: Implement actual push notification sending via Expo Push Service
      // await Notifications.sendPushNotificationsAsync(notifications);
      
    } catch (error) {
      console.error('[HailAlert] Error broadcasting to team:', error);
    }
  }
  
  /**
   * Add team member for broadcasts
   */
  static async addTeamMember(member: Omit<TeamMember, 'id'>): Promise<void> {
    try {
      const teamData = await AsyncStorage.getItem('@team_members');
      const team: TeamMember[] = teamData ? JSON.parse(teamData) : [];
      
      const newMember: TeamMember = {
        ...member,
        id: `member_${Date.now()}`
      };
      
      team.push(newMember);
      await AsyncStorage.setItem('@team_members', JSON.stringify(team));
      
      console.log(`[HailAlert] Team member added: ${newMember.name}`);
    } catch (error) {
      console.error('[HailAlert] Error adding team member:', error);
    }
  }
  
  /**
   * Get all team members
   */
  static async getTeamMembers(): Promise<TeamMember[]> {
    try {
      const teamData = await AsyncStorage.getItem('@team_members');
      return teamData ? JSON.parse(teamData) : [];
    } catch (error) {
      console.error('[HailAlert] Error getting team members:', error);
      return [];
    }
  }
  
  /**
   * Update team member status
   */
  static async updateTeamMember(memberId: string, updates: Partial<TeamMember>): Promise<void> {
    try {
      const teamData = await AsyncStorage.getItem('@team_members');
      const team: TeamMember[] = teamData ? JSON.parse(teamData) : [];
      
      const memberIndex = team.findIndex(m => m.id === memberId);
      if (memberIndex >= 0) {
        team[memberIndex] = { ...team[memberIndex], ...updates };
        await AsyncStorage.setItem('@team_members', JSON.stringify(team));
        console.log(`[HailAlert] Team member updated: ${memberId}`);
      }
    } catch (error) {
      console.error('[HailAlert] Error updating team member:', error);
    }
  }
}
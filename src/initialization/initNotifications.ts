/**
 * Notifications Initialization Module
 * Push notifications setup - can be deferred
 */

import * as Notifications from 'expo-notifications';
import { HailAlertService } from '../services/hailAlertService';

interface NotificationListeners {
  notificationListener: Notifications.Subscription | null;
  responseListener: Notifications.Subscription | null;
}

export function initNotifications(): NotificationListeners {
  console.log('[INIT] Starting notifications initialization...');
  
  const listeners: NotificationListeners = {
    notificationListener: null,
    responseListener: null
  };
  
  try {
    // Handle notifications when app is in foreground
    listeners.notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Handle notification taps
    listeners.responseListener = Notifications.addNotificationResponseReceivedListener(async response => {
      const result = await HailAlertService.handleNotificationResponse(response);
      
      if (result && result.action === 'OPEN_NOTIFICATION_LOG') {
        console.log('Hail alert tapped, will open notification log on map...');
        (global as any).openNotificationLog = true;
      }
    });
    
    console.log('[INIT] Notifications initialization complete');
  } catch (error) {
    console.error('[INIT] Notifications initialization failed:', error);
    // Don't throw - notifications are not critical
  }
  
  return listeners;
}

export function cleanupNotifications(listeners: NotificationListeners): void {
  console.log('[INIT] Cleaning up notifications...');
  
  if (listeners.notificationListener) {
    listeners.notificationListener.remove();
    listeners.notificationListener = null;
  }
  if (listeners.responseListener) {
    listeners.responseListener.remove();
    listeners.responseListener = null;
  }
}
import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';
import { HailAlertService } from './src/services/hailAlertService';
import { HailDataFlowService } from './src/services/hailDataFlowService';
import { SupabaseService } from './src/services/supabaseService';
import { IntegratedHailIntelligence } from './src/services/integratedHailIntelligence';
import { AutoSyncService } from './src/services/autoSyncService';
import { StorageService } from './src/services/storageService';

// TEMPORARY: Test utility for visual storm differentiation
// Moved to RealMapScreen for easier testing

export default function App() {
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Initialize services
    SupabaseService.initialize();
    
    // Initialize Auto-Sync Service
    AutoSyncService.initialize().then(() => {
      console.log('[App] Auto-sync service initialized');
    }).catch(error => {
      console.error('[App] Failed to initialize auto-sync:', error);
    });
    
    // Track knock saves for auto-sync
    const originalSaveKnock = StorageService.saveKnock;
    StorageService.saveKnock = async (knock) => {
      await originalSaveKnock.call(StorageService, knock);
      AutoSyncService.incrementPendingChanges();
    };
    
    // Initialize 3-Tier Hail Intelligence System
    IntegratedHailIntelligence.initialize({
      enableRealTime: true,
      enableHistorical: true,
      enableValidation: true,
      alertThreshold: 25  // 1 inch hail
    }).then(() => {
      console.log('[App] 3-Tier Hail Intelligence System initialized');
    }).catch(error => {
      console.error('[App] Failed to initialize Hail Intelligence:', error);
    });
    
    // Handle notifications when app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Handle notification taps
    responseListener.current = Notifications.addNotificationResponseReceivedListener(async response => {
      const result = await HailAlertService.handleNotificationResponse(response);
      
      if (result && result.action === 'OPEN_NOTIFICATION_LOG') {
        // Store the intent to open notification log
        console.log('Hail alert tapped, will open notification log on map...');
        // Store the navigation intent globally so map screen can check it
        (global as any).openNotificationLog = true;
      }
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

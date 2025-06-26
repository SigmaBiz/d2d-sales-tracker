import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';
import { HailAlertService } from './src/services/hailAlertService';
import { HailDataFlowService } from './src/services/hailDataFlowService';
import { SupabaseService } from './src/services/supabaseService';
import { IntegratedHailIntelligence } from './src/services/integratedHailIntelligence';
import { AutoSyncServiceOptimized } from './src/services/autoSyncServiceOptimized';
import { StorageService } from './src/services/storageServiceWrapper';

export default function AppOptimized() {
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  // OPTIMIZATION: Track if services are initialized to prevent double initialization
  const servicesInitialized = useRef(false);

  useEffect(() => {
    // OPTIMIZATION: Prevent double initialization in development
    if (servicesInitialized.current) {
      return;
    }
    servicesInitialized.current = true;

    // Initialize services
    SupabaseService.initialize();
    
    // Initialize Auto-Sync Service with optimized version
    AutoSyncServiceOptimized.initialize().then(() => {
      console.log('[App] Auto-sync service initialized');
    }).catch(error => {
      console.error('[App] Failed to initialize auto-sync:', error);
    });
    
    // OPTIMIZATION: Create a wrapped version of saveKnock once
    const originalSaveKnock = StorageService.saveKnock.bind(StorageService);
    StorageService.saveKnock = async (knock) => {
      await originalSaveKnock(knock);
      AutoSyncServiceOptimized.incrementPendingChanges();
    };
    
    // Initialize 3-Tier Hail Intelligence System (PRESERVED from CORE_ARCHITECTURE_SNAPSHOT.md)
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
        console.log('Hail alert tapped, will open notification log on map...');
        (global as any).openNotificationLog = true;
      }
    });

    // OPTIMIZATION: Comprehensive cleanup
    return () => {
      console.log('[App] Cleaning up services...');
      
      // Clean up notification listeners
      if (notificationListener.current) {
        notificationListener.current.remove();
        notificationListener.current = null;
      }
      if (responseListener.current) {
        responseListener.current.remove();
        responseListener.current = null;
      }
      
      // Clean up auto-sync service
      AutoSyncServiceOptimized.cleanup();
      
      // Stop hail monitoring
      HailAlertService.stopMonitoring();
      
      // Restore original saveKnock method
      StorageService.saveKnock = originalSaveKnock;
      
      // Mark services as not initialized for hot reload
      servicesInitialized.current = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
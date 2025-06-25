import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';
import { HailAlertService } from './src/services/hailAlertService';
import { HailDataFlowService } from './src/services/hailDataFlowService';
import { SupabaseService } from './src/services/supabaseService';
import { IntegratedHailIntelligence } from './src/services/integratedHailIntelligence';

// TEMPORARY: Test utility for visual storm differentiation
// Moved to RealMapScreen for easier testing

export default function App() {
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    // Initialize critical services immediately
    console.log('[App] Initializing critical services...');
    SupabaseService.initialize();
    
    // Defer heavy services to improve startup time
    const deferredInitTimeout = setTimeout(() => {
      console.log('[App] Starting deferred service initialization...');
      
      // Initialize 3-Tier Hail Intelligence System after UI loads
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
    }, 1500); // Defer by 1.5 seconds to let UI become responsive first
    
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
      // Clean up timeout
      clearTimeout(deferredInitTimeout);
      
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

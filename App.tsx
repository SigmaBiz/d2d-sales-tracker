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
    // ONLY initialize the absolute minimum needed for the app to function
    console.log('[App] Minimal startup - deferring all non-critical services...');
    
    // Defer ALL heavy services until user actually needs them
    const deferredInitTimeout = setTimeout(() => {
      console.log('[App] Starting background service initialization...');
      
      // Initialize Supabase in background
      SupabaseService.initialize();
      
      // Defer hail intelligence even further - it's not needed for basic door knocking
      setTimeout(() => {
        console.log('[App] Starting hail intelligence initialization...');
        IntegratedHailIntelligence.initialize({
          enableRealTime: false,  // Disable real-time initially
          enableHistorical: false, // Disable historical initially
          enableValidation: false, // Disable validation initially
          alertThreshold: 25
        }).then(() => {
          console.log('[App] Hail Intelligence ready (background)');
        }).catch(error => {
          console.error('[App] Hail Intelligence error (non-critical):', error);
        });
      }, 10000); // 10 seconds - way after UI is responsive
    }, 3000); // 3 seconds - let the map load first
    
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

import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import AppNavigator from './src/navigation/AppNavigator';
import { HailAlertService } from './src/services/hailAlertService';
import { HailDataFlowService } from './src/services/hailDataFlowService';
import { SupabaseService } from './src/services/supabaseService';
import { IntegratedHailIntelligence } from './src/services/integratedHailIntelligence';

export default function App() {
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  useEffect(() => {
    // Initialize services
    SupabaseService.initialize();
    
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
      
      if (result && result.action === 'OPEN_MAP') {
        // Map navigation will be handled by the AppNavigator
        console.log('Hail alert tapped, opening map...');
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
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

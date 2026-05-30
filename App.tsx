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
    // Initialize services
    SupabaseService.initialize();

    // Register push token so server-side alerts can reach this device
    HailAlertService.initialize().catch(err =>
      console.warn('[App] Push notification init failed (non-fatal):', err)
    );

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
      const data = response.notification.request.content.data as any;

      // Swath ready — store date so map screen can auto-select it
      if (data?.type === 'swath_ready' && data?.date) {
        console.log('[App] Swath ready tapped for date:', data.date);
        (global as any).pendingSwathDate = data.date;
        return;
      }

      // Live inspection — center map on canvasser's location
      if (data?.type === 'live_inspection' && data?.lat != null && data?.lng != null) {
        console.log('[App] Live inspection tapped:', data.address);
        (global as any).pendingLiveInspectionLocation = { lat: data.lat, lng: data.lng, address: data.address };
        return;
      }

      // Lead lifecycle update — teleport to that door on the map
      if (data?.type === 'lead_update' && data?.lat != null && data?.lng != null) {
        console.log('[App] Lead update tapped:', data.knockId, data.status);
        (global as any).pendingLeadLocation = { lat: data.lat, lng: data.lng, knockId: data.knockId };
        return;
      }

      // Scheduled-inspection reminder — teleport to the lead so the runner can confirm/act
      if (data?.type === 'lead_reminder' && data?.lat != null && data?.lng != null) {
        console.log('[App] Lead reminder tapped:', data.knockId, data.kind);
        (global as any).pendingLeadLocation = { lat: data.lat, lng: data.lng, knockId: data.knockId };
        return;
      }

      const result = await HailAlertService.handleNotificationResponse(response);

      if (result && result.action === 'OPEN_NOTIFICATION_LOG') {
        console.log('Hail alert tapped, will open notification log on map...');
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

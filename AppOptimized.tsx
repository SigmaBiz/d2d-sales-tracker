import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { initializeApp, cleanupApp } from './src/initialization';
import { OPTIMIZATIONS } from './src/config/optimization';

export default function AppOptimized() {
  // OPTIMIZATION: Track if services are initialized to prevent double initialization
  const servicesInitialized = useRef(false);

  useEffect(() => {
    // OPTIMIZATION: Prevent double initialization in development
    if (servicesInitialized.current) {
      return;
    }
    servicesInitialized.current = true;

    // Initialize app with modular approach
    initializeApp({
      deferNonCritical: OPTIMIZATIONS.USE_DEFERRED_INIT ?? true
    }).then(() => {
      console.log('[App] App initialization complete');
    }).catch(error => {
      console.error('[App] App initialization failed:', error);
    });

    // OPTIMIZATION: Comprehensive cleanup
    return () => {
      console.log('[App] Cleaning up app...');
      cleanupApp();
      
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
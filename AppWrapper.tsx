import React from 'react';
import { USE_OPTIMIZED_COMPONENTS } from './src/config/optimization';
import App from './App';
import AppOptimized from './AppOptimized';

/**
 * App wrapper to switch between original and optimized implementations
 */
export default function AppWrapper() {
  if (USE_OPTIMIZED_COMPONENTS) {
    console.log('[Performance] Using OPTIMIZED App');
    return <AppOptimized />;
  } else {
    console.log('[Performance] Using ORIGINAL App');
    return <App />;
  }
}
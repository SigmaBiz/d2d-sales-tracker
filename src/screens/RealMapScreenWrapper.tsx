import React from 'react';
import { USE_OPTIMIZED_COMPONENTS } from '../config/optimization';
import RealMapScreen from './RealMapScreen';
import RealMapScreenOptimized from './RealMapScreenOptimized';

/**
 * Wrapper component to switch between original and optimized implementations
 * This allows easy A/B testing without changing navigation code
 */
export default function RealMapScreenWrapper(props: any) {
  if (USE_OPTIMIZED_COMPONENTS) {
    console.log('[Performance] Using OPTIMIZED RealMapScreen');
    return <RealMapScreenOptimized {...props} />;
  } else {
    console.log('[Performance] Using ORIGINAL RealMapScreen');
    return <RealMapScreen {...props} />;
  }
}
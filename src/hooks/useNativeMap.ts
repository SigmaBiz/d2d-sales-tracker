import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { nativeMapManager } from '../services/nativeMap';

export const useNativeMap = () => {
  const [isNativeMapAvailable, setIsNativeMapAvailable] = useState(false);
  const [isNativeMapEnabled, setIsNativeMapEnabled] = useState(true); // Default to true

  useEffect(() => {
    checkNativeMapAvailability();
  }, []);

  const checkNativeMapAvailability = () => {
    if (Platform.OS !== 'ios') {
      setIsNativeMapAvailable(false);
      return;
    }

    const available = nativeMapManager.isNativeMapAvailable();
    setIsNativeMapAvailable(available);
    
    if (available) {
      console.log('Native map module is available');
    }
  };

  const toggleNativeMap = (enabled: boolean) => {
    setIsNativeMapEnabled(enabled);
  };

  return {
    isNativeMapAvailable,
    isNativeMapEnabled,
    toggleNativeMap,
    shouldUseNativeMap: isNativeMapAvailable && isNativeMapEnabled,
  };
};
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { NativeMapView, nativeMapManager, Region, Territory, MapConfig } from '../services/nativeMap';
import { Knock } from '../types';

interface NativeMapComponentProps {
  style?: ViewStyle;
  initialRegion?: Region;
  knocks?: Knock[];
  territories?: Territory[];
  showsUserLocation?: boolean;
  followsUserLocation?: boolean;
  onKnockPress?: (knock: Knock) => void;
  onMapPress?: (coordinate: { latitude: number; longitude: number }) => void;
  onRegionChangeComplete?: (region: Region) => void;
  onMapReady?: () => void;
}

export interface NativeMapRef {
  fitToKnocks: (animated?: boolean) => Promise<void>;
  setCamera: (region: Region, animated?: boolean) => Promise<void>;
  takeSnapshot: () => Promise<{ base64: string; width: number; height: number }>;
  highlightTerritory: (territoryId: string, highlight: boolean) => Promise<void>;
}

const NativeMapComponent = forwardRef<NativeMapRef, NativeMapComponentProps>((props, ref) => {
  const {
    style,
    initialRegion,
    knocks = [],
    territories = [],
    showsUserLocation = false,
    followsUserLocation = false,
    onKnockPress,
    onMapPress,
    onRegionChangeComplete,
    onMapReady,
  } = props;

  const mapViewRef = useRef<any>(null);
  const isMapReady = useRef(false);

  // Initialize map
  useEffect(() => {
    if (!mapViewRef.current || !NativeMapView) return;

    const initMap = async () => {
      try {
        const config: MapConfig = {
          initialRegion,
          showsUserLocation,
          followsUserLocation,
          showsCompass: true,
          showsScale: true,
        };

        await nativeMapManager.createMap(mapViewRef.current, config);
        isMapReady.current = true;

        // Set up event listeners
        nativeMapManager.addEventListener('onKnockPress', (data) => {
          onKnockPress?.(data.knock);
        });

        nativeMapManager.addEventListener('onMapPress', (data) => {
          onMapPress?.(data.coordinate);
        });

        nativeMapManager.addEventListener('onRegionChangeComplete', (data) => {
          onRegionChangeComplete?.(data.region);
        });

        // Initial data
        if (knocks.length > 0) {
          await nativeMapManager.addKnocks(knocks);
        }
        if (territories.length > 0) {
          await nativeMapManager.setTerritories(territories);
        }

        onMapReady?.();
      } catch (error) {
        console.error('Failed to initialize native map:', error);
      }
    };

    initMap();

    return () => {
      nativeMapManager.destroyMap();
      isMapReady.current = false;
    };
  }, []);

  // Update knocks
  useEffect(() => {
    if (!isMapReady.current) return;

    const updateKnocks = async () => {
      try {
        // For now, we'll clear and re-add all knocks
        // In a production app, you'd want to diff and update only changes
        await nativeMapManager.addKnocks(knocks);
      } catch (error) {
        console.error('Failed to update knocks:', error);
      }
    };

    updateKnocks();
  }, [knocks]);

  // Update territories
  useEffect(() => {
    if (!isMapReady.current) return;

    const updateTerritories = async () => {
      try {
        await nativeMapManager.setTerritories(territories);
      } catch (error) {
        console.error('Failed to update territories:', error);
      }
    };

    updateTerritories();
  }, [territories]);

  // Update location settings
  useEffect(() => {
    if (!isMapReady.current) return;
    nativeMapManager.setShowsUserLocation(showsUserLocation);
  }, [showsUserLocation]);

  useEffect(() => {
    if (!isMapReady.current) return;
    nativeMapManager.setFollowsUserLocation(followsUserLocation);
  }, [followsUserLocation]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    fitToKnocks: async (animated = true) => {
      if (!isMapReady.current) return;
      await nativeMapManager.fitToKnocks(undefined, animated);
    },
    setCamera: async (region: Region, animated = true) => {
      if (!isMapReady.current) return;
      await nativeMapManager.setCamera(region, animated);
    },
    takeSnapshot: async () => {
      if (!isMapReady.current) throw new Error('Map not ready');
      return await nativeMapManager.takeSnapshot();
    },
    highlightTerritory: async (territoryId: string, highlight: boolean) => {
      if (!isMapReady.current) return;
      await nativeMapManager.highlightTerritory(territoryId, highlight);
    },
  }));

  // Handle native events
  const handleMapReady = useCallback(() => {
    console.log('Native map ready');
  }, []);

  const handleKnockPress = useCallback((event: any) => {
    // Event is already processed by native module listener
  }, []);

  const handleMapPress = useCallback((event: any) => {
    // Event is already processed by native module listener
  }, []);

  const handleRegionChange = useCallback((event: any) => {
    // Event is already processed by native module listener
  }, []);

  // Fallback for non-iOS platforms
  if (Platform.OS !== 'ios' || !NativeMapView) {
    return (
      <View style={[styles.container, style, styles.fallback]}>
        {/* You could render the WebView map here as fallback */}
      </View>
    );
  }

  return (
    <NativeMapView
      ref={mapViewRef}
      style={[styles.container, style]}
      onMapReady={handleMapReady}
      onKnockPress={handleKnockPress}
      onMapPress={handleMapPress}
      onRegionChange={handleRegionChange}
      onRegionChangeComplete={handleRegionChange}
    />
  );
});

NativeMapComponent.displayName = 'NativeMapComponent';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fallback: {
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default NativeMapComponent;
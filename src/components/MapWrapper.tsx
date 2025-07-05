import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import NativeMapComponent, { NativeMapRef } from './NativeMapComponent';
import { useNativeMap } from '../hooks/useNativeMap';
import { Knock } from '../types';

// Import react-native-maps with error handling
let MapView: any, Marker: any, PROVIDER_GOOGLE: any;
try {
  if (Platform.OS !== 'web') {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
  }
} catch (error) {
  console.log('Maps not available');
}

interface MapWrapperProps {
  style?: any;
  initialRegion?: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  knocks?: Knock[];
  showsUserLocation?: boolean;
  followsUserLocation?: boolean;
  onKnockPress?: (knock: Knock) => void;
  onMapPress?: (event: any) => void;
  onRegionChangeComplete?: (region: any) => void;
  onMapReady?: () => void;
  // React Native Maps specific props
  provider?: any;
  mapType?: 'standard' | 'satellite' | 'hybrid' | 'terrain';
  showsMyLocationButton?: boolean;
  children?: React.ReactNode;
}

export interface MapWrapperRef {
  fitToKnocks: (animated?: boolean) => void;
  animateToRegion: (region: any, duration?: number) => void;
}

const MapWrapper = forwardRef<MapWrapperRef, MapWrapperProps>((props, ref) => {
  const { shouldUseNativeMap } = useNativeMap();
  const nativeMapRef = useRef<NativeMapRef>(null);
  const reactMapRef = useRef<any>(null);

  const {
    style,
    initialRegion,
    knocks = [],
    showsUserLocation = false,
    followsUserLocation = false,
    onKnockPress,
    onMapPress,
    onRegionChangeComplete,
    onMapReady,
    provider = PROVIDER_GOOGLE,
    mapType = 'standard',
    showsMyLocationButton = true,
    children,
  } = props;

  // Expose unified methods
  useImperativeHandle(ref, () => ({
    fitToKnocks: (animated = true) => {
      if (shouldUseNativeMap && nativeMapRef.current) {
        nativeMapRef.current.fitToKnocks(animated);
      } else if (reactMapRef.current && knocks.length > 0) {
        const coordinates = knocks.map(k => ({
          latitude: k.latitude,
          longitude: k.longitude,
        }));
        reactMapRef.current.fitToCoordinates(coordinates, {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated,
        });
      }
    },
    animateToRegion: (region: any, duration = 1000) => {
      if (shouldUseNativeMap && nativeMapRef.current) {
        nativeMapRef.current.setCamera(region, true);
      } else if (reactMapRef.current) {
        reactMapRef.current.animateToRegion(region, duration);
      }
    },
  }));

  // Use native map on iOS when available
  if (shouldUseNativeMap && Platform.OS === 'ios') {
    return (
      <NativeMapComponent
        ref={nativeMapRef}
        style={style}
        initialRegion={initialRegion}
        knocks={knocks}
        showsUserLocation={showsUserLocation}
        followsUserLocation={followsUserLocation}
        onKnockPress={onKnockPress}
        onMapPress={(coordinate) => onMapPress?.({ nativeEvent: { coordinate } })}
        onRegionChangeComplete={onRegionChangeComplete}
        onMapReady={onMapReady}
      />
    );
  }

  // Fallback to react-native-maps
  if (!MapView) {
    return (
      <View style={[styles.container, style, styles.fallback]}>
        <Text>Map not available in Expo Go</Text>
      </View>
    );
  }

  const handleMarkerPress = (knock: Knock) => {
    onKnockPress?.(knock);
  };

  const OUTCOME_COLORS = {
    sold: 'green',
    not_home: 'orange',
    not_interested: 'red',
    callback: 'blue',
    other: 'gray',
  };

  return (
    <MapView
      ref={reactMapRef}
      style={[styles.container, style]}
      provider={provider}
      initialRegion={initialRegion}
      showsUserLocation={showsUserLocation}
      followUserLocation={followsUserLocation}
      mapType={mapType}
      showsMyLocationButton={showsMyLocationButton}
      onPress={onMapPress}
      onRegionChangeComplete={onRegionChangeComplete}
      onMapReady={onMapReady}
    >
      {knocks.map((knock) => (
        <Marker
          key={knock.id}
          coordinate={{
            latitude: knock.latitude,
            longitude: knock.longitude,
          }}
          title={knock.address || 'Knock'}
          description={knock.outcome.replace(/_/g, ' ')}
          pinColor={OUTCOME_COLORS[knock.outcome as keyof typeof OUTCOME_COLORS] || OUTCOME_COLORS.other}
          onPress={() => handleMarkerPress(knock)}
        />
      ))}
      {children}
    </MapView>
  );
});

MapWrapper.displayName = 'MapWrapper';

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

export default MapWrapper;
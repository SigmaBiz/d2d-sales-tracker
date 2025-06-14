import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, Text, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { Knock } from '../types';

// Import maps components with error handling
let MapView: any, Marker: any, PROVIDER_GOOGLE: any;
try {
  if (Platform.OS !== 'web') {
    const Maps = require('react-native-maps');
    MapView = Maps.default;
    Marker = Maps.Marker;
    PROVIDER_GOOGLE = Maps.PROVIDER_GOOGLE;
  }
} catch (error) {
  console.log('Maps not available in Expo Go');
}

type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

const OUTCOME_COLORS = {
  not_home: '#gray',
  no_soliciting: '#red',
  lead: '#yellow',
  sale: '#green',
  callback: '#orange',
  not_interested: '#darkred',
};

export default function MapScreen() {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<Region | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    initializeMap();
    loadKnocks();
  }, []);

  const initializeMap = async () => {
    const hasPermission = await LocationService.requestPermissions();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to use this app.');
      return;
    }

    const location = await LocationService.getCurrentLocation();
    if (location) {
      const region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setUserLocation(region);
    }
  };

  const loadKnocks = async () => {
    const storedKnocks = await StorageService.getKnocks();
    setKnocks(storedKnocks);
  };

  const toggleTracking = async () => {
    if (isTracking) {
      await LocationService.stopBackgroundLocationTracking();
      setIsTracking(false);
    } else {
      await LocationService.startBackgroundLocationTracking();
      setIsTracking(true);
    }
  };

  const centerOnUser = async () => {
    const location = await LocationService.getCurrentLocation();
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  };

  const getMarkerColor = (outcome: string): string => {
    return OUTCOME_COLORS[outcome as keyof typeof OUTCOME_COLORS] || '#gray';
  };

  // Fallback view for web or when maps aren't available
  if (Platform.OS === 'web' || !MapView) {
    return (
      <View style={styles.container}>
        <View style={styles.webMapContainer}>
          <Text style={styles.webMapTitle}>Territory Map</Text>
          <Text style={styles.webMapSubtitle}>
            {Platform.OS === 'web' 
              ? 'Map view is only available on mobile devices'
              : 'Loading map...'}
          </Text>
          
          <View style={styles.knocksList}>
            <Text style={styles.knocksListTitle}>Recent Knocks ({knocks.length})</Text>
            {knocks.slice(0, 10).map((knock) => (
              <View key={knock.id} style={styles.knockItem}>
                <View style={[styles.knockDot, { backgroundColor: getMarkerColor(knock.outcome) }]} />
                <View style={styles.knockInfo}>
                  <Text style={styles.knockOutcome}>
                    {knock.outcome.replace('_', ' ').toUpperCase()}
                  </Text>
                  <Text style={styles.knockAddress}>{knock.address || 'No address'}</Text>
                  {knock.notes && <Text style={styles.knockNotes}>{knock.notes}</Text>}
                </View>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.trackingButton, isTracking && styles.trackingActive]} 
          onPress={toggleTracking}
        >
          <Ionicons 
            name={isTracking ? "pause-circle" : "play-circle"} 
            size={24} 
            color="white" 
          />
          <Text style={styles.trackingText}>
            {isTracking ? 'Stop Tracking' : 'Start Tracking'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={userLocation || undefined}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {knocks.map((knock) => (
          <Marker
            key={knock.id}
            coordinate={{
              latitude: knock.latitude,
              longitude: knock.longitude,
            }}
            pinColor={getMarkerColor(knock.outcome)}
            title={knock.outcome.replace('_', ' ').toUpperCase()}
            description={knock.notes || knock.address}
          />
        ))}
      </MapView>

      <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
        <Ionicons name="locate" size={24} color="#1e40af" />
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.trackingButton, isTracking && styles.trackingActive]} 
        onPress={toggleTracking}
      >
        <Ionicons 
          name={isTracking ? "pause-circle" : "play-circle"} 
          size={24} 
          color="white" 
        />
        <Text style={styles.trackingText}>
          {isTracking ? 'Stop Tracking' : 'Start Tracking'}
        </Text>
      </TouchableOpacity>

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#green' }]} />
          <Text style={styles.legendText}>Sale</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#yellow' }]} />
          <Text style={styles.legendText}>Lead</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#orange' }]} />
          <Text style={styles.legendText}>Callback</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#gray' }]} />
          <Text style={styles.legendText}>Not Home</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  centerButton: {
    position: 'absolute',
    right: 16,
    top: 16,
    backgroundColor: 'white',
    borderRadius: 30,
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  trackingButton: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: '#1e40af',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  trackingActive: {
    backgroundColor: '#dc2626',
  },
  trackingText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  legend: {
    position: 'absolute',
    left: 16,
    top: 16,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
  },
  // Web fallback styles
  webMapContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f3f4f6',
  },
  webMapTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 8,
  },
  webMapSubtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 24,
  },
  knocksList: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  knocksListTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: '#1f2937',
  },
  knockItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  knockDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
    marginTop: 2,
  },
  knockInfo: {
    flex: 1,
  },
  knockOutcome: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  knockAddress: {
    fontSize: 12,
    color: '#6b7280',
  },
  knockNotes: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    fontStyle: 'italic',
  },
});
import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, Text } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { Knock } from '../types';

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
  const mapRef = useRef<MapView>(null);

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
});
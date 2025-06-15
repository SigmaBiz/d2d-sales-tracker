import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// SOLUTION SWITCHER: Comment/uncomment to try different solutions
import WebMap from '../components/WebMap'; // Solution 1: Stabilized with useMemo
// import WebMap from '../components/WebMapSimple'; // Solution 2: Simple dots (no emojis)
// import TestWebView from '../components/TestWebView'; // Test WebView
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { SupabaseService } from '../services/supabaseService';
import { Knock } from '../types';

export default function RealMapScreen({ navigation }: any) {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(true);
  const webMapRef = useRef<any>(null);

  useEffect(() => {
    initializeMap();
    loadKnocks();
    
    // Set up location watching
    const interval = setInterval(updateLocation, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, []);

  const initializeMap = async () => {
    const hasPermission = await LocationService.requestPermissions();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to use the map.');
      return;
    }

    updateLocation();
  };

  const updateLocation = async () => {
    const location = await LocationService.getCurrentLocation();
    if (location) {
      setUserLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    }
  };

  const loadKnocks = async () => {
    setLoading(true);
    try {
      // First get local knocks
      const localKnocks = await StorageService.getKnocks();
      console.log('Loaded knocks:', localKnocks.length);
      setKnocks(localKnocks);
      
      // Then try to get cloud knocks if connected
      const cloudKnocks = await SupabaseService.getCloudKnocks();
      if (cloudKnocks.length > 0) {
        // Merge cloud and local knocks, removing duplicates
        const knockMap = new Map();
        [...localKnocks, ...cloudKnocks].forEach(knock => {
          knockMap.set(knock.id, knock);
        });
        setKnocks(Array.from(knockMap.values()));
      }
    } catch (error) {
      console.error('Error loading knocks:', error);
    } finally {
      setLoading(false);
    }
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

  const centerOnUser = () => {
    updateLocation();
    if (webMapRef.current && userLocation) {
      webMapRef.current.postMessage(JSON.stringify({
        type: 'centerOnUser'
      }));
    }
  };

  const handleMapClick = (knockData: Knock) => {
    if (knockData.id) {
      // Editing existing knock
      navigation.navigate('Knock', {
        knockId: knockData.id,
        latitude: knockData.latitude,
        longitude: knockData.longitude,
        address: knockData.address,
        outcome: knockData.outcome,
        notes: knockData.notes,
      });
    } else {
      // Creating new knock
      navigation.navigate('Knock', {
        latitude: knockData.latitude,
        longitude: knockData.longitude,
      });
    }
  };

  return (
    <View style={styles.container}>
      <WebMap 
        ref={webMapRef}
        knocks={knocks}
        userLocation={userLocation}
        onKnockClick={handleMapClick}
      />
      
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{knocks.length}</Text>
          <Text style={styles.statLabel}>Total Knocks</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {knocks.filter(k => k.outcome === 'sale').length}
          </Text>
          <Text style={styles.statLabel}>Sales</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {knocks.filter(k => k.outcome === 'lead').length}
          </Text>
          <Text style={styles.statLabel}>Leads</Text>
        </View>
      </View>

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

      <TouchableOpacity 
        style={styles.refreshButton} 
        onPress={loadKnocks}
      >
        <Ionicons name="refresh" size={24} color="#1e40af" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statsBar: {
    position: 'absolute',
    top: 10,
    left: 16,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e40af',
  },
  statLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#e5e7eb',
  },
  centerButton: {
    position: 'absolute',
    right: 16,
    bottom: 100,
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
  refreshButton: {
    position: 'absolute',
    right: 16,
    bottom: 170,
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
});
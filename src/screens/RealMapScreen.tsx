import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// SOLUTION SWITCHER: Comment/uncomment to try different solutions
import WebMap from '../components/WebMap'; // Original version
// import WebMap from '../components/WebMapFixed'; // Fixed version with proper message queuing
// import WebMap from '../components/WebMapSimple'; // Solution 2: Simple dots (no emojis)
// import TestWebView from '../components/TestWebView'; // Test WebView
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { SupabaseService } from '../services/supabaseService';
import { MRMSService, StormEvent, HailReport } from '../services/mrmsService';
import { HailAlertService } from '../services/hailAlertService';
import { SimpleContourService } from '../services/simpleContourService';
import { MRMSContourService } from '../services/mrmsContourService';
import HailOverlay from '../components/HailOverlay';
import { Knock } from '../types';

export default function RealMapScreen({ navigation }: any) {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeStorms, setActiveStorms] = useState<StormEvent[]>([]);
  const [hailData, setHailData] = useState<HailReport[]>([]);
  const [hailContours, setHailContours] = useState<any>(null);
  const [useSmoothContours, setUseSmoothContours] = useState(true); // Default to smooth MRMS contours
  const webMapRef = useRef<any>(null);

  useEffect(() => {
    initializeMap();
    loadKnocks();
    loadHailData();
    initializeHailAlerts();
    
    // Set up location watching
    const interval = setInterval(updateLocation, 5000); // Update every 5 seconds
    
    return () => {
      clearInterval(interval);
      HailAlertService.stopMonitoring();
    };
  }, []);

  // Reload knocks when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadKnocks();
    });

    return unsubscribe;
  }, [navigation]);

  // Monitor hailContours state changes
  useEffect(() => {
    console.log('RealMapScreen - hailContours state updated:', hailContours);
  }, [hailContours]);

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
        history: knockData.history,
      });
    } else {
      // Creating new knock
      navigation.navigate('Knock', {
        latitude: knockData.latitude,
        longitude: knockData.longitude,
      });
    }
  };

  const initializeHailAlerts = async () => {
    try {
      await HailAlertService.initialize();
      await HailAlertService.startMonitoring(5); // Check every 5 minutes
    } catch (error) {
      console.error('Error initializing hail alerts:', error);
    }
  };

  const loadHailData = async () => {
    try {
      const storms = await MRMSService.getActiveStorms();
      setActiveStorms(storms);
      
      // Combine all enabled storm reports
      const allReports: HailReport[] = [];
      storms.forEach(storm => {
        if (storm.enabled) {
          allReports.push(...storm.reports);
        }
      });
      setHailData(allReports);
      
      // Generate contours from reports
      if (allReports.length > 0) {
        // Generate contours directly from the collected reports
        console.log(`Generating contours from ${allReports.length} hail reports`);
        
        let contourData = null;
        
        // Use user preference or fall back gracefully
        if (useSmoothContours) {
          // Try MRMS contours first for smoother visualization
          try {
            console.log('Attempting MRMS contour generation...');
            contourData = await MRMSContourService.generateContoursFromReports(allReports);
            console.log('MRMS contours generated successfully:', contourData);
          } catch (mrmsError) {
            console.warn('MRMS contour generation failed, falling back to simple contours:', mrmsError);
            
            // Fallback to simple contours
            try {
              contourData = SimpleContourService.generateSimpleContours(allReports);
              console.log('Simple contours generated as fallback:', contourData);
            } catch (simpleError) {
              console.error('Both contour methods failed:', simpleError);
            }
          }
        } else {
          // User prefers simple contours
          try {
            contourData = SimpleContourService.generateSimpleContours(allReports);
            console.log('Simple contours generated:', contourData);
          } catch (simpleError) {
            console.error('Simple contour generation failed:', simpleError);
          }
        }
        
        setHailContours(contourData);
      } else {
        console.log('No hail reports available for contour generation');
        setHailContours(null);
      }
    } catch (error) {
      console.error('Error loading hail data:', error);
    }
  };

  const handleStormToggle = async (stormId: string, enabled: boolean) => {
    await loadHailData();
  };

  const handleStormDelete = async (stormId: string) => {
    await loadHailData();
  };

  const handleStormFocus = async (stormId: string) => {
    await loadHailData();
    
    // Get the focused storm to find its bounds
    const storms = await MRMSService.getActiveStorms();
    const focusedStorm = storms.find(s => s.id === stormId && s.enabled);
    
    if (focusedStorm && focusedStorm.bounds && webMapRef.current) {
      console.log('Focusing on storm bounds:', focusedStorm.bounds);
      
      // Send focus command to webview with specific bounds
      webMapRef.current.postMessage(JSON.stringify({
        type: 'focusOnBounds',
        bounds: {
          north: focusedStorm.bounds.north,
          south: focusedStorm.bounds.south,
          east: focusedStorm.bounds.east,
          west: focusedStorm.bounds.west
        }
      }));
    }
  };

  return (
    <View style={styles.container}>
      <WebMap 
        ref={webMapRef}
        knocks={knocks}
        userLocation={userLocation}
        onKnockClick={handleMapClick}
        hailContours={hailContours}
        activeStorms={activeStorms.filter(s => s.enabled).map(s => s.id)}
      />
      
      <HailOverlay
        onStormToggle={handleStormToggle}
        onStormDelete={handleStormDelete}
        onStormFocus={handleStormFocus}
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

      {hailContours && (
        <TouchableOpacity 
          style={styles.hailButton} 
          onPress={() => {
            if (webMapRef.current) {
              webMapRef.current.postMessage(JSON.stringify({
                type: 'focusOnHail'
              }));
            }
          }}
        >
          <Ionicons name="thunderstorm" size={24} color="#ef4444" />
        </TouchableOpacity>
      )}
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
  hailButton: {
    position: 'absolute',
    right: 16,
    bottom: 240,
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
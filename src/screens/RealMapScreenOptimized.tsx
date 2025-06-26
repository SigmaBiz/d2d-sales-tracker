import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
// OPTIMIZATION: Use safer minified WebMap (20-30% smaller)
import WebMap from '../components/WebMapOptimizedSafe';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageServiceWrapper';
import { SupabaseService } from '../services/supabaseService';
import { MRMSService, StormEvent, HailReport } from '../services/mrmsService';
import { HailAlertService } from '../services/hailAlertService';
import { SimpleContourService } from '../services/simpleContourService';
import { MRMSContourService } from '../services/mrmsContourService';
import HailOverlay from '../components/HailOverlay';
import AddressSearchBar from '../components/AddressSearchBar';
import NotificationLogPanel from '../components/NotificationLogPanel';
import { Knock, NotificationLogEntry } from '../types';
import { testContourGeneration } from '../utils/testContourGeneration';
import { KnockDebugger } from '../utils/knockDebugger';
import MapUpdateService from '../services/mapUpdateService';
import { calculateKnockChanges } from '../utils/knockDifferential';

// OPTIMIZATION: Debounce helper
const debounce = (func: Function, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// DEVELOPMENT FLAGS
const DEV_DISABLE_GPS_UPDATES = __DEV__;

export default function RealMapScreenOptimized({ navigation }: any) {
  const isFocused = useIsFocused();
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStorms, setActiveStorms] = useState<StormEvent[]>([]);
  const [hailData, setHailData] = useState<HailReport[]>([]);
  const [hailContours, setHailContours] = useState<any>(null);
  const [useSmoothContours, setUseSmoothContours] = useState(true);
  const [showStormPanel, setShowStormPanel] = useState(false);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');
  const [isGeneratingContours, setIsGeneratingContours] = useState(false);
  const [verifiedReports, setVerifiedReports] = useState<HailReport[]>([]);
  const [showNotificationLog, setShowNotificationLog] = useState(false);
  const [showCleared, setShowCleared] = useState(false);
  const [clearedCount, setClearedCount] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const webMapRef = useRef<any>(null);
  const contourGenerationTimeout = useRef<NodeJS.Timeout | null>(null);
  
  // OPTIMIZATION: Track previous knocks for differential updates
  const previousKnocksRef = useRef<Knock[]>([]);
  const useDifferentialUpdates = true; // Feature flag

  // OPTIMIZATION: Memoize stats calculations
  const stats = useMemo(() => {
    const sales = knocks.filter(k => k.outcome === 'sale').length;
    const leads = knocks.filter(k => k.outcome === 'lead').length;
    return {
      total: knocks.length,
      sales,
      leads
    };
  }, [knocks]);

  // OPTIMIZATION: Memoize filtered storms
  const enabledStorms = useMemo(() => 
    activeStorms.filter(s => s.enabled),
    [activeStorms]
  );

  // OPTIMIZATION: Memoize storm IDs
  const enabledStormIds = useMemo(() => 
    enabledStorms.map(s => s.id),
    [enabledStorms]
  );

  // OPTIMIZATION: Debounce location updates
  const debouncedUpdateLocation = useMemo(
    () => debounce(async () => {
      const location = await LocationService.getCurrentLocation();
      if (location) {
        setUserLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        });
      } else {
        setUserLocation({
          lat: 35.4676,
          lng: -97.5164,
        });
      }
    }, 1000),
    []
  );

  useEffect(() => {
    initializeMap();
    loadKnocks();
    loadHailData();
    initializeHailAlerts();
    
    console.log('Running contour generation test...');
    testContourGeneration();
    
    // Set up location watching
    let interval: NodeJS.Timeout | null = null;
    if (!DEV_DISABLE_GPS_UPDATES) {
      interval = setInterval(debouncedUpdateLocation, 5000);
    } else {
      console.log('[DEV] GPS updates disabled for development');
      debouncedUpdateLocation();
    }
    
    return () => {
      if (interval) clearInterval(interval);
      if (contourGenerationTimeout.current) clearTimeout(contourGenerationTimeout.current);
      HailAlertService.stopMonitoring();
      // Clear map update service reference
      MapUpdateService.clear();
    };
  }, []);

  // Set MapUpdateService reference when WebView is ready
  useEffect(() => {
    if (webMapRef.current) {
      MapUpdateService.setWebViewRef(webMapRef.current);
      console.log('RealMapScreenOptimized: MapUpdateService initialized');
    }
  }, [loading]); // Re-run when loading changes

  // OPTIMIZATION: Send differential updates when knocks change
  useEffect(() => {
    if (!loading && webMapRef.current && mapReady) {
      // Always send update if we have knocks OR if previous had knocks (for clearing)
      if (knocks.length > 0 || previousKnocksRef.current.length > 0) {
        if (useDifferentialUpdates && previousKnocksRef.current.length > 0) {
          // Calculate changes
          const changes = calculateKnockChanges(previousKnocksRef.current, knocks);
          
          if (changes.hasChanges) {
            console.log('Sending differential update:', {
              added: changes.added.length,
              updated: changes.updated.length,
              removed: changes.removed.length
            });
            
            // Send differential update
            webMapRef.current.postMessage(JSON.stringify({
              type: 'updateKnocksDifferential',
              added: changes.added,
              updated: changes.updated,
              removed: changes.removed
            }));
          }
        } else {
          // Send full update (first load or differential disabled)
          console.log('Sending full knock update:', knocks.length);
          webMapRef.current.postMessage(JSON.stringify({
            type: 'updateKnocks',
            knocks: knocks
          }));
        }
        
        // Update reference for next comparison
        previousKnocksRef.current = [...knocks];
      }
    }
  }, [knocks, loading, useDifferentialUpdates, mapReady]);

  // OPTIMIZATION: Use callback to prevent recreation
  const handleFocus = useCallback(() => {
    console.log('🔴 DEBUG - RealMapScreen focused, reloading knocks...');
    loadKnocks();
    loadHailData();
    
    if ((global as any).openNotificationLog) {
      setShowNotificationLog(true);
      (global as any).openNotificationLog = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', handleFocus);
    return unsubscribe;
  }, [navigation, handleFocus]);

  useEffect(() => {
    console.log('RealMapScreenOptimized - hailContours state updated:', hailContours);
  }, [hailContours]);

  const initializeMap = async () => {
    const hasPermission = await LocationService.requestPermissions();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Location permission is required to use the map.');
      return;
    }

    debouncedUpdateLocation();
  };

  // OPTIMIZATION: Memoize loadKnocks to prevent recreation
  const loadKnocks = useCallback(async () => {
    console.log('🟠 DEBUG - loadKnocks called');
    setLoading(true);
    try {
      const localKnocks = showCleared 
        ? await StorageService.getKnocks()
        : await StorageService.getVisibleKnocks();
      
      const clearedIds = await StorageService.getClearedKnockIds();
      setClearedCount(clearedIds.length);
      
      console.log('🟡 DEBUG - Loaded knocks:', localKnocks.length, 'Cleared:', clearedIds.length);
      
      // DEBUG: Show all knocks to find the updated one
      console.log('🟡 DEBUG - All loaded knocks:');
      localKnocks.forEach((knock, index) => {
        console.log(`  [${index}]`, {
          id: knock.id,
          outcome: knock.outcome,
          address: knock.address,
        });
      });
      
      // DEBUG: Show recently updated knocks
      const recentlyUpdated = localKnocks.filter(k => {
        const timeDiff = Date.now() - new Date(k.timestamp).getTime();
        return timeDiff < 60000; // Updated in last minute
      });
      
      if (recentlyUpdated.length > 0) {
        console.log('🔴 DEBUG - Recently updated knocks:');
        recentlyUpdated.forEach(knock => {
          console.log('  ', {
            id: knock.id,
            address: knock.address,
            outcome: knock.outcome,
            timestamp: knock.timestamp,
          });
        });
      }
      console.log('🟢 DEBUG - Setting knocks state with', localKnocks.length, 'knocks');
      setKnocks(localKnocks);
      
      // Then try to get cloud knocks if connected
      const cloudKnocks = await SupabaseService.getCloudKnocks();
      if (cloudKnocks.length > 0) {
        const knockMap = new Map();
        [...localKnocks, ...cloudKnocks].forEach(knock => {
          if (showCleared || !clearedIds.includes(knock.id)) {
            knockMap.set(knock.id, knock);
          }
        });
        setKnocks(Array.from(knockMap.values()));
      }
    } catch (error) {
      console.error('Error loading knocks:', error);
    } finally {
      setLoading(false);
    }
  }, [showCleared]);

  const centerOnUser = useCallback(() => {
    debouncedUpdateLocation();
    if (webMapRef.current && userLocation) {
      webMapRef.current.postMessage(JSON.stringify({
        type: 'centerOnUser'
      }));
    }
  }, [userLocation, debouncedUpdateLocation]);

  const handleKnockClear = useCallback(async (knockId: string) => {
    try {
      await StorageService.clearKnock(knockId);
      loadKnocks();
      console.log('Knock cleared:', knockId);
    } catch (error) {
      console.error('Error clearing knock:', error);
      Alert.alert('Error', 'Failed to clear knock');
    }
  }, [loadKnocks]);

  const handleMapClick = useCallback((knockData: Knock) => {
    KnockDebugger.log('📱 RealMapScreen received click', {
      hasId: !!knockData.id,
      latitude: knockData.latitude,
      longitude: knockData.longitude,
      address: knockData.address
    });
    
    if (knockData.id) {
      KnockDebugger.log('✏️ Editing existing knock', { knockId: knockData.id });
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
      KnockDebugger.log('➕ Creating new knock');
      navigation.navigate('Knock', {
        latitude: knockData.latitude,
        longitude: knockData.longitude,
      });
    }
  }, [navigation]);

  const initializeHailAlerts = async () => {
    try {
      await HailAlertService.initialize();
      await HailAlertService.startMonitoring(5);
    } catch (error) {
      console.error('Error initializing hail alerts:', error);
    }
  };

  // OPTIMIZATION: Memoize contour generation function
  const generateContours = useCallback(async (allReports: HailReport[]) => {
    if (allReports.length === 0) {
      console.log('No hail reports available for contour generation - clearing contours');
      setHailContours({
        type: 'FeatureCollection',
        features: []
      });
      return;
    }

    setIsGeneratingContours(true);
    
    console.log(`Generating contours from ${allReports.length} hail reports`);
    
    let contourData = null;
    
    if (useSmoothContours) {
      try {
        console.log('Attempting MRMS contour generation...');
        contourData = await MRMSContourService.generateContoursFromReports(allReports);
        console.log('MRMS contours generated successfully:', contourData);
      } catch (mrmsError) {
        console.warn('MRMS contour generation failed, falling back to simple contours:', mrmsError);
        
        try {
          contourData = SimpleContourService.generateSimpleContours(allReports);
          console.log('Simple contours generated as fallback:', contourData);
        } catch (simpleError) {
          console.error('Both contour methods failed:', simpleError);
        }
      }
    } else {
      try {
        contourData = SimpleContourService.generateSimpleContours(allReports);
        console.log('Simple contours generated:', contourData);
      } catch (simpleError) {
        console.error('Simple contour generation failed:', simpleError);
      }
    }
    
    console.log('Setting hail contours in state:', contourData);
    if (contourData && contourData.features) {
      console.log('Contour features being set:', contourData.features.map((f: any) => ({
        description: f.properties.description,
        color: f.properties.color,
        level: f.properties.level
      })));
    }
    setHailContours(contourData);
    setIsGeneratingContours(false);
  }, [useSmoothContours]);

  const loadHailData = useCallback(async () => {
    try {
      const storms = await MRMSService.getActiveStorms();
      setActiveStorms(storms);
      
      const allReports: HailReport[] = [];
      const verified: HailReport[] = [];
      storms.forEach(storm => {
        if (storm.enabled) {
          allReports.push(...storm.reports);
          const verifiedInStorm = storm.reports.filter(r => r.groundTruth);
          verified.push(...verifiedInStorm);
        }
      });
      setHailData(allReports);
      setVerifiedReports(verified);
      console.log(`Found ${verified.length} verified reports to display as markers`);
      
      // Clear any existing timeout
      if (contourGenerationTimeout.current) {
        clearTimeout(contourGenerationTimeout.current);
      }
      
      // Debounce contour generation
      contourGenerationTimeout.current = setTimeout(() => {
        generateContours(allReports);
      }, 300);
    } catch (error) {
      console.error('Error loading hail data:', error);
      setIsGeneratingContours(false);
    }
  }, [generateContours]);

  const handleStormToggle = useCallback(async (stormId: string, enabled: boolean) => {
    await MRMSService.toggleStorm(stormId, enabled);
    await loadHailData();
  }, [loadHailData]);

  const handleStormDelete = useCallback(async (stormId: string) => {
    await MRMSService.deleteStorm(stormId);
    await loadHailData();
  }, [loadHailData]);

  const handleStormFocus = useCallback(async (stormId: string) => {
    await loadHailData();
    
    const storms = await MRMSService.getActiveStorms();
    const focusedStorm = storms.find(s => s.id === stormId && s.enabled);
    
    if (focusedStorm && focusedStorm.bounds && webMapRef.current) {
      console.log('Focusing on storm bounds:', focusedStorm.bounds);
      
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
  }, [loadHailData]);

  const handleAddressSelect = useCallback((address: string, lat: number, lng: number) => {
    console.log('Address selected:', address, lat, lng);
    
    if (webMapRef.current) {
      webMapRef.current.postMessage(JSON.stringify({
        type: 'centerOnLocation',
        lat: lat,
        lng: lng,
        zoom: 16
      }));
    }
  }, []);

  return (
    <View style={styles.container}>
      <WebMap 
        ref={webMapRef}
        knocks={knocks}
        userLocation={userLocation}
        onKnockClick={handleMapClick}
        onKnockClear={handleKnockClear}
        onMapReady={() => {
          console.log('Map is ready, enabling knock updates');
          setMapReady(true);
        }}
        hailContours={hailContours}
        activeStorms={enabledStormIds}
        verifiedReports={verifiedReports}
      />
      
      {/* Storm Panel - Only show when toggled */}
      {showStormPanel && (
        <HailOverlay
          onStormToggle={handleStormToggle}
          onStormDelete={handleStormDelete}
          onStormFocus={handleStormFocus}
          onClose={() => setShowStormPanel(false)}
          dataSource={
            activeStorms.length > 0 && activeStorms[0].source
              ? activeStorms[0].source
              : undefined
          }
        />
      )}

      {/* Notification Log Panel */}
      <NotificationLogPanel
        visible={showNotificationLog}
        onClose={() => setShowNotificationLog(false)}
        onCreateOverlay={() => {
          loadHailData();
          setShowNotificationLog(false);
        }}
      />
      
      {/* OPTIMIZATION: Use memoized stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total Knocks</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.sales}</Text>
          <Text style={styles.statLabel}>Sales</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.leads}</Text>
          <Text style={styles.statLabel}>Leads</Text>
        </View>
      </View>

      {/* Address Search Bar */}
      <AddressSearchBar onAddressSelect={handleAddressSelect} />

      {/* Right Button Stack - Storm related */}
      <View style={styles.rightButtonStack}>
        {/* Notification Log Button */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => setShowNotificationLog(!showNotificationLog)}
        >
          <Ionicons name="notifications" size={24} color="#FF6B6B" />
        </TouchableOpacity>

        {/* Focus on Hail Button */}
        {hailContours && (
          <TouchableOpacity 
            style={styles.actionButton} 
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
        
        {/* Active Storms Button with badge */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => setShowStormPanel(!showStormPanel)}
        >
          {isGeneratingContours ? (
            <ActivityIndicator size="small" color="#1e40af" />
          ) : (
            <>
              <Ionicons name="cloud" size={24} color="#1e40af" />
              {enabledStorms.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {enabledStorms.length}
                  </Text>
                </View>
              )}
            </>
          )}
        </TouchableOpacity>
        
        {/* Storm Search Button */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => {
            requestAnimationFrame(() => {
              navigation.navigate('StormSearch');
            });
          }}
        >
          <Ionicons name="search" size={24} color="#1e40af" />
        </TouchableOpacity>
      </View>
      
      {/* Left Button Stack - Map controls */}
      <View style={styles.leftButtonStack}>
        {/* Map Type Toggle */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => {
            const newType = mapType === 'street' ? 'satellite' : 'street';
            setMapType(newType);
            if (webMapRef.current) {
              webMapRef.current.postMessage(JSON.stringify({
                type: 'toggleMapType'
              }));
            }
          }}
        >
          <Text style={{ fontSize: 24 }}>{mapType === 'street' ? '🗺️' : '🛰️'}</Text>
        </TouchableOpacity>
        
        {/* Refresh Button - Long press to show/hide cleared */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={loadKnocks}
          onLongPress={async () => {
            setShowCleared(!showCleared);
            Alert.alert(
              showCleared ? 'Hiding Cleared Knocks' : 'Showing All Knocks',
              showCleared 
                ? 'Map will now hide cleared knocks' 
                : `Map will show all knocks including ${clearedCount} cleared ones`,
              [{ text: 'OK', onPress: () => loadKnocks() }]
            );
          }}
        >
          <Ionicons 
            name="refresh" 
            size={24} 
            color={showCleared ? "#ef4444" : "#1e40af"} 
          />
        </TouchableOpacity>
        
        {/* Center on User Button */}
        <TouchableOpacity style={styles.actionButton} onPress={centerOnUser}>
          <Ionicons name="locate" size={24} color="#1e40af" />
        </TouchableOpacity>
      </View>
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
  rightButtonStack: {
    position: 'absolute',
    right: 16,
    bottom: 80,
  },
  leftButtonStack: {
    position: 'absolute',
    left: 16,
    bottom: 80,
  },
  actionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 30,
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3.84,
    elevation: 5,
    marginBottom: 10,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ef4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
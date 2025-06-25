import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
// SOLUTION SWITCHER: Comment/uncomment to try different solutions
// import WebMap from '../components/WebMap'; // Original OSM/Leaflet version
import WebMapGoogle from '../components/WebMapGoogle'; // Google Maps version
// import WebMap from '../components/WebMapFixed'; // Fixed version with proper message queuing
// import WebMap from '../components/WebMapSimple'; // Solution 2: Simple dots (no emojis)
// import TestWebView from '../components/TestWebView'; // Test WebView
import { MAPS_CONFIG } from '../config/maps.config';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
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

// DEVELOPMENT FLAGS - REMEMBER TO RESTORE BEFORE PRODUCTION
const DEV_DISABLE_GPS_UPDATES = __DEV__; // Automatically false in production builds

export default function RealMapScreen({ navigation }: any) {
  const isFocused = useIsFocused();
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStorms, setActiveStorms] = useState<StormEvent[]>([]);
  const [hailData, setHailData] = useState<HailReport[]>([]);
  const [hailContours, setHailContours] = useState<any>(null);
  const [useSmoothContours, setUseSmoothContours] = useState(true); // Default to smooth MRMS contours
  const [showStormPanel, setShowStormPanel] = useState(false);
  const [mapType, setMapType] = useState<'street' | 'satellite'>('street');
  const [isGeneratingContours, setIsGeneratingContours] = useState(false);
  const [verifiedReports, setVerifiedReports] = useState<HailReport[]>([]);
  const [showNotificationLog, setShowNotificationLog] = useState(false);
  const [clearedKnockIds, setClearedKnockIds] = useState<Set<string>>(new Set());
  const [clearedKnocksLoaded, setClearedKnocksLoaded] = useState(false);
  const webMapRef = useRef<any>(null);
  const contourGenerationTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initialize critical map features in parallel
    const initialize = async () => {
      console.log('[RealMapScreen] Starting parallel initialization...');
      const startTime = Date.now();
      
      // First load cleared IDs, then run other operations in parallel
      // This is needed because loadKnocks depends on cleared IDs
      const clearedIds = await loadClearedKnockIds();
      
      // Now run map init and knock loading in parallel
      await Promise.all([
        initializeMap(),
        loadKnocks(clearedIds)
      ]);
      
      console.log(`[RealMapScreen] Parallel init completed in ${Date.now() - startTime}ms`);
      
      // Defer heavy services to improve initial load time
      setTimeout(() => {
        console.log('[RealMapScreen] Loading deferred services...');
        // These can also run in parallel
        Promise.all([
          loadHailData(),
          initializeHailAlerts()
        ]).then(() => {
          // Test contour generation after hail data loads
          console.log('Running contour generation test...');
          testContourGeneration();
        });
      }, 500); // Small delay to let map render first
    };
    
    initialize();
    
    // Set up location watching (disabled in development)
    let interval: NodeJS.Timeout | null = null;
    if (!DEV_DISABLE_GPS_UPDATES) {
      interval = setInterval(updateLocation, 5000); // Update every 5 seconds
    } else {
      console.log('[DEV] GPS updates disabled for development');
      // Get location once for initial position
      updateLocation();
    }
    
    return () => {
      if (interval) clearInterval(interval);
      if (contourGenerationTimeout.current) clearTimeout(contourGenerationTimeout.current);
      HailAlertService.stopMonitoring();
    };
  }, []);

  // Reload knocks and hail data when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Load both in parallel for faster refresh
      Promise.all([
        loadKnocks(),
        loadHailData()
      ]);
      
      // Check if we should open notification log
      if ((global as any).openNotificationLog) {
        setShowNotificationLog(true);
        (global as any).openNotificationLog = false; // Clear the flag
      }
    });

    return unsubscribe;
  }, [navigation]); // Remove clearedKnockIds to prevent loops

  // Monitor hailContours state changes
  useEffect(() => {
    console.log('RealMapScreen - hailContours state updated:', hailContours);
  }, [hailContours]);

  // Remove the effect that waits for clearedKnocksLoaded since we handle it inside loadKnocks now

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
    } else {
      // Default to Oklahoma City if no location permission
      setUserLocation({
        lat: 35.4676,
        lng: -97.5164,
      });
    }
  };

  const loadClearedKnockIds = async () => {
    try {
      const clearedIds = await StorageService.getClearedKnockIds();
      setClearedKnockIds(clearedIds);
      setClearedKnocksLoaded(true);
      console.log('Loaded cleared knock IDs:', Array.from(clearedIds));
      return clearedIds;
    } catch (error) {
      console.error('Error loading cleared knock IDs:', error);
      setClearedKnocksLoaded(true);
      return new Set<string>();
    }
  };

  const loadKnocks = async (providedClearedIds?: Set<string>) => {
    setLoading(true);
    try {
      // Use provided cleared IDs or get them if not provided
      let currentClearedIds = providedClearedIds || clearedKnockIds;
      if (!providedClearedIds && !clearedKnocksLoaded) {
        currentClearedIds = await loadClearedKnockIds();
      }
      
      // Load local and cloud knocks in parallel
      const [localKnocks, cloudKnocks] = await Promise.all([
        StorageService.getKnocks(),
        SupabaseService.getCloudKnocks()
      ]);
      
      console.log('Loaded knocks:', localKnocks.length, 'local,', cloudKnocks.length, 'cloud');
      
      // Filter out cleared knocks using current cleared IDs
      const filteredKnocks = localKnocks.filter(knock => !currentClearedIds.has(knock.id));
      setKnocks(filteredKnocks);
      console.log(`Loaded ${localKnocks.length} knocks, showing ${filteredKnocks.length} after filtering`);
      
      // Merge cloud knocks if available
      if (cloudKnocks.length > 0) {
        // Merge cloud and local knocks, removing duplicates
        const knockMap = new Map();
        [...localKnocks, ...cloudKnocks].forEach(knock => {
          if (!currentClearedIds.has(knock.id)) {
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
  };


  const centerOnUser = () => {
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
      const verified: HailReport[] = [];
      storms.forEach(storm => {
        if (storm.enabled) {
          allReports.push(...storm.reports);
          // Extract verified reports
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
      
      // Debounce contour generation to avoid lag
      contourGenerationTimeout.current = setTimeout(async () => {
        // Generate contours from reports
        if (allReports.length > 0) {
          setIsGeneratingContours(true);
          
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
        } else {
          // Only clear contours if we don't already have them
          // This prevents flickering when the data is temporarily unavailable
          if (hailContours && hailContours.features && hailContours.features.length > 0) {
            console.log('Keeping existing contours - no new hail reports to process');
          } else {
            console.log('No hail reports available for contour generation - clearing contours');
            setHailContours(null);
            // Force clear by sending empty feature collection
            const emptyContours = {
              type: 'FeatureCollection',
              features: []
            };
            setHailContours(emptyContours);
          }
          setIsGeneratingContours(false);
        }
      }, 300); // 300ms debounce delay
    } catch (error) {
      console.error('Error loading hail data:', error);
      setIsGeneratingContours(false);
    }
  };

  const handleStormToggle = async (stormId: string, enabled: boolean) => {
    // Actually toggle the storm state first
    await MRMSService.toggleStorm(stormId, enabled);
    // Then reload the data to update the map
    await loadHailData();
  };

  const handleStormDelete = async (stormId: string) => {
    // Actually delete the storm first
    await MRMSService.deleteStorm(stormId);
    // Then reload the data to update the map
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

  const handleAddressSelect = (address: string, lat: number, lng: number) => {
    console.log('Address selected:', address, lat, lng);
    
    // Center map on the selected address
    if (webMapRef.current) {
      webMapRef.current.postMessage(JSON.stringify({
        type: 'centerOnLocation',
        lat: lat,
        lng: lng,
        zoom: 16 // Zoom in closer for address view
      }));
    }
  };

  const handleKnockDelete = async (knockId: string) => {
    try {
      // Add to cleared set
      setClearedKnockIds(prev => {
        const newSet = new Set([...prev, knockId]);
        console.log('Updated clearedKnockIds:', Array.from(newSet));
        // Persist to storage
        StorageService.saveClearedKnockIds(newSet);
        return newSet;
      });
      
      // Remove from current view
      setKnocks(prevKnocks => {
        const filtered = prevKnocks.filter(knock => knock.id !== knockId);
        console.log('Knocks after clearing:', filtered.length, 'removed:', knockId);
        return filtered;
      });
      
      console.log('Knock cleared from map:', knockId);
    } catch (error) {
      console.error('Error clearing knock:', error);
    }
  };

  return (
    <View style={styles.container}>
      <WebMapGoogle 
        ref={webMapRef}
        knocks={knocks}
        userLocation={userLocation}
        onKnockClick={handleMapClick}
        onKnockDelete={handleKnockDelete}
        hailContours={hailContours}
        activeStorms={activeStorms.filter(s => s.enabled).map(s => s.id)}
        verifiedReports={verifiedReports}
        googleApiKey={MAPS_CONFIG.GOOGLE_MAPS_API_KEY}
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
          // Refresh hail data to show the new overlay
          loadHailData();
          setShowNotificationLog(false);
        }}
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
              {activeStorms.filter(s => s.enabled).length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {activeStorms.filter(s => s.enabled).length}
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
            // Use requestAnimationFrame to defer navigation for smoother transition
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
        
        {/* Refresh Button - Long press to show all cleared knocks */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => loadKnocks()}
          onLongPress={async () => {
            // Clear the cleared knocks set to show all knocks again
            setClearedKnockIds(new Set());
            await StorageService.clearClearedKnockIds();
            console.log('Cleared all hidden knocks');
            loadKnocks();
          }}
        >
          <Ionicons name="refresh" size={24} color="#1e40af" />
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
    bottom: 80, // Above the tab bar
  },
  leftButtonStack: {
    position: 'absolute',
    left: 16,
    bottom: 80, // Above the tab bar
  },
  actionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)', // Almost opaque white
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
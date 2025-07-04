import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Alert, ActivityIndicator, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
// OPTIMIZATION: Use safer minified WebMap (20-30% smaller)
import WebMap from '../components/WebMapOptimizedSafe';
import { OPTIMIZATIONS } from '../config/optimization';
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

  // OPTIMIZATION: Memoize enabled storms
  const enabledStorms = useMemo(() => 
    activeStorms.filter(storm => storm.enabled),
    [activeStorms]
  );

  // OPTIMIZATION: Memoize daily stats calculation
  const dailyStats = useMemo(() => {
    const today = new Date().toDateString();
    const todayKnocks = knocks.filter(k => 
      new Date(k.timestamp).toDateString() === today
    );
    
    const outcomes = todayKnocks.reduce((acc, knock) => {
      acc[knock.outcome] = (acc[knock.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: todayKnocks.length,
      notHome: outcomes.not_home || 0,
      contact: (outcomes.convo || 0) + (outcomes.lead || 0) + (outcomes.sale || 0),
      rate: todayKnocks.length > 0 
        ? Math.round(((outcomes.convo || 0) + (outcomes.lead || 0) + (outcomes.sale || 0)) / todayKnocks.length * 100)
        : 0
    };
  }, [knocks]);

  // OPTIMIZATION: Debounced location update handler
  const updateUserLocation = useMemo(
    () => debounce((location: any) => {
      if (webMapRef.current) {
        console.log('[PHASE1] Debounced location update:', location);
        webMapRef.current.postMessage(JSON.stringify({
          type: 'updateUserLocation',
          lat: location.lat,
          lng: location.lng
        }));
      }
    }, OPTIMIZATIONS.USE_DEBOUNCED_LOCATION ? 1000 : 0), // 1 second debounce
    []
  );

  // Load knocks from storage based on optimization flags
  const loadKnocks = useCallback(async () => {
    try {
      if (OPTIMIZATIONS.USE_PROGRESSIVE_LOADING) {
        console.log('[PHASE2] Starting progressive knock loading...');
        const startTime = Date.now();
        
        // Stage 1: Recent knocks (immediate)
        const recent = await StorageService.getRecentKnocks(10);
        setKnocks(recent);
        const stage1Time = Date.now() - startTime;
        console.log(`[PHASE2] Stage 1 complete: ${recent.length} recent knocks in ${stage1Time}ms`);
        
        // Stage 2: Today's knocks
        setTimeout(async () => {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayKnocks = await StorageService.getKnocksByDateRange(todayStart, new Date());
          
          // Merge with existing, avoiding duplicates
          const knockMap = new Map([...recent, ...todayKnocks].map(k => [k.id, k]));
          const merged = Array.from(knockMap.values());
          setKnocks(merged);
          
          const stage2Time = Date.now() - startTime;
          console.log(`[PHASE2] Stage 2 complete: ${todayKnocks.length} today's knocks in ${stage2Time - stage1Time}ms`);
        }, 50);
        
        // Stage 3: This week's knocks
        setTimeout(async () => {
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - 7);
          const weekKnocks = await StorageService.getKnocksByDateRange(weekStart, new Date());
          
          // Merge with existing
          const existingIds = new Set(knocks.map(k => k.id));
          const newKnocks = weekKnocks.filter(k => !existingIds.has(k.id));
          if (newKnocks.length > 0) {
            setKnocks(prev => [...prev, ...newKnocks]);
          }
          
          const stage3Time = Date.now() - startTime;
          console.log(`[PHASE2] Stage 3 complete: ${weekKnocks.length} week's knocks in ${stage3Time}ms`);
        }, 150);
        
        // Stage 4: All historical + cloud sync
        setTimeout(async () => {
          const allKnocks = await StorageService.getKnocks(showCleared);
          setKnocks(allKnocks);
          
          const stage4Time = Date.now() - startTime;
          console.log(`[PHASE2] Stage 4 complete: ${allKnocks.length} total knocks in ${stage4Time}ms`);
          
          // Count cleared knocks
          if (!showCleared) {
            const clearedIds = await StorageService.getClearedKnocks();
            setClearedCount(clearedIds.length);
          }
          
          // Background cloud sync
          const cloudKnocks = await SupabaseService.getCloudKnocks();
          console.log(`[PHASE2] Cloud sync added ${cloudKnocks.length} knocks`);
          
          console.log(`[PHASE2] Total load time: ${Date.now() - startTime}ms`);
        }, 250);
        
      } else {
        // Original loading method
        const allKnocks = await StorageService.getKnocks(showCleared);
        setKnocks(allKnocks);
        
        // Count cleared knocks
        if (!showCleared) {
          const clearedIds = await StorageService.getClearedKnocks();
          setClearedCount(clearedIds.length);
        }
      }
    } catch (error) {
      console.error('Error loading knocks:', error);
    }
  }, [showCleared]);

  // Load saved notification logs
  const loadNotificationLogs = useCallback(async () => {
    try {
      const logs = await HailAlertService.getNotificationLog();
      // Logs are already loaded in HailAlertService
    } catch (error) {
      console.error('Error loading notification logs:', error);
    }
  }, []);

  const centerOnUser = useCallback(async () => {
    if (!userLocation || !webMapRef.current) return;
    
    webMapRef.current.postMessage(JSON.stringify({
      type: 'centerOnLocation',
      lat: userLocation.lat,
      lng: userLocation.lng,
      zoom: 18
    }));
  }, [userLocation]);

  const handleMapMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('WebView message:', data);
      
      switch (data.type) {
        case 'knockCreated':
          navigation.navigate('Knock', { 
            location: data.location,
            address: data.address 
          });
          break;
          
        case 'knockClicked':
          navigation.navigate('Knock', { 
            knock: data.knock,
            location: { 
              lat: data.knock.latitude, 
              lng: data.knock.longitude 
            },
            address: data.knock.address
          });
          break;
          
        case 'mapReady':
          console.log('Map ready, setting state');
          setMapReady(true);
          break;
          
        case 'stormClicked':
          if (data.stormId) {
            console.log('Storm clicked:', data.stormId);
            setShowStormPanel(true);
          }
          break;
          
        case 'error':
          console.error('WebView error:', data.message);
          Alert.alert('Map Error', data.message);
          break;
      }
    } catch (error) {
      console.error('Error handling map message:', error);
    }
  }, [navigation]);

  // Update map when knocks change - with differential updates
  useEffect(() => {
    if (!webMapRef.current || knocks.length === 0) return;
    
    if (OPTIMIZATIONS.USE_DIFFERENTIAL_UPDATES && mapReady) {
      // Calculate changes
      const changes = calculateKnockChanges(previousKnocksRef.current, knocks);
      
      if (changes.hasChanges) {
        console.log('[Differential] Sending changes:', {
          added: changes.added.length,
          updated: changes.updated.length,
          removed: changes.removed.length
        });
        
        webMapRef.current.postMessage(JSON.stringify({
          type: 'updateKnocksDifferential',
          changes: changes
        }));
        
        // Update reference
        previousKnocksRef.current = [...knocks];
      }
    } else {
      // Full update (first load or feature disabled)
      console.log('[Full Update] Sending all knocks:', knocks.length);
      webMapRef.current.postMessage(JSON.stringify({
        type: 'updateKnocks',
        knocks: knocks
      }));
      
      // Initialize reference for next time
      if (OPTIMIZATIONS.USE_DIFFERENTIAL_UPDATES) {
        previousKnocksRef.current = [...knocks];
      }
    }
  }, [knocks, mapReady]);

  // Update map when hail contours change
  useEffect(() => {
    if (!webMapRef.current || !hailContours) return;
    
    console.log('Sending hail contours to WebView');
    webMapRef.current.postMessage(JSON.stringify({
      type: 'updateHailContours',
      contours: hailContours
    }));
  }, [hailContours]);

  // Update map with verified reports as markers
  useEffect(() => {
    if (!webMapRef.current) return;
    
    console.log(`Sending ${verifiedReports.length} verified reports to WebView`);
    webMapRef.current.postMessage(JSON.stringify({
      type: 'updateVerifiedReports',
      reports: verifiedReports
    }));
  }, [verifiedReports]);

  // Initialize location and data on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      
      try {
        // Get location first
        const hasPermission = await LocationService.requestPermissions();
        if (hasPermission) {
          const location = await LocationService.getCurrentLocation();
          setUserLocation(location);
          updateUserLocation(location); // Debounced update
        }
        
        // Load knocks and hail data in parallel
        await Promise.all([
          loadKnocks(),
          loadHailData(),
          loadNotificationLogs(),
          initializeHailAlerts()
        ]);
      } catch (error) {
        console.error('Initialization error:', error);
      } finally {
        setLoading(false);
      }
    };
    
    init();
  }, [loadKnocks, loadHailData, loadNotificationLogs]);

  // Track location when screen is focused (with optimization)
  useEffect(() => {
    if (!isFocused || !OPTIMIZATIONS.USE_DEBOUNCED_LOCATION) return;
    
    let subscription: any = null;
    
    const trackLocation = async () => {
      if (DEV_DISABLE_GPS_UPDATES) {
        console.log('[DEV] GPS updates disabled in development mode');
        return;
      }
      
      const hasPermission = await LocationService.hasLocationPermission();
      if (hasPermission) {
        console.log('[OPTIMIZATION] Starting debounced location tracking');
        subscription = await LocationService.watchPosition(
          (location) => {
            setUserLocation(location);
            updateUserLocation(location); // This is now debounced
          },
          { enableHighAccuracy: true }
        );
      }
    };
    
    trackLocation();
    
    return () => {
      if (subscription) {
        console.log('[OPTIMIZATION] Stopping location tracking');
        subscription.remove();
      }
    };
  }, [isFocused, updateUserLocation]);

  // Initialize hail alerts
  const initializeHailAlerts = async () => {
    try {
      await HailAlertService.initialize();
      console.log('Hail alerts initialized');
    } catch (error) {
      console.error('Error initializing hail alerts:', error);
    }
  };

  // OPTIMIZATION: Memoize contour generation function with InteractionManager
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
    
    // PHASE 3 OPTIMIZATION: Move heavy computation to after interactions
    if (OPTIMIZATIONS.USE_BACKGROUND_CONTOURS) {
      console.log(`[PHASE3] Deferring contour generation for ${allReports.length} reports to background`);
      
      InteractionManager.runAfterInteractions(async () => {
        console.log('[PHASE3] Starting background contour generation');
        const startTime = Date.now();
        
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
        
        const endTime = Date.now();
        console.log(`[PHASE3] Contour generation completed in ${endTime - startTime}ms`);
        
        setHailContours(contourData);
        setIsGeneratingContours(false);
      });
    } else {
      // Original synchronous implementation
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
    }
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
        type: 'fitBounds',
        bounds: focusedStorm.bounds
      }));
      
      setShowStormPanel(false);
    }
  }, [loadHailData]);

  // Update knock from navigation params
  useEffect(() => {
    if (navigation.getState()?.routes) {
      const currentRoute = navigation.getState().routes[navigation.getState().index];
      if (currentRoute.params?.updatedKnock) {
        loadKnocks();
        
        // Update map in real-time if optimization is enabled
        if (OPTIMIZATIONS.USE_REAL_TIME_UPDATES && currentRoute.params.updatedKnock) {
          MapUpdateService.updateSingleKnock(currentRoute.params.updatedKnock);
        }
        
        // Clear the param to prevent re-processing
        navigation.setParams({ updatedKnock: null });
      }
    }
  }, [navigation, loadKnocks]);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#1e40af" />
        <Text style={{ marginTop: 10 }}>Loading map data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebMap
        ref={webMapRef}
        knocks={knocks}
        userLocation={userLocation}
        onMessage={handleMapMessage}
        testMode={false}
        hailData={hailData}
        activeStorms={activeStorms}
        onWebViewRef={(ref: any) => {
          webMapRef.current = ref;
          MapUpdateService.setWebViewRef(ref);
        }}
      />
      
      {/* Address Search Bar */}
      <AddressSearchBar onLocationSelected={(location) => {
        if (webMapRef.current) {
          webMapRef.current.postMessage(JSON.stringify({
            type: 'centerOnLocation',
            lat: location.lat,
            lng: location.lng,
            zoom: 18
          }));
        }
      }} />
      
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{dailyStats.total}</Text>
          <Text style={styles.statLabel}>Knocks</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{dailyStats.notHome}</Text>
          <Text style={styles.statLabel}>Not Home</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{dailyStats.contact}</Text>
          <Text style={styles.statLabel}>Contact</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{dailyStats.rate}%</Text>
          <Text style={styles.statLabel}>Rate</Text>
        </View>
      </View>
      
      {/* Hail Overlay Panel */}
      {showStormPanel && (
        <HailOverlay
          activeStorms={activeStorms}
          onToggleStorm={handleStormToggle}
          onDeleteStorm={handleStormDelete}
          onClose={() => setShowStormPanel(false)}
          onStormFocus={handleStormFocus}
        />
      )}
      
      {/* Notification Log Panel */}
      {showNotificationLog && (
        <NotificationLogPanel
          onClose={() => setShowNotificationLog(false)}
        />
      )}
      
      {/* Right Button Stack - Actions */}
      <View style={styles.rightButtonStack}>
        {/* New Knock Button */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => {
            if (userLocation) {
              navigation.navigate('Knock', { 
                location: userLocation,
                isNew: true 
              });
            }
          }}
        >
          <Ionicons name="add" size={32} color="#1e40af" />
        </TouchableOpacity>
        
        {/* Notification Log Button */}
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => setShowNotificationLog(!showNotificationLog)}
        >
          <Ionicons name="notifications" size={24} color="#1e40af" />
        </TouchableOpacity>
        
        {/* Hail Overlay Button */}
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
        
        {/* Test Phase 3 Button - Temporary */}
        {__DEV__ && (
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: '#fbbf24' }]} 
            onPress={async () => {
              console.log('[TEST] Triggering Phase 3 contour generation test');
              // Generate test hail reports
              const testReports: HailReport[] = Array.from({ length: 100 }, (_, i) => ({
                id: `test-${i}`,
                latitude: 35.4676 + (Math.random() - 0.5) * 0.2,
                longitude: -97.5164 + (Math.random() - 0.5) * 0.2,
                size: 0.5 + Math.random() * 2.5,
                city: 'Test City',
                groundTruth: i % 10 === 0,
                timestamp: new Date(),
                confidence: 70 + Math.random() * 30
              }));
              await generateContours(testReports);
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: 'bold' }}>P3</Text>
          </TouchableOpacity>
        )}
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
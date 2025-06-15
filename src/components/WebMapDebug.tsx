import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapDebugProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  hailContours?: any; // GeoJSON FeatureCollection
  activeStorms?: string[]; // IDs of storms to display
}

const WebMapDebug = React.forwardRef<WebView, WebMapDebugProps>(({ knocks, userLocation, onKnockClick, hailContours = null, activeStorms = [] }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addDebugLog = (message: string) => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    setDebugLogs(prev => [...prev, `[${timestamp}] ${message}`]);
    console.log(`[WebMapDebug] ${message}`);
  };

  // Log initial render
  useEffect(() => {
    addDebugLog(`Component mounted. hailContours: ${hailContours ? 'present' : 'null'}`);
    if (hailContours) {
      addDebugLog(`hailContours structure: ${JSON.stringify(hailContours, null, 2).substring(0, 200)}...`);
    }
  }, []);

  // Expose WebView methods to parent
  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  const mapHTML = React.useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; }
        #debug { 
          position: absolute; 
          top: 10px; 
          left: 10px; 
          background: rgba(255,255,255,0.9); 
          padding: 10px; 
          border-radius: 5px; 
          max-width: 300px; 
          max-height: 200px; 
          overflow-y: auto;
          font-size: 12px;
          font-family: monospace;
          z-index: 1000;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <div id="debug"></div>
      <script>
        var debugLog = function(message) {
          var debugEl = document.getElementById('debug');
          var timestamp = new Date().toTimeString().split(' ')[0];
          debugEl.innerHTML += '[' + timestamp + '] ' + message + '<br>';
          debugEl.scrollTop = debugEl.scrollHeight;
          
          // Also send to React Native
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'debug',
              message: message
            }));
          }
        };

        // Override console methods
        var originalLog = console.log;
        var originalError = console.error;
        
        console.log = function() {
          originalLog.apply(console, arguments);
          debugLog('LOG: ' + Array.from(arguments).join(' '));
        };
        
        console.error = function() {
          originalError.apply(console, arguments);
          debugLog('ERROR: ' + Array.from(arguments).join(' '));
        };

        debugLog('WebView loaded, waiting for Leaflet...');
        
        // Wait for Leaflet to load
        setTimeout(function() {
          if (typeof L === 'undefined') {
            debugLog('ERROR: Leaflet not loaded!');
            return;
          }
          
          debugLog('Leaflet loaded, initializing map...');
          
          try {
            var map = L.map('map').setView([35.4676, -97.5164], 13);
            debugLog('Map created');
            
            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            debugLog('Tile layer added');
            
            var hailContourLayer = null;
            
            // Function to update hail contours with extensive debugging
            window.updateHailContours = function(contourData) {
              debugLog('updateHailContours called');
              
              try {
                // Log data size
                var dataStr = JSON.stringify(contourData);
                debugLog('Data size: ' + dataStr.length + ' bytes');
                
                // Clear existing contours
                if (hailContourLayer) {
                  map.removeLayer(hailContourLayer);
                  hailContourLayer = null;
                  debugLog('Removed existing contour layer');
                }
                
                // Validate data
                if (!contourData) {
                  debugLog('No contour data provided');
                  return;
                }
                
                if (!contourData.type || contourData.type !== 'FeatureCollection') {
                  debugLog('Invalid GeoJSON: type is ' + contourData.type);
                  return;
                }
                
                if (!contourData.features) {
                  debugLog('No features array in contour data');
                  return;
                }
                
                debugLog('Features count: ' + contourData.features.length);
                
                // Log first feature for inspection
                if (contourData.features.length > 0) {
                  var firstFeature = contourData.features[0];
                  debugLog('First feature type: ' + firstFeature.type);
                  debugLog('First feature geometry type: ' + (firstFeature.geometry ? firstFeature.geometry.type : 'no geometry'));
                  debugLog('First feature properties: ' + JSON.stringify(firstFeature.properties));
                }
                
                // Create GeoJSON layer
                hailContourLayer = L.geoJSON(contourData, {
                  style: function(feature) {
                    debugLog('Styling feature with color: ' + feature.properties.color);
                    return {
                      fillColor: feature.properties.color || 'red',
                      fillOpacity: 0.4,
                      color: feature.properties.color || 'red',
                      weight: 2,
                      opacity: 0.8
                    };
                  },
                  onEachFeature: function(feature, layer) {
                    debugLog('Processing feature: ' + feature.properties.description);
                    layer.bindPopup(feature.properties.description || 'Hail Zone');
                  }
                });
                
                debugLog('GeoJSON layer created');
                
                // Add to map
                hailContourLayer.addTo(map);
                debugLog('Layer added to map');
                
                // Get bounds and fit map
                var bounds = hailContourLayer.getBounds();
                if (bounds.isValid()) {
                  map.fitBounds(bounds, { padding: [50, 50] });
                  debugLog('Map fitted to bounds');
                } else {
                  debugLog('Invalid bounds from contour layer');
                }
                
              } catch (error) {
                debugLog('ERROR in updateHailContours: ' + error.message);
                console.error(error);
              }
            };
            
            // Message listener
            window.addEventListener('message', function(event) {
              debugLog('Message received, length: ' + (event.data ? event.data.length : 0));
              
              try {
                var data = JSON.parse(event.data);
                debugLog('Parsed message type: ' + data.type);
                
                if (data.type === 'updateHailContours') {
                  debugLog('Processing hail contours update');
                  updateHailContours(data.contourData);
                }
              } catch (error) {
                debugLog('ERROR parsing message: ' + error.message);
              }
            });
            
            // Send ready message
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
              debugLog('Sent mapReady message');
            }
            
          } catch (error) {
            debugLog('ERROR initializing map: ' + error.message);
          }
        }, 1000);
      </script>
    </body>
    </html>
  `, []);

  // Handle hail contours update
  useEffect(() => {
    addDebugLog(`hailContours effect triggered. isLoading: ${isLoading}, has webViewRef: ${!!webViewRef.current}, has hailContours: ${!!hailContours}`);
    
    if (!isLoading && webViewRef.current && hailContours) {
      try {
        const message = JSON.stringify({
          type: 'updateHailContours',
          contourData: hailContours
        });
        
        addDebugLog(`Sending message to WebView. Size: ${message.length} bytes`);
        
        // Check message size
        if (message.length > 1000000) { // 1MB warning
          addDebugLog(`WARNING: Message size is large (${(message.length / 1024 / 1024).toFixed(2)} MB)`);
        }
        
        webViewRef.current.postMessage(message);
        addDebugLog('Message sent successfully');
      } catch (error: any) {
        addDebugLog(`ERROR sending message: ${error.message}`);
      }
    }
  }, [hailContours, isLoading]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'debug') {
        addDebugLog(`[WebView] ${data.message}`);
      } else if (data.type === 'mapReady') {
        addDebugLog('Map ready signal received');
        setIsLoading(false);
      }
    } catch (error: any) {
      addDebugLog(`ERROR handling message: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        style={styles.webView}
        onMessage={handleMessage}
        onError={(error) => {
          addDebugLog(`WebView error: ${JSON.stringify(error)}`);
          setIsLoading(false);
        }}
        onHttpError={(error) => {
          addDebugLog(`WebView HTTP error: ${JSON.stringify(error)}`);
        }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit={false}
        scrollEnabled={false}
        originWhitelist={['*']}
        mixedContentMode="compatibility"
      />
      
      {/* Debug panel */}
      <View style={styles.debugPanel}>
        <Text style={styles.debugTitle}>Debug Logs:</Text>
        <ScrollView style={styles.debugScroll}>
          {debugLogs.map((log, index) => (
            <Text key={index} style={styles.debugLog}>{log}</Text>
          ))}
        </ScrollView>
      </View>
      
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
    </View>
  );
});

export default WebMapDebug;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6b7280',
  },
  debugPanel: {
    position: 'absolute',
    bottom: 100,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 10,
    padding: 10,
    maxHeight: 200,
  },
  debugTitle: {
    color: 'white',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  debugScroll: {
    flex: 1,
  },
  debugLog: {
    color: '#00ff00',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
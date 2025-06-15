import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';
import { Ionicons } from '@expo/vector-icons';

interface WebMapProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
}

const WebMap = React.forwardRef<WebView, WebMapProps>(({ knocks, userLocation, onKnockClick }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script>
        // Wait a bit for Leaflet to load
        setTimeout(function() {
          if (typeof L !== 'undefined') {
            try {
              var map = L.map('map').setView([35.4676, -97.5164], 13);
              
              // Street view layer
              var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
              });
              
              // Satellite view layer
              var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              });
              
              // Add street layer by default
              streetLayer.addTo(map);
              
              // Add layer control with custom position
              var baseMaps = {
                "Street View": streetLayer,
                "Satellite View": satelliteLayer
              };
              L.control.layers(baseMaps, null, {
                position: 'topright'
              }).addTo(map);
              
              
              // Define colors and emojis
              var colors = {
                not_home: '#6b7280',
                inspected: '#3b82f6', 
                no_soliciting: '#ef4444',
                lead: '#10b981',
                sale: '#22c55e',
                callback: '#f59e0b',
                new_roof: '#8b5cf6',
                competitor: '#dc2626',
                renter: '#6366f1',
                poor_condition: '#78716c',
                proposal_left: '#0891b2',
                stay_away: '#991b1b',
                revisit: '#3b82f6',
                not_interested: '#991b1b'
              };
              
              var emojis = {
                not_home: '👻',
                inspected: '🪜',
                no_soliciting: '🚫',
                lead: '✅',
                sale: '📝',
                callback: '🔄',
                new_roof: '👼',
                competitor: '🏗️',
                renter: '🧟',
                poor_condition: '🏚️',
                proposal_left: '📋',
                stay_away: '👹',
                revisit: '👀',
                not_interested: '❌'
              };
              
              var markers = [];
              var userMarker = null;
              
              // Function to update knocks
              window.updateKnocks = function(knocksData) {
                // Clear existing markers
                markers.forEach(function(marker) {
                  map.removeLayer(marker);
                });
                markers = [];
                
                // Add each knock
                knocksData.forEach(function(knock) {
                  var color = colors[knock.outcome] || '#6b7280';
                  var emoji = emojis[knock.outcome] || '📍';
                  
                  var icon = L.divIcon({
                    html: '<div style="background-color: ' + color + '; width: 36px; height: 36px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 20px;">' + emoji + '</div>',
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
                  });
                  
                  var popupContent = '<div style="font-size: 14px;"><h4 style="margin: 0 0 8px 0; color: #1e40af;">' + emoji + ' ' + knock.outcome.replace(/_/g, ' ').toUpperCase() + '</h4>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Address:</strong> ' + (knock.address || 'No address') + '</p>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Time:</strong> ' + new Date(knock.timestamp).toLocaleString() + '</p>';
                  if (knock.notes) {
                    popupContent += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><strong>Notes:</strong><br>' + knock.notes.replace(/\\n/g, '<br>') + '</div>';
                  }
                  popupContent += '</div>';
                  
                  var marker = L.marker([knock.latitude, knock.longitude], {icon: icon})
                    .bindPopup(popupContent)
                    .addTo(map);
                    
                  markers.push(marker);
                });
              };
              
              // Function to update user location
              window.updateUserLocation = function(lat, lng) {
                if (userMarker) {
                  userMarker.setLatLng([lat, lng]);
                } else {
                  var userIcon = L.divIcon({
                    html: '<div style="width: 16px; height: 16px; background-color: #3b82f6; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"><div style="width: 40px; height: 40px; background-color: rgba(59, 130, 246, 0.2); border-radius: 50%; position: absolute; top: -12px; left: -12px; animation: pulse 2s infinite;"></div></div>',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                  });
                  userMarker = L.marker([lat, lng], {icon: userIcon}).addTo(map);
                }
              };
              
              // Function to center on user
              window.centerOnUser = function() {
                if (userMarker) {
                  map.setView(userMarker.getLatLng(), 16);
                }
              };
              
              // Add map click handler for creating new knocks
              map.on('click', function(e) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'mapClick',
                    lat: e.latlng.lat,
                    lng: e.latlng.lng
                  }));
                }
              });
              
              // Add initial data
              ${knocks.length > 0 ? `updateKnocks(${JSON.stringify(knocks)});` : ''}
              ${userLocation ? `updateUserLocation(${userLocation.lat}, ${userLocation.lng});` : ''}
              
              // Listen for messages from React Native
              window.addEventListener('message', function(event) {
                try {
                  var data = JSON.parse(event.data);
                  if (data.type === 'updateKnocks') {
                    updateKnocks(data.knocks);
                  } else if (data.type === 'updateUserLocation') {
                    updateUserLocation(data.lat, data.lng);
                  } else if (data.type === 'centerOnUser') {
                    centerOnUser();
                  }
                } catch (e) {
                  console.error('Message error:', e);
                }
              });
              
              // Add custom styles
              var style = document.createElement('style');
              style.textContent = '@keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2); opacity: 0; } } .leaflet-top.leaflet-right { top: 80px !important; }';
              document.head.appendChild(style);
              
              // Send ready message
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
              }
            } catch (e) {
              document.body.innerHTML = '<div style="padding: 20px;">Error: ' + e.message + '</div>';
            }
          } else {
            document.body.innerHTML = '<div style="padding: 20px;">Leaflet failed to load. Try refreshing.</div>';
          }
        }, 2000);
      </script>
    </body>
    </html>
  `, []);

  useEffect(() => {
    if (!isLoading && webViewRef.current) {
      // Send knocks data to map
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateKnocks',
        knocks: knocks
      }));
    }
  }, [knocks, isLoading]);

  useEffect(() => {
    if (!isLoading && webViewRef.current && userLocation) {
      // Send user location to map
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateUserLocation',
        lat: userLocation.lat,
        lng: userLocation.lng
      }));
    }
  }, [userLocation, isLoading]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapReady') {
        setIsLoading(false);
        setLoadError(false);
      } else if (data.type === 'mapClick') {
        // Handle map click - pass to parent if handler provided
        if (onKnockClick) {
          onKnockClick({
            id: '',
            latitude: data.lat,
            longitude: data.lng,
            address: '',
            outcome: 'not_home',
            timestamp: new Date(),
            notes: '',
            syncStatus: 'pending'
          } as Knock);
        }
      }
    } catch (error) {
      console.error('WebMap message error:', error);
    }
  };

  // Force hide loading after 3 seconds
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 3000);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        style={styles.webView}
        onMessage={handleMessage}
        onError={(error) => {
          console.error('WebView error:', error);
          setLoadError(true);
          setIsLoading(false);
        }}
        onHttpError={(error) => {
          console.error('WebView HTTP error:', error);
        }}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit={false}
        scrollEnabled={false}
        originWhitelist={['*']}
        mixedContentMode="compatibility"
      />
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
    </View>
  );
});

export default WebMap;

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
});
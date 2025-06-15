import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  hailContours?: any; // GeoJSON FeatureCollection
  activeStorms?: string[];
  onContourLoadStatus?: (status: 'loading' | 'success' | 'error', message?: string) => void;
}

const WebMapFixed = React.forwardRef<WebView, WebMapProps>(({ 
  knocks, 
  userLocation, 
  onKnockClick, 
  hailContours = null, 
  activeStorms = [],
  onContourLoadStatus 
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);

  // Expose WebView methods to parent
  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  // Send message to WebView with queuing
  const sendMessage = (message: any) => {
    if (isMapReady && webViewRef.current) {
      console.log('Sending message to WebView:', message.type);
      webViewRef.current.postMessage(JSON.stringify(message));
    } else {
      console.log('Queuing message for later:', message.type);
      setPendingMessages(prev => [...prev, message]);
    }
  };

  // Process pending messages when map becomes ready
  useEffect(() => {
    if (isMapReady && pendingMessages.length > 0) {
      console.log(`Processing ${pendingMessages.length} pending messages`);
      pendingMessages.forEach(msg => {
        webViewRef.current?.postMessage(JSON.stringify(msg));
      });
      setPendingMessages([]);
    }
  }, [isMapReady, pendingMessages]);

  // Update knocks
  useEffect(() => {
    sendMessage({
      type: 'updateKnocks',
      knocks: knocks
    });
  }, [knocks]);

  // Update user location
  useEffect(() => {
    if (userLocation) {
      sendMessage({
        type: 'updateUserLocation',
        lat: userLocation.lat,
        lng: userLocation.lng
      });
    }
  }, [userLocation]);

  // Update hail contours with status callback
  useEffect(() => {
    if (hailContours) {
      onContourLoadStatus?.('loading');
      sendMessage({
        type: 'updateHailContours',
        contourData: hailContours
      });
    }
  }, [hailContours]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      switch (data.type) {
        case 'mapReady':
          console.log('Map is ready!');
          setIsMapReady(true);
          break;
          
        case 'contoursLoaded':
          console.log('Contours loaded successfully');
          onContourLoadStatus?.('success', `Loaded ${data.count} contour zones`);
          break;
          
        case 'contoursError':
          console.error('Contours loading error:', data.error);
          onContourLoadStatus?.('error', data.error);
          break;
          
        case 'mapClick':
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
          break;
          
        case 'editKnock':
          const knock = knocks.find(k => k.id === data.knockId);
          if (knock && onKnockClick) {
            onKnockClick(knock);
          }
          break;
          
        case 'consoleLog':
          console.log('[WebView]:', data.message);
          break;
      }
    } catch (error) {
      console.error('WebMap message error:', error);
    }
  };

  const mapHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; }
        #map { height: 100vh; width: 100vw; }
        @keyframes pulse { 
          0% { transform: scale(1); opacity: 1; } 
          100% { transform: scale(2); opacity: 0; } 
        }
        .leaflet-control-layers { 
          position: fixed !important; 
          right: 16px !important; 
          bottom: 240px !important; 
          top: auto !important; 
          margin: 0 !important; 
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        // Forward console logs to React Native
        const originalLog = console.log;
        console.log = function(...args) {
          originalLog.apply(console, args);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'consoleLog',
              message: args.join(' ')
            }));
          }
        };

        // Initialize map
        var map = L.map('map').setView([35.4676, -97.5164], 10);
        
        // Add map layers
        var streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        });
        
        var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: '© Esri'
        });
        
        streetLayer.addTo(map);
        
        // Add layer control
        L.control.layers({
          "Street": streetLayer,
          "Satellite": satelliteLayer
        }).addTo(map);
        
        // Initialize variables
        var markers = [];
        var userMarker = null;
        var hailContourLayer = null;
        
        // Outcome colors and emojis
        var colors = {
          not_home: '#9ca3af',
          not_interested: '#ef4444',
          no_soliciting: '#f97316',
          callback: '#eab308',
          follow_up: '#22d3ee',
          lead: '#22c55e',
          sale: '#3b82f6',
          signed: '#3b82f6',
          new_roof: '#e11d48',
          competitor: '#8b5cf6',
          renter: '#64748b',
          poor_condition: '#78716c',
          proposal_left: '#06b6d4',
          stay_away: '#dc2626',
          revisit: '#f59e0b',
          convo: '#8b5cf6',
          inspected: '#22d3ee'
        };
        
        var emojis = {
          not_home: '👻',
          not_interested: '❌',
          no_soliciting: '🚫',
          callback: '📞',
          follow_up: '🔄',
          lead: '✅',
          sale: '💰',
          signed: '📝',
          new_roof: '👼',
          competitor: '🏗️',
          renter: '🧟',
          poor_condition: '🏚️',
          proposal_left: '📋',
          stay_away: '👹',
          revisit: '👀',
          convo: '💬',
          inspected: '🪜'
        };
        
        // Update functions
        window.updateKnocks = function(knocksData) {
          markers.forEach(function(marker) {
            map.removeLayer(marker);
          });
          markers = [];
          
          knocksData.forEach(function(knock) {
            var color = colors[knock.outcome] || '#6b7280';
            var emoji = emojis[knock.outcome] || '📍';
            
            var icon = L.divIcon({
              html: '<div style="background-color: ' + color + '; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 14px;">' + emoji + '</div>',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
              className: 'custom-div-icon'
            });
            
            var marker = L.marker([knock.latitude, knock.longitude], {icon: icon})
              .bindPopup(createKnockPopup(knock))
              .addTo(map);
              
            markers.push(marker);
          });
        };
        
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
        
        window.updateHailContours = function(contourData) {
          console.log('updateHailContours called');
          
          try {
            // Clear existing contours
            if (hailContourLayer) {
              map.removeLayer(hailContourLayer);
              hailContourLayer = null;
            }
            
            if (!contourData || !contourData.features || contourData.features.length === 0) {
              console.log('No contour features to display');
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'contoursError',
                error: 'No contour data available'
              }));
              return;
            }
            
            console.log('Adding ' + contourData.features.length + ' contour features');
            
            // Add contour layer
            hailContourLayer = L.geoJSON(contourData, {
              style: function(feature) {
                return {
                  fillColor: feature.properties.color,
                  fillOpacity: 0.4,
                  color: feature.properties.color,
                  weight: 2,
                  opacity: 0.8
                };
              },
              onEachFeature: function(feature, layer) {
                var props = feature.properties;
                var popupContent = '<div style="font-size: 14px;">';
                popupContent += '<h4 style="margin: 0 0 8px 0; color: ' + props.color + ';">Hail Zone</h4>';
                popupContent += '<p style="margin: 4px 0;"><strong>Size:</strong> ' + props.level.toFixed(1) + '"+ hail</p>';
                popupContent += '<p style="margin: 4px 0;"><strong>Description:</strong> ' + props.description + '</p>';
                popupContent += '<p style="margin: 4px 0; font-style: italic; color: #6b7280;">Click anywhere in this zone to start canvassing</p>';
                popupContent += '</div>';
                
                layer.bindPopup(popupContent);
              }
            }).addTo(map);
            
            // Bring to back so markers are on top
            hailContourLayer.bringToBack();
            
            // Notify success
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'contoursLoaded',
              count: contourData.features.length
            }));
            
          } catch (error) {
            console.error('Error loading contours:', error);
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'contoursError',
              error: error.message
            }));
          }
        };
        
        window.centerOnUser = function() {
          if (userMarker) {
            map.setView(userMarker.getLatLng(), 16);
          }
        };
        
        // Helper function for knock popups
        function createKnockPopup(knock) {
          var emoji = emojis[knock.outcome] || '📍';
          var popupContent = '<div style="font-size: 14px;"><h4 style="margin: 0 0 8px 0; color: #1e40af;">' + emoji + ' ' + knock.outcome.replace(/_/g, ' ').toUpperCase() + '</h4>';
          popupContent += '<p style="margin: 4px 0;"><strong>Address:</strong> ' + (knock.address || 'Unknown') + '</p>';
          popupContent += '<p style="margin: 4px 0;"><strong>Time:</strong> ' + new Date(knock.timestamp).toLocaleString() + '</p>';
          if (knock.notes) {
            popupContent += '<p style="margin: 4px 0;"><strong>Notes:</strong> ' + knock.notes + '</p>';
          }
          if (knock.history && knock.history.length > 0) {
            popupContent += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;">';
            popupContent += '<p style="margin: 4px 0; font-weight: bold;">History:</p>';
            knock.history.forEach(function(h) {
              var historyEmoji = emojis[h.outcome] || '📍';
              popupContent += '<p style="margin: 2px 0; font-size: 12px;">' + historyEmoji + ' ' + h.outcome + ' - ' + new Date(h.timestamp).toLocaleDateString() + '</p>';
            });
            popupContent += '</div>';
          }
          popupContent += '<button onclick="editKnock(\'' + knock.id + '\')" style="margin-top: 8px; padding: 4px 8px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer;">Edit</button>';
          popupContent += '</div>';
          return popupContent;
        }
        
        window.editKnock = function(knockId) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'editKnock',
              knockId: knockId
            }));
          }
        };
        
        // Map click handler
        map.on('click', function(e) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'mapClick',
              lat: e.latlng.lat,
              lng: e.latlng.lng
            }));
          }
        });
        
        // Message listener
        window.addEventListener('message', function(event) {
          try {
            var data = JSON.parse(event.data);
            switch (data.type) {
              case 'updateKnocks':
                updateKnocks(data.knocks);
                break;
              case 'updateUserLocation':
                updateUserLocation(data.lat, data.lng);
                break;
              case 'centerOnUser':
                centerOnUser();
                break;
              case 'updateHailContours':
                updateHailContours(data.contourData);
                break;
            }
          } catch (e) {
            console.error('Message error:', e);
          }
        });
        
        // Send ready message
        setTimeout(function() {
          if (window.ReactNativeWebView) {
            console.log('Sending mapReady message');
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
          }
        }, 100);
      </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        style={styles.webView}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1e40af" />
            <Text style={styles.loadingText}>Loading map...</Text>
          </View>
        )}
      />
      {!isMapReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1e40af" />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
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
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    pointerEvents: 'none',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6b7280',
  },
});

export default WebMapFixed;
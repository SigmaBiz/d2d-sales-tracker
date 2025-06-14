import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
}

export default function WebMap({ knocks, userLocation, onKnockClick }: WebMapProps) {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

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
        .knock-popup {
          font-size: 14px;
        }
        .knock-popup h4 {
          margin: 0 0 8px 0;
          color: #1e40af;
        }
        .knock-popup p {
          margin: 4px 0;
          color: #4b5563;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        // Initialize map
        const map = L.map('map').setView([35.4676, -97.5164], 13); // Default to OKC
        
        // Add OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(map);
        
        // Marker colors and emojis based on outcome
        const markerData = {
          // Primary outcomes
          not_home: { color: '#6b7280', emoji: '👻' },
          revisit: { color: '#3b82f6', emoji: '👀' },
          no_soliciting: { color: '#ef4444', emoji: '🚫' },
          lead: { color: '#10b981', emoji: '✅' },
          sale: { color: '#22c55e', emoji: '📝' },
          callback: { color: '#f59e0b', emoji: '🔄' },
          // Property status
          new_roof: { color: '#8b5cf6', emoji: '🏠' },
          competitor: { color: '#dc2626', emoji: '🚧' },
          renter: { color: '#6366f1', emoji: '🔑' },
          poor_condition: { color: '#78716c', emoji: '🏚️' },
          // Action taken
          proposal_left: { color: '#0891b2', emoji: '📋' },
          stay_away: { color: '#991b1b', emoji: '⚠️' },
          // Legacy
          not_interested: { color: '#991b1b', emoji: '❌' }
        };
        
        // Custom icon creator with emoji
        function createIcon(color, emoji) {
          return L.divIcon({
            className: 'custom-marker',
            html: '<div style="background-color: ' + color + '; width: 36px; height: 36px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 20px;">' + emoji + '</div>',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
          });
        }
        
        let markers = [];
        let userMarker = null;
        
        // Function to update knocks
        function updateKnocks(knocksData) {
          // Clear existing markers
          markers.forEach(marker => map.removeLayer(marker));
          markers = [];
          
          // Add knock markers
          knocksData.forEach(knock => {
            const data = markerData[knock.outcome] || { color: '#6b7280', emoji: '❓' };
            const marker = L.marker([knock.latitude, knock.longitude], {
              icon: createIcon(data.color, data.emoji)
            });
            
            // Format time
            const date = new Date(knock.timestamp);
            const timeAgo = getTimeAgo(date);
            
            // Create popup content
            const popupContent = 
              '<div class="knock-popup">' +
              '<h4>' + knock.outcome.replace('_', ' ').toUpperCase() + '</h4>' +
              '<p><strong>Address:</strong> ' + (knock.address || 'No address') + '</p>' +
              '<p><strong>Time:</strong> ' + timeAgo + '</p>' +
              (knock.notes ? '<p><strong>Notes:</strong> ' + knock.notes + '</p>' : '') +
              '</div>';
            
            marker.bindPopup(popupContent);
            marker.addTo(map);
            markers.push(marker);
          });
          
          // Fit map to show all markers
          if (markers.length > 0) {
            const group = L.featureGroup(markers);
            map.fitBounds(group.getBounds().pad(0.1));
          }
        }
        
        // Function to update user location
        function updateUserLocation(lat, lng) {
          if (userMarker) {
            userMarker.setLatLng([lat, lng]);
          } else {
            userMarker = L.marker([lat, lng], {
              icon: L.divIcon({
                className: 'user-location',
                html: '<div style="width: 16px; height: 16px; background-color: #3b82f6; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); position: relative;"><div style="width: 40px; height: 40px; background-color: rgba(59, 130, 246, 0.2); border-radius: 50%; position: absolute; top: -15px; left: -15px; animation: pulse 2s infinite;"></div></div>',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
              })
            });
            userMarker.addTo(map);
          }
          
          // Center on user if this is the first location update
          if (!window.hasInitialLocation) {
            map.setView([lat, lng], 16);
            window.hasInitialLocation = true;
          }
        }
        
        // Helper function for time ago
        function getTimeAgo(date) {
          const now = new Date();
          const diffMs = now - date;
          const diffMins = Math.floor(diffMs / 60000);
          
          if (diffMins < 1) return 'Just now';
          if (diffMins < 60) return diffMins + ' min ago';
          const diffHours = Math.floor(diffMins / 60);
          if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
          const diffDays = Math.floor(diffHours / 24);
          return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
        }
        
        // Add CSS animation for pulse
        const style = document.createElement('style');
        style.textContent = '@keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }';
        document.head.appendChild(style);
        
        // Listen for messages from React Native
        window.addEventListener('message', (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'updateKnocks') {
            updateKnocks(data.knocks);
          } else if (data.type === 'updateUserLocation') {
            updateUserLocation(data.lat, data.lng);
          }
        });
        
        // Signal that map is ready
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
      </script>
    </body>
    </html>
  `;

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
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'mapReady') {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        style={styles.webView}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        scalesPageToFit={false}
        scrollEnabled={false}
      />
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}
    </View>
  );
}

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
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6b7280',
  },
});
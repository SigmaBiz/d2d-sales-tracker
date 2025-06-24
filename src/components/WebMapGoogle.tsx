import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapGoogleProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  hailContours?: any;
  activeStorms?: string[];
  verifiedReports?: any[];
  googleApiKey: string;
}

const WebMapGoogle = React.forwardRef<WebView, WebMapGoogleProps>(({ 
  knocks, 
  userLocation, 
  onKnockClick, 
  hailContours = null, 
  activeStorms = [], 
  verifiedReports = [],
  googleApiKey 
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Expose WebView methods to parent
  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  const mapHTML = React.useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <script src="https://maps.googleapis.com/maps/api/js?key=${googleApiKey}&libraries=places"></script>
      <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #map { height: 100vh; width: 100vw; }
        #search-container {
          position: absolute;
          top: 10px;
          left: 10px;
          right: 10px;
          z-index: 1000;
        }
        #search-box {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          font-size: 16px;
          border: none;
          border-radius: 8px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          outline: none;
        }
        .map-type-btn {
          position: absolute;
          bottom: 120px;
          right: 10px;
          background: white;
          border: none;
          border-radius: 8px;
          padding: 10px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          cursor: pointer;
          font-size: 14px;
          z-index: 1000;
        }
        .center-btn {
          position: absolute;
          bottom: 170px;
          right: 10px;
          background: white;
          border: none;
          border-radius: 8px;
          padding: 10px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          cursor: pointer;
          font-size: 20px;
          z-index: 1000;
          width: 42px;
          height: 42px;
        }
      </style>
    </head>
    <body>
      <div id="search-container">
        <input id="search-box" type="text" placeholder="Search address...">
      </div>
      <button class="center-btn" onclick="centerOnUser()">📍</button>
      <button class="map-type-btn" onclick="toggleMapType()">🛰️</button>
      <div id="map"></div>
      <script>
        let map;
        let markers = [];
        let userMarker = null;
        let userAccuracyCircle = null;
        let searchBox;
        let currentMapType = 'roadmap';
        let hailPolygons = [];
        let verifiedMarkers = [];
        
        // Error handler
        window.onerror = function(msg, url, lineNo, columnNo, error) {
          console.error('Error: ' + msg + '\\nURL: ' + url + '\\nLine: ' + lineNo);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'error',
              message: msg,
              url: url,
              line: lineNo
            }));
          }
          return false;
        };
        
        // Colors and emojis for knock outcomes
        const colors = {
          not_home: '#6b7280',
          convo: '#3b82f6',
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
        
        const emojis = {
          not_home: '👻',
          inspected: '🪜',
          no_soliciting: '🚫',
          lead: '✅',
          sale: '📝',
          callback: '🔄',
          convo: '💬',
          new_roof: '👼',
          competitor: '🏗️',
          renter: '🧟',
          poor_condition: '🏚️',
          proposal_left: '📋',
          stay_away: '👹',
          revisit: '👀',
          not_interested: '❌'
        };
        
        // Initialize map
        function initMap() {
          // Check if Google Maps loaded
          if (typeof google === 'undefined' || !google.maps) {
            console.error('Google Maps API not loaded');
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'error',
                message: 'Google Maps API failed to load. Please check your API key and enabled APIs.'
              }));
            }
            document.getElementById('map').innerHTML = '<div style="padding: 20px; text-align: center;">Google Maps failed to load. Please check API key.</div>';
            return;
          }
          
          const initialLat = ${userLocation ? userLocation.lat : 35.4676};
          const initialLng = ${userLocation ? userLocation.lng : -97.5164};
          
          map = new google.maps.Map(document.getElementById('map'), {
            zoom: 16,
            center: { lat: initialLat, lng: initialLng },
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
            zoomControl: true,
            maxZoom: 21,  // Maximum zoom for individual houses
            mapTypeId: 'roadmap'
          });
          
          // Set up address search
          const input = document.getElementById('search-box');
          searchBox = new google.maps.places.SearchBox(input);
          
          // Bias search results to current map bounds
          map.addListener('bounds_changed', () => {
            searchBox.setBounds(map.getBounds());
          });
          
          // Handle place selection
          searchBox.addListener('places_changed', () => {
            const places = searchBox.getPlaces();
            if (places.length === 0) return;
            
            const place = places[0];
            if (place.geometry.viewport) {
              map.fitBounds(place.geometry.viewport);
            } else {
              map.setCenter(place.geometry.location);
              map.setZoom(20);
            }
          });
          
          // Click to get address
          map.addListener('click', (event) => {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: event.latLng }, (results, status) => {
              if (status === 'OK' && results[0]) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'mapClick',
                  address: results[0].formatted_address,
                  latitude: event.latLng.lat(),
                  longitude: event.latLng.lng()
                }));
              }
            });
          });
          
          // Send ready message
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'mapReady'
          }));
        }
        
        // Toggle between roadmap and satellite
        window.toggleMapType = function() {
          currentMapType = currentMapType === 'roadmap' ? 'satellite' : 'roadmap';
          map.setMapTypeId(currentMapType);
          document.querySelector('.map-type-btn').textContent = currentMapType === 'roadmap' ? '🛰️' : '🗺️';
        };
        
        // Update knock markers
        window.updateKnocks = function(knocksData) {
          // Clear existing markers
          markers.forEach(marker => marker.setMap(null));
          markers = [];
          
          knocksData.forEach(knock => {
            const color = colors[knock.outcome] || '#6b7280';
            const emoji = emojis[knock.outcome] || '📍';
            
            const marker = new google.maps.Marker({
              position: { lat: knock.latitude, lng: knock.longitude },
              map: map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 0
              }
            });
            
            // Create custom overlay for emoji marker
            const overlay = new google.maps.OverlayView();
            overlay.onAdd = function() {
              const div = document.createElement('div');
              div.style.position = 'absolute';
              div.innerHTML = '<div style="background-color: ' + color + '; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer;">' + emoji + '</div>';
              
              div.onclick = () => {
                showKnockInfo(knock);
              };
              
              this.div = div;
              const panes = this.getPanes();
              panes.overlayMouseTarget.appendChild(div);
            };
            
            overlay.draw = function() {
              const projection = this.getProjection();
              const position = projection.fromLatLngToDivPixel(marker.getPosition());
              const div = this.div;
              div.style.left = (position.x - 12) + 'px';
              div.style.top = (position.y - 12) + 'px';
            };
            
            overlay.onRemove = function() {
              this.div.parentNode.removeChild(this.div);
            };
            
            overlay.setMap(map);
            markers.push(overlay);
          });
        };
        
        // Show knock info
        function showKnockInfo(knock) {
          const emoji = emojis[knock.outcome] || '📍';
          let content = '<div style="font-size: 14px; min-width: 200px;">';
          content += '<h4 style="margin: 0 0 8px 0; color: #1e40af;">' + emoji + ' ' + knock.outcome.replace(/_/g, ' ').toUpperCase() + '</h4>';
          content += '<p style="margin: 4px 0;"><strong>Address:</strong> ' + (knock.address || 'Tap to get address') + '</p>';
          content += '<p style="margin: 4px 0;"><strong>Time:</strong> ' + new Date(knock.timestamp).toLocaleString() + '</p>';
          
          if (knock.notes) {
            content += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><strong>Notes:</strong><br>' + knock.notes.replace(/\\n/g, '<br>') + '</div>';
          }
          
          content += '<div style="margin-top: 10px;"><button onclick="window.editKnock(\\\'' + knock.id + '\\\')" style="background-color: #1e40af; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer;">Edit</button></div>';
          content += '</div>';
          
          const infoWindow = new google.maps.InfoWindow({
            content: content,
            position: { lat: knock.latitude, lng: knock.longitude }
          });
          
          infoWindow.open(map);
        }
        
        // Update user location
        window.updateUserLocation = function(lat, lng) {
          console.log('updateUserLocation called with:', lat, lng);
          const position = { lat, lng };
          
          if (userMarker) {
            userMarker.setPosition(position);
            if (userAccuracyCircle) {
              userAccuracyCircle.setCenter(position);
            }
          } else {
            // Create accuracy circle (light blue pulse effect)
            userAccuracyCircle = new google.maps.Circle({
              center: position,
              radius: 50, // 50 meters
              strokeColor: '#3b82f6',
              strokeOpacity: 0.3,
              strokeWeight: 1,
              fillColor: '#3b82f6',
              fillOpacity: 0.15,
              map: map,
              zIndex: 999
            });
            
            // Create the main marker
            userMarker = new google.maps.Marker({
              position: position,
              map: map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#3b82f6',
                fillOpacity: 1,
                strokeColor: 'white',
                strokeWeight: 3
              },
              zIndex: 9999,
              title: 'Your Location'
            });
            console.log('Created userMarker at:', lat, lng);
          }
        };
        
        // Center on user location
        window.centerOnUser = function() {
          console.log('centerOnUser called, userMarker:', userMarker);
          if (userMarker) {
            const position = userMarker.getPosition();
            console.log('Centering on position:', position.lat(), position.lng());
            map.panTo(position);
            if (map.getZoom() < 18) {
              map.setZoom(18);
            }
          } else {
            console.log('No userMarker available');
            // If no user marker, try to use the initial location
            const initialLat = ${userLocation ? userLocation.lat : 35.4676};
            const initialLng = ${userLocation ? userLocation.lng : -97.5164};
            map.panTo({ lat: initialLat, lng: initialLng });
            map.setZoom(18);
          }
        };
        
        // Edit knock handler
        window.editKnock = function(knockId) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'editKnock',
            knockId: knockId
          }));
        };
        
        // Update hail contours
        window.updateHailContours = function(contours) {
          // Clear existing polygons
          hailPolygons.forEach(polygon => polygon.setMap(null));
          hailPolygons = [];
          
          if (!contours || !contours.features) {
            return;
          }
          
          contours.features.forEach((feature, index) => {
            if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
              try {
                const fillColor = feature.properties.color || '#FF0000';
                const strokeColor = feature.properties.color || '#FF0000';
                
                // Handle both Polygon and MultiPolygon types
                let polygonGroups = [];
                
                if (feature.geometry.type === 'Polygon') {
                  // Single polygon
                  polygonGroups = [feature.geometry.coordinates];
                } else if (feature.geometry.type === 'MultiPolygon') {
                  // Multiple polygons
                  polygonGroups = feature.geometry.coordinates;
                }
                
                // Process each polygon group
                polygonGroups.forEach((polygonCoords, groupIdx) => {
                  // For MultiPolygon, each group can have multiple rings (outer + holes)
                  // For Polygon, this is just the single polygon's rings
                  const outerRing = polygonCoords[0]; // First ring is always the outer boundary
                  
                  if (!outerRing || !Array.isArray(outerRing)) {
                    return;
                  }
                  
                  // Create path for outer ring
                  const paths = [];
                  outerRing.forEach((coord) => {
                    if (Array.isArray(coord) && coord.length >= 2) {
                      paths.push(new google.maps.LatLng(coord[1], coord[0]));
                    }
                  });
                  
                  if (paths.length < 3) {
                    return;
                  }
                  
                  const polygon = new google.maps.Polygon({
                    paths: paths,
                    strokeColor: strokeColor,
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    fillColor: fillColor,
                    fillOpacity: 0.3,
                    map: map
                  });
                  
                  // Store bounds for later use
                  polygon.bounds = paths;
                  
                  // Add click handler for info
                  polygon.addListener('click', function(event) {
                    const infoWindow = new google.maps.InfoWindow({
                      content: '<div style="font-size: 14px;"><strong>Hail Zone</strong><br>' +
                               'Size Range: ' + feature.properties.description + '</div>',
                      position: event.latLng
                    });
                    infoWindow.open(map);
                  });
                  
                  hailPolygons.push(polygon);
                });
              } catch (error) {
                console.error('Error creating polygon', index, ':', error);
              }
            }
          });
        };
        
        // Update verified reports
        window.updateVerifiedReports = function(reports) {
          verifiedMarkers.forEach(marker => marker.setMap(null));
          verifiedMarkers = [];
          
          reports.forEach(report => {
            const marker = new google.maps.Marker({
              position: { lat: report.latitude, lng: report.longitude },
              map: map,
              icon: {
                url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="white" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="12">H</text></svg>'),
                scaledSize: new google.maps.Size(24, 24)
              },
              title: 'Hail Size: ' + report.size + '"'
            });
            
            verifiedMarkers.push(marker);
          });
        };
        
        // Send console messages to React Native
        const originalLog = console.log;
        console.log = function() {
          originalLog.apply(console, arguments);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'console',
              message: Array.from(arguments).join(' ')
            }));
          }
        };
        
        // Handle messages from React Native
        window.addEventListener('message', function(event) {
          try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
              case 'centerOnUser':
                centerOnUser();
                break;
                
              case 'focusOnHail':
                if (hailPolygons.length > 0) {
                  const bounds = new google.maps.LatLngBounds();
                  hailPolygons.forEach(polygon => {
                    if (polygon.bounds) {
                      polygon.bounds.forEach(latlng => {
                        bounds.extend(latlng);
                      });
                    }
                  });
                  map.fitBounds(bounds);
                }
                break;
                
              case 'focusOnBounds':
                if (data.bounds) {
                  const bounds = new google.maps.LatLngBounds(
                    new google.maps.LatLng(data.bounds.south, data.bounds.west),
                    new google.maps.LatLng(data.bounds.north, data.bounds.east)
                  );
                  map.fitBounds(bounds);
                }
                break;
                
              case 'toggleMapType':
                toggleMapType();
                break;
                
              case 'centerOnLocation':
                if (data.lat && data.lng) {
                  map.setCenter({ lat: data.lat, lng: data.lng });
                  if (data.zoom) {
                    map.setZoom(data.zoom);
                  }
                }
                break;
                
              case 'updateHailContours':
                updateHailContours(data.contourData);
                break;
                
              case 'updateVerifiedReports':
                updateVerifiedReports(data.reports || []);
                break;
            }
          } catch (e) {
            console.error('Message parsing error:', e);
          }
        });
        
        // Initialize map when ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initMap);
        } else {
          initMap();
        }
      </script>
    </body>
    </html>
  `, [userLocation, googleApiKey]);

  // Update knocks when they change
  useEffect(() => {
    if (webViewRef.current && !isLoading && knocks.length > 0) {
      const knocksString = JSON.stringify(knocks);
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateKnocks',
        data: knocks
      }));
      
      const jsCode = `
        if (typeof updateKnocks === 'function') {
          updateKnocks(${knocksString});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [knocks, isLoading]);

  // Update user location
  useEffect(() => {
    if (webViewRef.current && !isLoading && userLocation) {
      const jsCode = `
        if (typeof updateUserLocation === 'function') {
          updateUserLocation(${userLocation.lat}, ${userLocation.lng});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [userLocation, isLoading]);

  // Update hail contours
  useEffect(() => {
    if (webViewRef.current && !isLoading && hailContours) {
      const jsCode = `
        if (typeof updateHailContours === 'function') {
          updateHailContours(${JSON.stringify(hailContours)});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [hailContours, isLoading]);

  // Update verified reports
  useEffect(() => {
    if (webViewRef.current && !isLoading && verifiedReports) {
      const jsCode = `
        if (typeof updateVerifiedReports === 'function') {
          updateVerifiedReports(${JSON.stringify(verifiedReports)});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [verifiedReports, isLoading]);

  const handleMessage = (event: any) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      
      if (message.type === 'console') {
        console.log('[WebMap]:', message.message);
      } else if (message.type === 'error') {
        console.error('[WebMap Error]:', message.message);
        setIsLoading(false);
      } else if (message.type === 'editKnock' && onKnockClick) {
        const knock = knocks.find(k => k.id === message.knockId);
        if (knock) {
          onKnockClick(knock);
        }
      } else if (message.type === 'mapReady') {
        console.log('[WebMap]: Google Maps ready');
        setIsLoading(false);
      } else if (message.type === 'mapClick') {
        // Create a new knock at the clicked location
        if (onKnockClick) {
          onKnockClick({
            id: '',
            latitude: message.latitude,
            longitude: message.longitude,
            address: message.address || '',
            outcome: 'not_home',
            timestamp: new Date(),
            notes: '',
            syncStatus: 'pending'
          } as Knock);
        }
      }
    } catch (e) {
      console.error('[WebMap]: Error parsing message:', e);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHTML }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('WebView error:', nativeEvent);
        }}
      />
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading Google Maps...</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6b7280',
  },
});

export default WebMapGoogle;
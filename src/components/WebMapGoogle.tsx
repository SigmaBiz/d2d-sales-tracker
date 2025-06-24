import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapGoogleProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  onKnockDelete?: (knockId: string) => void;
  hailContours?: any;
  activeStorms?: string[];
  verifiedReports?: any[];
  googleApiKey: string;
}

const WebMapGoogle = React.forwardRef<WebView, WebMapGoogleProps>(({ 
  knocks, 
  userLocation, 
  onKnockClick, 
  onKnockDelete,
  hailContours = null, 
  activeStorms = [], 
  verifiedReports = [],
  googleApiKey 
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Expose WebView methods to parent
  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  // Only recreate HTML when API key changes, not when location updates
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
        console.log('[WebMap] Script started loading');
        let map;
        let markers = [];
        let userMarker = null;
        let userAccuracyCircle = null;
        let searchBox;
        let currentMapType = 'roadmap';
        let hailPolygons = [];
        let verifiedMarkers = [];
        let isClickingMarker = false;
        let currentInfoWindow = null;
        
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
          console.log('initMap called - checking Google Maps API...');
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
          
          // Use OKC as default center
          const initialLat = 35.4676;
          const initialLng = -97.5164;
          
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
          
          // Make map globally accessible
          window.map = map;
          console.log('Map created and set to window.map');
          
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
            // Don't process map clicks if we're clicking on a marker
            if (isClickingMarker) {
              return;
            }
            
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
          console.log('Sending mapReady message to React Native');
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
          console.log('updateKnocks called with', knocksData.length, 'knocks');
          
          // Clear existing markers more thoroughly
          markers.forEach(marker => {
            try {
              if (marker.setMap) {
                marker.setMap(null);
              }
              if (marker.onRemove) {
                marker.onRemove();
              }
              if (marker.div && marker.div.parentNode) {
                marker.div.parentNode.removeChild(marker.div);
              }
            } catch (e) {
              console.error('Error removing marker:', e);
            }
          });
          markers = [];
          
          // Close any open info windows
          if (currentInfoWindow) {
            currentInfoWindow.close();
            currentInfoWindow = null;
          }
          
          knocksData.forEach(knock => {
            const color = colors[knock.outcome] || '#6b7280';
            const emoji = emojis[knock.outcome] || '📍';
            
            // Create a custom HTML marker for better click detection
            const MarkerWithLabel = function(position, map) {
              this.position = position;
              this.map = map;
              this.div = null;
              this.setMap(map);
            };
            
            MarkerWithLabel.prototype = new google.maps.OverlayView();
            
            MarkerWithLabel.prototype.onAdd = function() {
              const div = document.createElement('div');
              div.style.position = 'absolute';
              div.style.cursor = 'pointer';
              div.style.userSelect = 'none';
              div.style.width = '28px';
              div.style.height = '28px';
              
              const innerDiv = document.createElement('div');
              innerDiv.style.backgroundColor = color;
              innerDiv.style.width = '24px';
              innerDiv.style.height = '24px';
              innerDiv.style.borderRadius = '50%';
              innerDiv.style.border = '2px solid white';
              innerDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
              innerDiv.style.display = 'flex';
              innerDiv.style.alignItems = 'center';
              innerDiv.style.justifyContent = 'center';
              innerDiv.style.fontSize = '14px';
              innerDiv.textContent = emoji;
              
              div.appendChild(innerDiv);
              
              // Make the click area larger for easier tapping
              div.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                isClickingMarker = true;
                showKnockInfo(knock);
                // Reset flag after a short delay
                setTimeout(() => { isClickingMarker = false; }, 500);
              });
              
              // Also prevent mousedown to stop any early event propagation
              div.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                isClickingMarker = true;
              });
              
              div.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                isClickingMarker = true;
              });
              
              this.div = div;
              const panes = this.getPanes();
              // Use floatPane which is above other map layers
              panes.floatPane.appendChild(div);
            };
            
            MarkerWithLabel.prototype.draw = function() {
              const overlayProjection = this.getProjection();
              const pos = overlayProjection.fromLatLngToDivPixel(this.position);
              const div = this.div;
              if (div) {
                div.style.left = (pos.x - 14) + 'px';
                div.style.top = (pos.y - 14) + 'px';
              }
            };
            
            MarkerWithLabel.prototype.onRemove = function() {
              if (this.div && this.div.parentNode) {
                // Remove all event listeners by cloning
                const parent = this.div.parentNode;
                const newDiv = this.div.cloneNode(false);
                parent.replaceChild(newDiv, this.div);
                parent.removeChild(newDiv);
                this.div = null;
              }
            };
            
            MarkerWithLabel.prototype.setMap = function(map) {
              if (map === null) {
                this.onRemove();
              }
              google.maps.OverlayView.prototype.setMap.call(this, map);
            };
            
            const customMarker = new MarkerWithLabel(
              new google.maps.LatLng(knock.latitude, knock.longitude),
              map
            );
            
            markers.push(customMarker);
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
          
          content += '<div style="margin-top: 10px; display: flex; gap: 8px;">';
          content += '<button onclick="window.editKnock(\\\'' + knock.id + '\\\')" style="background-color: #1e40af; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; flex: 1;">Edit</button>';
          content += '<button onclick="window.deleteKnock(\\\'' + knock.id + '\\\')" style="background-color: #6b7280; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; flex: 1;">Clear</button>';
          content += '</div>';
          content += '</div>';
          
          // Close any existing info window
          if (currentInfoWindow) {
            currentInfoWindow.close();
          }
          
          const infoWindow = new google.maps.InfoWindow({
            content: content,
            position: { lat: knock.latitude, lng: knock.longitude }
          });
          
          infoWindow.open(map);
          currentInfoWindow = infoWindow;
          window.currentInfoWindow = infoWindow;
        }
        
        // Update user location
        window.updateUserLocation = function(lat, lng) {
          console.log('updateUserLocation called with:', lat, lng);
          const position = { lat, lng };
          
          if (userMarker) {
            console.log('Updating existing userMarker position');
            userMarker.setPosition(position);
            if (userAccuracyCircle) {
              userAccuracyCircle.setCenter(position);
            }
          } else {
            console.log('Creating new userMarker and accuracy circle');
            // Create accuracy circle (light blue, very subtle)
            userAccuracyCircle = new google.maps.Circle({
              center: position,
              radius: 5, // Very small radius, just a subtle glow
              strokeColor: '#4285F4',
              strokeOpacity: 0.15,
              strokeWeight: 0,
              fillColor: '#4285F4',
              fillOpacity: 0.08, // Even more subtle
              map: map,
              zIndex: 999
            });
            
            // Create the main marker - standard size blue dot
            userMarker = new google.maps.Marker({
              position: position,
              map: map,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9, // Bigger dot
                fillColor: '#4285F4', // Google Maps blue
                fillOpacity: 1,
                strokeColor: 'white',
                strokeWeight: 2.5
              },
              zIndex: 9999,
              title: 'Your Location'
            });
            console.log('Created userMarker:', userMarker);
            console.log('Created userAccuracyCircle:', userAccuracyCircle);
            console.log('Map object:', map);
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
          }
        };
        
        // Edit knock handler
        window.editKnock = function(knockId) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'editKnock',
            knockId: knockId
          }));
        };
        
        // Delete knock handler
        window.deleteKnock = function(knockId) {
          // Close any open info windows
          if (window.currentInfoWindow) {
            window.currentInfoWindow.close();
          }
          
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'deleteKnock',
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
  `, [googleApiKey]); // Only recreate when API key changes

  // Update knocks when they change
  useEffect(() => {
    console.log('[WebMapGoogle] Knocks effect triggered:', knocks.length, 'isLoading:', isLoading);
    if (webViewRef.current && !isLoading) {
      // Always update, even with empty array to clear old markers
      const knocksString = JSON.stringify(knocks);
      
      const jsCode = `
        (function() {
          const attemptUpdate = () => {
            if (typeof updateKnocks === 'function' && window.map) {
              console.log('[WebMap] Updating knocks with ${knocks.length} items');
              updateKnocks(${knocksString});
              return true;
            }
            return false;
          };
          
          // Try immediately
          if (!attemptUpdate()) {
            console.warn('[WebMap] Map or updateKnocks not ready, retrying...');
            // Retry a few times with increasing delays
            let attempts = 0;
            const retryInterval = setInterval(() => {
              attempts++;
              if (attemptUpdate() || attempts >= 5) {
                clearInterval(retryInterval);
                if (attempts >= 5) {
                  console.error('[WebMap] Failed to update knocks after 5 attempts');
                }
              }
            }, 200);
          }
        })();
        true;
      `;
      webViewRef.current.injectJavaScript(jsCode);
    }
  }, [knocks, isLoading]);

  // Update user location
  useEffect(() => {
    console.log('[WebMapGoogle] userLocation effect triggered:', userLocation, 'isLoading:', isLoading);
    if (webViewRef.current && !isLoading && userLocation) {
      // Add a small delay to ensure map is fully initialized
      setTimeout(() => {
        const jsCode = `
          console.log('[WebMap] Injecting updateUserLocation call');
          if (typeof updateUserLocation === 'function') {
            updateUserLocation(${userLocation.lat}, ${userLocation.lng});
          } else {
            console.error('[WebMap] updateUserLocation function not found!');
          }
          true;
        `;
        webViewRef.current?.injectJavaScript(jsCode);
      }, 500);
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
      } else if (message.type === 'deleteKnock') {
        // Handle knock deletion
        console.log('[WebMap]: Delete knock requested:', message.knockId);
        if (onKnockDelete) {
          onKnockDelete(message.knockId);
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
import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';

interface WebMapProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  onKnockClear?: (knockId: string) => void;
  hailContours?: any; // GeoJSON FeatureCollection
  activeStorms?: string[]; // IDs of storms to display
  verifiedReports?: any[]; // Verified ground truth reports
}

const WebMap = React.forwardRef<WebView, WebMapProps>(({ knocks, userLocation, onKnockClick, onKnockClear, hailContours = null, activeStorms = [], verifiedReports = [] }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  console.log('WebMap render - hailContours prop:', hailContours);

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
        // Override console.log to send to React Native
        var originalLog = console.log;
        console.log = function() {
          originalLog.apply(console, arguments);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'console',
              message: Array.from(arguments).join(' ')
            }));
          }
        };
        
        // Wait a bit for Leaflet to load
        console.log('Waiting for Leaflet to load...');
        setTimeout(function() {
          console.log('Checking if Leaflet loaded...');
          if (typeof L !== 'undefined') {
            console.log('Leaflet loaded successfully!');
            try {
              // Start with user location if available, otherwise default to OKC
              var initialLat = ${userLocation ? userLocation.lat : 35.4676};
              var initialLng = ${userLocation ? userLocation.lng : -97.5164};
              var map = L.map('map').setView([initialLat, initialLng], 13);
              
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
              
              // Store layer references for toggling
              var currentLayer = 'street';
              
              // Function to toggle map type
              window.toggleMapType = function() {
                if (currentLayer === 'street') {
                  map.removeLayer(streetLayer);
                  map.addLayer(satelliteLayer);
                  currentLayer = 'satellite';
                } else {
                  map.removeLayer(satelliteLayer);
                  map.addLayer(streetLayer);
                  currentLayer = 'street';
                }
              };
              
              
              // Define colors and emojis
              var colors = {
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
              
              var emojis = {
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
              
              var markers = [];
              var userMarker = null;
              var hailContourLayer = null;
              var verifiedMarkers = [];
              
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
                    html: '<div style="background-color: ' + color + '; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 14px;">' + emoji + '</div>',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                    className: 'custom-div-icon'
                  });
                  
                  var popupContent = '<div style="font-size: 14px;"><h4 style="margin: 0 0 8px 0; color: #1e40af;">' + emoji + ' ' + knock.outcome.replace(/_/g, ' ').toUpperCase() + '</h4>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Address:</strong> ' + (knock.address || 'No address') + '</p>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Time:</strong> ' + new Date(knock.timestamp).toLocaleString() + '</p>';
                  
                  // Show history if exists
                  if (knock.history && knock.history.length > 0) {
                    popupContent += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><strong>History:</strong>';
                    knock.history.forEach(function(h) {
                      var histEmoji = emojis[h.outcome] || '📍';
                      popupContent += '<br><span style="color: #6b7280; font-size: 12px;">' + histEmoji + ' ' + h.outcome.replace(/_/g, ' ') + ' - ' + new Date(h.timestamp).toLocaleDateString() + '</span>';
                    });
                    popupContent += '</div>';
                  }
                  
                  if (knock.notes) {
                    popupContent += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb;"><strong>Notes:</strong><br>' + knock.notes.replace(/\\n/g, '<br>') + '</div>';
                  }
                  popupContent += '<div style="margin-top: 10px;">';
                  popupContent += '<button onclick="window.editKnock(\\\'' + knock.id + '\\\')" style="background-color: #1e40af; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; margin-right: 8px;">Edit</button>';
                  popupContent += '<button onclick="window.clearKnock(\\\'' + knock.id + '\\\')" style="background-color: #ef4444; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer;">Clear</button>';
                  popupContent += '</div>';
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
              
              // Function to edit knock
              window.editKnock = function(knockId) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'editKnock',
                    knockId: knockId
                  }));
                }
              };
              
              window.clearKnock = function(knockId) {
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'clearKnock',
                    knockId: knockId
                  }));
                }
              };
              
              // Function to update verified reports
              window.updateVerifiedReports = function(reports) {
                console.log('updateVerifiedReports called with', reports.length, 'reports');
                
                // Clear existing verified markers
                verifiedMarkers.forEach(function(marker) {
                  map.removeLayer(marker);
                });
                verifiedMarkers = [];
                
                // Add markers for each verified report
                reports.forEach(function(report) {
                  // Create a special icon for verified reports
                  var icon = L.divIcon({
                    html: '<div style="background-color: #10b981; width: 32px; height: 32px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; position: relative;">' +
                          '<div style="font-size: 18px; color: white;">✓</div>' +
                          '<div style="position: absolute; bottom: -4px; right: -4px; background-color: white; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">' +
                          '<div style="font-size: 12px;">🧊</div>' +
                          '</div>' +
                          '</div>',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16],
                    className: 'verified-marker'
                  });
                  
                  var popupContent = '<div style="font-size: 14px;">';
                  popupContent += '<h4 style="margin: 0 0 8px 0; color: #10b981;">✓ Verified Hail Report</h4>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Size:</strong> ' + report.size.toFixed(2) + ' inches</p>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Time:</strong> ' + new Date(report.timestamp).toLocaleString() + '</p>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Location:</strong> ' + (report.city || 'Unknown') + '</p>';
                  popupContent += '<p style="margin: 4px 0;"><strong>Source:</strong> ' + (report.source || 'NOAA Storm Events') + '</p>';
                  popupContent += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #10b981; font-style: italic;">This is a verified ground truth report from the NOAA Storm Events Database</div>';
                  popupContent += '</div>';
                  
                  var marker = L.marker([report.latitude, report.longitude], {icon: icon})
                    .bindPopup(popupContent)
                    .addTo(map);
                  
                  // Add pulsing effect on hover
                  marker.on('mouseover', function() {
                    this.getElement().style.transform = 'scale(1.1)';
                  });
                  marker.on('mouseout', function() {
                    this.getElement().style.transform = 'scale(1)';
                  });
                  
                  verifiedMarkers.push(marker);
                });
                
                console.log('Added', verifiedMarkers.length, 'verified report markers');
              };
              
              // Function to update hail contours
              window.updateHailContours = function(contourData) {
                console.log('updateHailContours called with:', contourData);
                
                // Clear existing contours
                if (hailContourLayer) {
                  map.removeLayer(hailContourLayer);
                  hailContourLayer = null;
                }
                
                if (!contourData || !contourData.features || contourData.features.length === 0) {
                  console.log('No contour features to display');
                  return;
                }
                
                console.log('Adding', contourData.features.length, 'contour features to map');
                
                // Log each feature's properties for debugging
                contourData.features.forEach(function(feature, index) {
                  console.log('Feature ' + index + ':', {
                    description: feature.properties.description,
                    color: feature.properties.color,
                    level: feature.properties.level,
                    geometryType: feature.geometry.type
                  });
                });
                
                // Add contour layer
                // Sort features by level (descending) so larger zones render first
                var sortedFeatures = contourData.features.sort(function(a, b) {
                  return b.properties.level - a.properties.level;
                });
                
                hailContourLayer = L.geoJSON({
                  type: 'FeatureCollection',
                  features: sortedFeatures
                }, {
                  style: function(feature) {
                    return {
                      fillColor: feature.properties.color,
                      fillOpacity: 0.3,
                      color: feature.properties.color,
                      weight: 2,
                      opacity: 0.8
                    };
                  },
                  onEachFeature: function(feature, layer) {
                    var props = feature.properties;
                    var popupContent = '<div style="font-size: 14px;">';
                    popupContent += '<h4 style="margin: 0 0 8px 0; color: ' + props.color + ';">Hail Zone</h4>';
                    popupContent += '<p style="margin: 4px 0;"><strong>Size Range:</strong> ' + props.description + '</p>';
                    popupContent += '<p style="margin: 4px 0; font-style: italic; color: #6b7280;">Click anywhere in this zone to start canvassing</p>';
                    popupContent += '</div>';
                    
                    layer.bindPopup(popupContent);
                  }
                }).addTo(map);
                
                // Bring contours to back so knock markers are on top
                hailContourLayer.bringToBack();
                console.log('Hail contour layer added to map');
                
                // Fit map to show hail contours with bounds validation
                try {
                  var bounds = hailContourLayer.getBounds();
                  console.log('Contour bounds:', bounds);
                  
                  // Check if bounds are valid and not at 0,0
                  if (bounds.isValid()) {
                    var sw = bounds.getSouthWest();
                    var ne = bounds.getNorthEast();
                    console.log('SouthWest:', sw.lat, sw.lng, 'NorthEast:', ne.lat, ne.lng);
                    
                    // Check if bounds are near 0,0 (Africa coast)
                    if (Math.abs(sw.lat) < 1 && Math.abs(sw.lng) < 1) {
                      console.log('WARNING: Bounds are near 0,0 - likely invalid coordinates');
                      // Try to use Oklahoma bounds as fallback
                      map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
                    } else {
                      console.log('Fitting map to valid hail contour bounds');
                      map.fitBounds(bounds, { padding: [50, 50] });
                    }
                  } else {
                    console.log('Bounds are not valid, using Oklahoma default bounds');
                    map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
                  }
                } catch (e) {
                  console.log('Could not fit bounds:', e);
                  // Fallback to Oklahoma bounds
                  map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
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
                console.log('WebView received message:', event.data ? event.data.substring(0, 100) + '...' : 'empty');
                try {
                  var data = JSON.parse(event.data);
                  console.log('Parsed message type:', data.type);
                  if (data.type === 'updateKnocks') {
                    updateKnocks(data.knocks);
                  } else if (data.type === 'updateUserLocation') {
                    updateUserLocation(data.lat, data.lng);
                  } else if (data.type === 'centerOnUser') {
                    centerOnUser();
                  } else if (data.type === 'updateHailContours') {
                    console.log('Received updateHailContours message');
                    updateHailContours(data.contourData);
                  } else if (data.type === 'focusOnHail') {
                    console.log('Focusing on hail contours');
                    if (hailContourLayer) {
                      try {
                        var bounds = hailContourLayer.getBounds();
                        console.log('Focus bounds:', bounds);
                        
                        if (bounds.isValid()) {
                          var sw = bounds.getSouthWest();
                          var ne = bounds.getNorthEast();
                          console.log('Focus SouthWest:', sw.lat, sw.lng, 'NorthEast:', ne.lat, ne.lng);
                          
                          // Check if bounds are near 0,0 (Africa coast)
                          if (Math.abs(sw.lat) < 1 && Math.abs(sw.lng) < 1) {
                            console.log('WARNING: Focus bounds are near 0,0 - using Oklahoma bounds instead');
                            map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
                          } else {
                            map.fitBounds(bounds, { padding: [50, 50] });
                          }
                        } else {
                          console.log('Focus bounds invalid, using Oklahoma bounds');
                          map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
                        }
                      } catch (e) {
                        console.log('Could not focus on hail:', e);
                        // Fallback to Oklahoma bounds
                        map.fitBounds([[33.6, -103.0], [37.0, -94.4]], { padding: [50, 50] });
                      }
                    } else {
                      console.log('No hail contour layer to focus on');
                    }
                  } else if (data.type === 'focusOnBounds') {
                    console.log('Focusing on specific bounds:', data.bounds);
                    if (data.bounds) {
                      try {
                        var leafletBounds = L.latLngBounds(
                          [data.bounds.south, data.bounds.west],
                          [data.bounds.north, data.bounds.east]
                        );
                        map.fitBounds(leafletBounds, { padding: [50, 50] });
                      } catch (e) {
                        console.log('Could not focus on bounds:', e);
                      }
                    }
                  } else if (data.type === 'toggleMapType') {
                    console.log('Toggling map type');
                    if (window.toggleMapType) {
                      window.toggleMapType();
                    }
                  } else if (data.type === 'centerOnLocation') {
                    console.log('Centering on location:', data.lat, data.lng);
                    if (data.lat && data.lng) {
                      var zoom = data.zoom || 13;
                      map.setView([data.lat, data.lng], zoom);
                    }
                  } else if (data.type === 'updateVerifiedReports') {
                    console.log('Received updateVerifiedReports message');
                    updateVerifiedReports(data.reports);
                  }
                } catch (e) {
                  console.error('Message error:', e);
                }
              });
              
              // Add custom styles
              var style = document.createElement('style');
              style.textContent = '@keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2); opacity: 0; } } ' +
                '.leaflet-control-layers { position: fixed !important; right: 16px !important; bottom: 240px !important; top: auto !important; margin: 0 !important; } ' +
                '.custom-div-icon { background: transparent !important; border: none !important; } ' +
                '.verified-marker { background: transparent !important; border: none !important; transition: transform 0.2s ease; }';
              document.head.appendChild(style);
              
              // Send ready message
              console.log('Map initialized, sending ready message');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
              }
            } catch (e) {
              console.error('Error initializing map:', e);
              document.body.innerHTML = '<div style="padding: 20px;">Error: ' + e.message + '</div>';
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ 
                  type: 'mapError', 
                  error: e.message 
                }));
              }
            }
          } else {
            console.log('Leaflet not loaded');
            document.body.innerHTML = '<div style="padding: 20px;">Leaflet failed to load. Try refreshing.</div>';
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ 
                type: 'mapError', 
                error: 'Leaflet library not loaded' 
              }));
            }
          }
        }, 1000);
      </script>
    </body>
    </html>
  `, []);

  useEffect(() => {
    console.log('WebMap knocks useEffect - isLoading:', isLoading, 'knocks count:', knocks.length);
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

  // Track if we have pending contours to send
  const [pendingContours, setPendingContours] = useState<any>(null);

  useEffect(() => {
    console.log('WebMap hailContours useEffect - isLoading:', isLoading, 'webViewRef.current:', !!webViewRef.current, 'hailContours:', hailContours);
    if (!isLoading && webViewRef.current) {
      // Send update even if hailContours is null (to clear the overlay)
      if (hailContours !== undefined) {
        console.log('Sending hail contours to WebView:', hailContours);
        try {
          // Send hail contours to map (or null to clear)
          const message = JSON.stringify({
            type: 'updateHailContours',
            contourData: hailContours
          });
          console.log('Stringified message length:', message.length);
          webViewRef.current.postMessage(message);
          setPendingContours(null); // Clear pending
        } catch (error) {
          console.error('Error stringifying hail contours:', error);
        }
      }
    } else if (isLoading && hailContours) {
      console.log('Map still loading, storing hail contours as pending');
      setPendingContours(hailContours);
    }
  }, [hailContours, isLoading]);

  // Send pending contours when map becomes ready
  useEffect(() => {
    if (!isLoading && webViewRef.current && pendingContours !== null) {
      console.log('Map now ready, sending pending contours:', pendingContours);
      try {
        const message = JSON.stringify({
          type: 'updateHailContours',
          contourData: pendingContours
        });
        console.log('Sending pending contours, message length:', message.length);
        webViewRef.current.postMessage(message);
        setPendingContours(null);
      } catch (error) {
        console.error('Error stringifying pending contours:', error);
      }
    }
  }, [isLoading, pendingContours]);

  // Send verified reports when they change
  useEffect(() => {
    console.log('WebMap verifiedReports useEffect - isLoading:', isLoading, 'verifiedReports count:', verifiedReports.length);
    if (!isLoading && webViewRef.current && verifiedReports) {
      console.log('Sending verified reports to WebView:', verifiedReports);
      try {
        const message = JSON.stringify({
          type: 'updateVerifiedReports',
          reports: verifiedReports
        });
        webViewRef.current.postMessage(message);
      } catch (error) {
        console.error('Error sending verified reports:', error);
      }
    }
  }, [verifiedReports, isLoading]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'console') {
        console.log('[WebView]:', data.message);
      } else if (data.type === 'mapReady') {
        console.log('WebMap received mapReady message');
        setIsLoading(false);
      } else if (data.type === 'mapError') {
        console.error('WebMap error:', data.error);
        setIsLoading(false);
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
      } else if (data.type === 'editKnock') {
        // Handle edit knock - pass knock data to parent
        const knock = knocks.find(k => k.id === data.knockId);
        if (knock && onKnockClick) {
          onKnockClick(knock);
        }
      } else if (data.type === 'clearKnock') {
        // Handle clear knock
        if (onKnockClear) {
          onKnockClear(data.knockId);
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
import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { Knock } from '../types';
import { KnockDebugger } from '../utils/knockDebugger';

interface WebMapProps {
  knocks: Knock[];
  userLocation: { lat: number; lng: number } | null;
  onKnockClick?: (knock: Knock) => void;
  onKnockClear?: (knockId: string) => void;
  onMapReady?: () => void;
  hailContours?: any;
  activeStorms?: string[];
  verifiedReports?: any[];
}

const WebMapOptimizedViewport = React.forwardRef<WebView, WebMapProps>(({ knocks, userLocation, onKnockClick, onKnockClear, onMapReady, hailContours = null, activeStorms = [], verifiedReports = [] }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  console.log('WebMapOptimizedViewport render - hailContours prop:', hailContours);

  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  // OPTIMIZATION: Viewport culled HTML with all optimizations
  const mapHTML = React.useMemo(() => {
    // Keep critical data structures readable
    const colors = {
      not_home: '#6b7280', convo: '#3b82f6', inspected: '#3b82f6', 
      no_soliciting: '#ef4444', lead: '#10b981', sale: '#22c55e',
      callback: '#f59e0b', new_roof: '#8b5cf6', competitor: '#dc2626',
      renter: '#6366f1', poor_condition: '#78716c', proposal_left: '#0891b2',
      stay_away: '#991b1b', revisit: '#3b82f6', not_interested: '#991b1b'
    };
    
    const emojis = {
      not_home: '👻', inspected: '🪜', no_soliciting: '🚫', lead: '✅',
      sale: '📝', callback: '🔄', convo: '💬', new_roof: '👼',
      competitor: '🏗️', renter: '🧟', poor_condition: '🏚️', proposal_left: '📋',
      stay_away: '👹', revisit: '👀', not_interested: '❌'
    };

    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<style>
body{margin:0;padding:0}
#map{height:100vh;width:100vw}
.marker-cluster-small{background-color:rgba(110,204,57,0.6)}
.marker-cluster-medium{background-color:rgba(240,194,12,0.6)}
.marker-cluster-large{background-color:rgba(241,128,23,0.6)}
.marker-cluster div{background-color:rgba(255,255,255,0.9);font-weight:bold}
@keyframes pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2);opacity:0}}
.leaflet-control-layers{position:fixed!important;right:16px!important;bottom:240px!important;top:auto!important;margin:0!important}
.custom-div-icon{background:transparent!important;border:none!important}
.verified-marker{background:transparent!important;border:none!important;transition:transform 0.2s ease}
</style>
</head>
<body>
<div id="map"></div>
<script>
// Knock outcome colors and emojis
var colors=${JSON.stringify(colors)};
var emojis=${JSON.stringify(emojis)};

// Console override for debugging
var originalLog=console.log;
console.log=function(){
  originalLog.apply(console,arguments);
  if(window.ReactNativeWebView){
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type:'console',
      message:Array.from(arguments).join(' ')
    }));
  }
};

// Initialize map after Leaflet loads
console.log('Waiting for Leaflet to load...');
setTimeout(function(){
  console.log('Checking if Leaflet loaded...');
  if(typeof L!=='undefined'){
    console.log('Leaflet loaded successfully!');
    try{
      // Create map
      var map=L.map('map').setView([${userLocation?.lat||35.4676},${userLocation?.lng||-97.5164}],13);
      
      // Map layers
      var streetLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
        attribution:'© OpenStreetMap contributors'
      });
      var satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
        attribution:'Tiles © Esri'
      });
      
      streetLayer.addTo(map);
      var currentLayer='street';
      
      // Toggle map type
      window.toggleMapType=function(){
        if(currentLayer==='street'){
          map.removeLayer(streetLayer);
          map.addLayer(satelliteLayer);
          currentLayer='satellite';
        }else{
          map.removeLayer(satelliteLayer);
          map.addLayer(streetLayer);
          currentLayer='street';
        }
      };
      
      // Marker clustering
      var markerClusterGroup=L.markerClusterGroup({
        maxClusterRadius:80,
        spiderfyOnMaxZoom:true,
        showCoverageOnHover:false,
        zoomToBoundsOnClick:true,
        disableClusteringAtZoom:18,
        iconCreateFunction:function(cluster){
          var count=cluster.getChildCount();
          var size=count<10?'small':count<100?'medium':'large';
          return new L.DivIcon({
            html:'<div><span>'+count+'</span></div>',
            className:'marker-cluster marker-cluster-'+size,
            iconSize:new L.Point(40,40)
          });
        }
      });
      
      var userMarker=null;
      var hailContourLayer=null;
      var verifiedMarkers=[];
      var knockMarkerMap=new Map();
      
      // VIEWPORT CULLING IMPLEMENTATION
      var currentBounds=null;
      var allKnocksData=[];
      var viewportCullingEnabled=false; // DISABLED - causing issues with initial render
      var renderDebounceTimer=null;
      var VIEWPORT_BUFFER=0.2; // 20% buffer for smooth panning
      
      // Track map movement for viewport culling
      map.on('moveend',function(){
        if(viewportCullingEnabled&&allKnocksData.length>0){
          currentBounds=map.getBounds();
          renderVisibleKnocks();
        }
      });
      
      // Render only visible knocks with buffer
      function renderVisibleKnocks(){
        if(!currentBounds||allKnocksData.length===0)return;
        
        // Clear debounce timer
        if(renderDebounceTimer)clearTimeout(renderDebounceTimer);
        
        renderDebounceTimer=setTimeout(function(){
          console.log('Viewport culling: checking '+allKnocksData.length+' knocks');
          
          // Expand bounds by buffer for smooth panning
          var expandedBounds=currentBounds.pad(VIEWPORT_BUFFER);
          
          // Clear current markers
          markerClusterGroup.clearLayers();
          knockMarkerMap.clear();
          
          var visibleCount=0;
          
          // Only render knocks within expanded viewport
          allKnocksData.forEach(function(knock){
            var knockLatLng=L.latLng(knock.latitude,knock.longitude);
            
            if(expandedBounds.contains(knockLatLng)){
              visibleCount++;
              createMarkerForKnock(knock);
            }
          });
          
          console.log('Rendered '+visibleCount+' of '+allKnocksData.length+' knocks in viewport');
          
          // Ensure cluster group is on map
          if(!map.hasLayer(markerClusterGroup)){
            map.addLayer(markerClusterGroup);
          }
        },100); // 100ms debounce for smooth interaction
      }
      
      // Helper function to create a marker
      function createMarkerForKnock(knock){
        var color=colors[knock.outcome]||'#6b7280';
        var emoji=emojis[knock.outcome]||'📍';
        
        var icon=L.divIcon({
          html:'<div style="background-color:'+color+';width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">'+emoji+'</div>',
          iconSize:[24,24],
          iconAnchor:[12,12],
          className:'custom-div-icon'
        });
        
        // Build popup content
        var popupContent='<div style="font-size:14px;"><h4 style="margin:0 0 8px 0;color:#1e40af;">'+emoji+' '+knock.outcome.replace(/_/g,' ').toUpperCase()+'</h4>';
        popupContent+='<p style="margin:4px 0;"><strong>Address:</strong> '+(knock.address||'No address')+'</p>';
        popupContent+='<p style="margin:4px 0;"><strong>Time:</strong> '+new Date(knock.timestamp).toLocaleString()+'</p>';
        
        if(knock.history&&knock.history.length>0){
          popupContent+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;"><strong>History:</strong>';
          knock.history.forEach(function(h){
            var histEmoji=emojis[h.outcome]||'📍';
            popupContent+='<br><span style="color:#6b7280;font-size:12px;">'+histEmoji+' '+h.outcome.replace(/_/g,' ')+' - '+new Date(h.timestamp).toLocaleDateString()+'</span>';
          });
          popupContent+='</div>';
        }
        
        if(knock.notes){
          popupContent+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;"><strong>Notes:</strong><br>'+knock.notes.replace(/\\n/g,'<br>')+'</div>';
        }
        
        popupContent+='<div style="margin-top:10px;">';
        popupContent+='<button onclick="window.editKnock(\\''+knock.id+'\\')" style="background-color:#1e40af;color:white;padding:8px 16px;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-right:8px;">Edit</button>';
        popupContent+='<button onclick="window.clearKnock(\\''+knock.id+'\\')" style="background-color:#ef4444;color:white;padding:8px 16px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Clear</button>';
        popupContent+='</div></div>';
        
        var marker=L.marker([knock.latitude,knock.longitude],{icon:icon}).bindPopup(popupContent);
        markerClusterGroup.addLayer(marker);
        knockMarkerMap.set(knock.id,marker);
      }
      
      // Update knocks function with viewport culling
      window.updateKnocks=function(knocksData){
        console.log('Updating '+knocksData.length+' knocks with viewport culling');
        
        // Store all knocks data
        allKnocksData=knocksData;
        
        if(!viewportCullingEnabled){
          // Original behavior - render all knocks
          console.log('Viewport culling disabled, rendering all knocks');
          
          // Clear and re-render all
          markerClusterGroup.clearLayers();
          knockMarkerMap.clear();
          
          knocksData.forEach(function(knock){
            createMarkerForKnock(knock);
          });
          
          if(!map.hasLayer(markerClusterGroup)){
            map.addLayer(markerClusterGroup);
          }
        }else{
          // Viewport culling enabled - get bounds and render visible
          if(!currentBounds){
            currentBounds=map.getBounds();
          }
          renderVisibleKnocks();
        }
      };
      
      // Update knocks differentially for better performance
      window.updateKnocksDifferential=function(changes){
        console.log('Applying differential update with viewport culling');
        
        if(!viewportCullingEnabled){
          // Without viewport culling - apply changes directly
          console.log('Differential update:',changes.added.length,'added,',changes.updated.length,'updated,',changes.removed.length,'removed');
          
          // Remove deleted knocks
          changes.removed.forEach(function(knockId){
            var marker=knockMarkerMap.get(knockId);
            if(marker){
              markerClusterGroup.removeLayer(marker);
              knockMarkerMap.delete(knockId);
            }
          });
          
          // Add/update markers
          changes.added.concat(changes.updated).forEach(function(knock){
            var existingMarker=knockMarkerMap.get(knock.id);
            if(existingMarker){
              markerClusterGroup.removeLayer(existingMarker);
              knockMarkerMap.delete(knock.id);
            }
            createMarkerForKnock(knock);
          });
        }else{
          // With viewport culling - update data and re-render visible
          
          // Update allKnocksData array
          var knockMap=new Map(allKnocksData.map(function(k){return[k.id,k]}));
          
          // Remove deleted
          changes.removed.forEach(function(id){
            knockMap.delete(id);
          });
          
          // Add/update
          changes.added.concat(changes.updated).forEach(function(knock){
            knockMap.set(knock.id,knock);
          });
          
          allKnocksData=Array.from(knockMap.values());
          
          // Re-render visible knocks
          renderVisibleKnocks();
        }
        
        console.log('Differential update applied successfully');
      };
      
      // Update single knock for real-time updates
      window.updateSingleKnock=function(knock){
        console.log('Updating single knock:',knock.id,knock.outcome);
        
        if(!viewportCullingEnabled){
          // Without viewport culling - update directly
          var existingMarker=knockMarkerMap.get(knock.id);
          if(existingMarker){
            markerClusterGroup.removeLayer(existingMarker);
            knockMarkerMap.delete(knock.id);
          }
          createMarkerForKnock(knock);
        }else{
          // With viewport culling - update data and check if visible
          var knockIndex=allKnocksData.findIndex(function(k){return k.id===knock.id});
          if(knockIndex>=0){
            allKnocksData[knockIndex]=knock;
          }else{
            allKnocksData.push(knock);
          }
          
          // Check if knock is in viewport
          if(currentBounds){
            var expandedBounds=currentBounds.pad(VIEWPORT_BUFFER);
            var knockLatLng=L.latLng(knock.latitude,knock.longitude);
            
            if(expandedBounds.contains(knockLatLng)){
              // Update visible marker
              var existingMarker=knockMarkerMap.get(knock.id);
              if(existingMarker){
                markerClusterGroup.removeLayer(existingMarker);
                knockMarkerMap.delete(knock.id);
              }
              createMarkerForKnock(knock);
            }
          }
        }
      };
      
      // Focus on bounds function
      window.focusOnBounds=function(bounds){
        console.log('Focusing on bounds:',bounds);
        if(!bounds||!bounds.north||!bounds.south||!bounds.east||!bounds.west)return;
        try{
          var leafletBounds=L.latLngBounds(
            L.latLng(bounds.south,bounds.west),
            L.latLng(bounds.north,bounds.east)
          );
          map.fitBounds(leafletBounds,{padding:[50,50]});
        }catch(e){
          console.error('Error focusing on bounds:',e);
        }
      };
      
      // Focus on hail contours
      window.focusOnHail=function(){
        if(hailContourLayer){
          var bounds=hailContourLayer.getBounds();
          map.fitBounds(bounds,{padding:[50,50]});
        }
      };
      
      // Center on location function
      window.centerOnLocation=function(lat,lng,zoom){
        console.log('Centering on location:',lat,lng,'zoom:',zoom);
        map.setView([lat,lng],zoom||16);
      };
      
      // Center on user function
      window.centerOnUser=function(){
        console.log('Centering on user location');
        if(userMarker){
          var pos=userMarker.getLatLng();
          map.setView(pos,16);
        }
      };
      
      // Update user location
      window.updateUserLocation=function(lat,lng){
        console.log('Updating user location:',lat,lng);
        if(userMarker){
          userMarker.setLatLng([lat,lng]);
        }else{
          userMarker=L.circleMarker([lat,lng],{
            radius:8,
            fillColor:'#3b82f6',
            color:'white',
            weight:3,
            opacity:1,
            fillOpacity:1
          }).addTo(map);
        }
      };
      
      // Update hail contours
      window.updateHailContours=function(contoursGeoJSON){
        console.log('Updating hail contours');
        if(hailContourLayer){
          map.removeLayer(hailContourLayer);
          hailContourLayer=null;
        }
        
        if(contoursGeoJSON&&contoursGeoJSON.features&&contoursGeoJSON.features.length>0){
          hailContourLayer=L.geoJSON(contoursGeoJSON,{
            style:function(feature){
              return{
                fillColor:feature.properties.color||'#3b82f6',
                weight:2,
                opacity:0.8,
                color:feature.properties.color||'#3b82f6',
                fillOpacity:0.35
              };
            },
            onEachFeature:function(feature,layer){
              if(feature.properties&&feature.properties.description){
                layer.bindPopup('<div style="font-size:14px;"><strong>'+feature.properties.description+'</strong></div>');
              }
            }
          }).addTo(map);
        }
      };
      
      // Update verified reports
      window.updateVerifiedReports=function(reports){
        console.log('Updating '+reports.length+' verified reports as markers');
        verifiedMarkers.forEach(function(marker){
          map.removeLayer(marker);
        });
        verifiedMarkers=[];
        
        reports.forEach(function(report){
          var sizeInInches=report.size_inches||report.maxsize_inches||1.0;
          var color=sizeInInches>=2.0?'#dc2626':sizeInInches>=1.0?'#f59e0b':'#3b82f6';
          var marker=L.marker([report.lat||report.latitude,report.lon||report.longitude],{
            icon:L.divIcon({
              html:'<div style="background:'+color+';color:white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">'+sizeInInches.toFixed(1)+'"</div>',
              iconSize:[30,30],
              iconAnchor:[15,15],
              className:'verified-marker'
            })
          }).bindPopup('<div style="font-size:14px;"><strong>Verified Hail Report</strong><br>Size: '+sizeInInches.toFixed(1)+' inches<br>Time: '+new Date(report.time||report.timestamp).toLocaleString()+'</div>');
          marker.addTo(map);
          verifiedMarkers.push(marker);
        });
      };
      
      // Handle knocks
      window.editKnock=function(knockId){
        console.log('Edit knock:',knockId);
        var knock=null;
        for(var i=0;i<window.currentKnocks.length;i++){
          if(window.currentKnocks[i].id===knockId){
            knock=window.currentKnocks[i];
            break;
          }
        }
        if(knock&&window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'knockClick',
            knock:knock
          }));
        }
      };
      
      window.clearKnock=function(knockId){
        console.log('Clear knock:',knockId);
        if(window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'knockClear',
            knockId:knockId
          }));
        }
      };
      
      // Map click handler
      map.on('click',function(e){
        console.log('Map clicked at:',e.latlng.lat,e.latlng.lng);
        if(window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'knockClick',
            knock:{
              latitude:e.latlng.lat,
              longitude:e.latlng.lng
            }
          }));
        }
      });
      
      // Store current knocks for reference
      window.currentKnocks=[];
      
      // Message handler for React Native
      document.addEventListener('message',function(event){
        try{
          var data=JSON.parse(event.data);
          console.log('Received message type:',data.type);
          
          switch(data.type){
            case 'updateKnocks':
              if(data.knocks){
                window.currentKnocks=data.knocks;
                window.updateKnocks(data.knocks);
              }
              break;
            case 'updateUserLocation':
              if(data.lat&&data.lng){
                window.updateUserLocation(data.lat,data.lng);
              }
              break;
            case 'updateHailContours':
              if(data.contours){
                window.updateHailContours(data.contours);
              }
              break;
            case 'updateVerifiedReports':
              if(data.reports){
                window.updateVerifiedReports(data.reports);
              }
              break;
            case 'centerOnUser':
              window.centerOnUser();
              break;
            case 'toggleMapType':
              window.toggleMapType();
              break;
            case 'centerOnLocation':
              if(data.lat&&data.lng){
                window.centerOnLocation(data.lat,data.lng,data.zoom);
              }
              break;
            case 'focusOnBounds':
              if(data.bounds){
                window.focusOnBounds(data.bounds);
              }
              break;
            case 'focusOnHail':
              window.focusOnHail();
              break;
            case 'updateKnocksDifferential':
              if(data.added||data.updated||data.removed){
                window.updateKnocksDifferential({
                  added:data.added||[],
                  updated:data.updated||[],
                  removed:data.removed||[]
                });
              }
              break;
            case 'updateSingleKnock':
              if(data.knock){
                window.updateSingleKnock(data.knock);
              }
              break;
          }
        }catch(e){
          console.error('Error handling message:',e);
        }
      });
      
      // iOS message handler
      window.addEventListener('message',function(event){
        document.dispatchEvent(new MessageEvent('message',{data:event.data}));
      });
      
      // Initialize user location if provided
      ${userLocation ? `window.updateUserLocation(${userLocation.lat},${userLocation.lng});` : ''}
      
      console.log('Map initialized successfully with viewport culling');
      console.log('Viewport culling is '+(viewportCullingEnabled?'ENABLED':'DISABLED'));
      
      // Notify React Native that map is ready
      if(window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type:'mapReady'
        }));
      }
    }catch(e){
      console.error('Error initializing map:',e.message);
    }
  }else{
    console.error('Leaflet failed to load');
  }
},100);
</script>
</body>
</html>`;
  }, [userLocation?.lat, userLocation?.lng]);

  useEffect(() => {
    if (!isLoading && webViewRef.current) {
      console.log('Sending knocks to WebView:', knocks.length);
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateKnocks',
        knocks: knocks
      }));
      
      // Store current knocks for reference
      const updateCurrentKnocks = `window.currentKnocks = ${JSON.stringify(knocks)};`;
      webViewRef.current.injectJavaScript(updateCurrentKnocks);
    }
  }, [knocks, isLoading]);

  useEffect(() => {
    if (!isLoading && webViewRef.current && userLocation) {
      console.log('Updating user location:', userLocation);
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateUserLocation',
        lat: userLocation.lat,
        lng: userLocation.lng
      }));
    }
  }, [userLocation, isLoading]);

  useEffect(() => {
    if (!isLoading && webViewRef.current && hailContours) {
      console.log('WebMapOptimizedViewport - Sending hail contours to WebView:', hailContours);
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateHailContours',
        contours: hailContours
      }));
    }
  }, [hailContours, isLoading]);

  useEffect(() => {
    if (!isLoading && webViewRef.current && verifiedReports.length > 0) {
      console.log('Sending verified reports to WebView:', verifiedReports.length);
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateVerifiedReports',
        reports: verifiedReports
      }));
    }
  }, [verifiedReports, isLoading]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('WebMapOptimizedViewport received message:', data.type);
      
      switch (data.type) {
        case 'knockClick':
          KnockDebugger.log('🗺️ WebView click', {
            hasId: !!data.knock?.id,
            latitude: data.knock?.latitude,
            longitude: data.knock?.longitude
          });
          onKnockClick?.(data.knock);
          break;
        case 'knockClear':
          onKnockClear?.(data.knockId);
          break;
        case 'mapReady':
          console.log('Map is ready!');
          setIsLoading(false);
          onMapReady?.();
          break;
        case 'console':
          console.log('[WebView]:', data.message);
          break;
      }
    } catch (error) {
      console.error('Error handling WebView message:', error);
    }
  };

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
            <Text style={styles.loadingText}>Loading map with viewport culling...</Text>
          </View>
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.error('WebView error:', nativeEvent);
        }}
      />
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
    backgroundColor: 'white',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#6b7280',
  },
});

export default WebMapOptimizedViewport;
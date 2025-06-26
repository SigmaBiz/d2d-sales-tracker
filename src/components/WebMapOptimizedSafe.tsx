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

const WebMapOptimizedSafe = React.forwardRef<WebView, WebMapProps>(({ knocks, userLocation, onKnockClick, onKnockClear, onMapReady, hailContours = null, activeStorms = [], verifiedReports = [] }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  console.log('WebMapOptimizedSafe render - hailContours prop:', hailContours);

  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  // OPTIMIZATION: Safer minified HTML with better structure
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
      
      // Update knocks function
      window.updateKnocks=function(knocksData){
        console.log('Updating '+knocksData.length+' knocks with clustering');
        
        var currentKnockIds=new Set(knocksData.map(function(k){return k.id}));
        
        // Remove deleted markers
        knockMarkerMap.forEach(function(marker,id){
          if(!currentKnockIds.has(id)){
            markerClusterGroup.removeLayer(marker);
            knockMarkerMap.delete(id);
          }
        });
        
        // Add or update markers
        knocksData.forEach(function(knock){
          var existingMarker=knockMarkerMap.get(knock.id);
          if(existingMarker){
            markerClusterGroup.removeLayer(existingMarker);
            knockMarkerMap.delete(knock.id);
          }
          
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
        });
        
        if(!map.hasLayer(markerClusterGroup)){
          map.addLayer(markerClusterGroup);
        }
      };
      
      // Update knocks differentially for better performance
      window.updateKnocksDifferential=function(changes){
        console.log('Applying differential update:',changes.added.length,'added,',changes.updated.length,'updated,',changes.removed.length,'removed');
        
        // Remove deleted knocks
        changes.removed.forEach(function(knockId){
          var marker=knockMarkerMap.get(knockId);
          if(marker){
            markerClusterGroup.removeLayer(marker);
            knockMarkerMap.delete(knockId);
          }
        });
        
        // Helper function to create/update a marker
        var createOrUpdateMarker=function(knock){
          // Remove existing marker if any
          var existingMarker=knockMarkerMap.get(knock.id);
          if(existingMarker){
            markerClusterGroup.removeLayer(existingMarker);
            knockMarkerMap.delete(knock.id);
          }
          
          // Create new marker
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
        };
        
        // Add new knocks
        changes.added.forEach(createOrUpdateMarker);
        
        // Update existing knocks
        changes.updated.forEach(createOrUpdateMarker);
        
        console.log('Differential update applied successfully');
      };
      
      // Update single knock for real-time updates
      window.updateSingleKnock=function(knock){
        console.log('Updating single knock:',knock.id,knock.outcome);
        
        // Find and remove existing marker if any
        var existingMarker=knockMarkerMap.get(knock.id);
        if(existingMarker){
          markerClusterGroup.removeLayer(existingMarker);
          knockMarkerMap.delete(knock.id);
        }
        
        // Create new marker with updated data
        var color=colors[knock.outcome]||'#6b7280';
        var emoji=emojis[knock.outcome]||'📍';
        
        var icon=L.divIcon({
          html:'<div style="background-color:'+color+';width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">'+emoji+'</div>',
          iconSize:[24,24],
          iconAnchor:[12,12],
          className:'custom-div-icon'
        });
        
        // Build popup content (same as in updateKnocks)
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
        
        console.log('Single knock updated successfully');
      };
      
      // Update user location
      window.updateUserLocation=function(lat,lng){
        if(userMarker){
          userMarker.setLatLng([lat,lng]);
        }else{
          var userIcon=L.divIcon({
            html:'<div style="width:16px;height:16px;background-color:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"><div style="width:40px;height:40px;background-color:rgba(59,130,246,0.2);border-radius:50%;position:absolute;top:-12px;left:-12px;animation:pulse 2s infinite;"></div></div>',
            iconSize:[16,16],
            iconAnchor:[8,8]
          });
          userMarker=L.marker([lat,lng],{icon:userIcon}).addTo(map);
        }
      };
      
      // Center on user
      window.centerOnUser=function(){
        if(userMarker){
          map.setView(userMarker.getLatLng(),16);
        }
      };
      
      // Edit and clear functions
      window.editKnock=function(knockId){
        if(window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'editKnock',
            knockId:knockId
          }));
        }
      };
      
      window.clearKnock=function(knockId){
        if(window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'clearKnock',
            knockId:knockId
          }));
        }
      };
      
      // Verified reports
      window.updateVerifiedReports=function(reports){
        console.log('updateVerifiedReports called with',reports.length,'reports');
        
        verifiedMarkers.forEach(function(marker){
          map.removeLayer(marker);
        });
        verifiedMarkers=[];
        
        reports.forEach(function(report){
          var icon=L.divIcon({
            html:'<div style="background-color:#10b981;width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;position:relative;">'+
                  '<div style="font-size:18px;color:white;">✓</div>'+
                  '<div style="position:absolute;bottom:-4px;right:-4px;background-color:white;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);">'+
                  '<div style="font-size:12px;">🧊</div>'+
                  '</div>'+
                  '</div>',
            iconSize:[32,32],
            iconAnchor:[16,16],
            className:'verified-marker'
          });
          
          var popupContent='<div style="font-size:14px;">';
          popupContent+='<h4 style="margin:0 0 8px 0;color:#10b981;">✓ Verified Hail Report</h4>';
          popupContent+='<p style="margin:4px 0;"><strong>Size:</strong> '+report.size.toFixed(2)+' inches</p>';
          popupContent+='<p style="margin:4px 0;"><strong>Time:</strong> '+new Date(report.timestamp).toLocaleString()+'</p>';
          popupContent+='<p style="margin:4px 0;"><strong>Location:</strong> '+(report.city||'Unknown')+'</p>';
          popupContent+='<p style="margin:4px 0;"><strong>Source:</strong> '+(report.source||'NOAA Storm Events')+'</p>';
          popupContent+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;color:#10b981;font-style:italic;">This is a verified ground truth report from the NOAA Storm Events Database</div>';
          popupContent+='</div>';
          
          var marker=L.marker([report.latitude,report.longitude],{icon:icon})
            .bindPopup(popupContent)
            .addTo(map);
          
          marker.on('mouseover',function(){
            this.getElement().style.transform='scale(1.1)';
          });
          marker.on('mouseout',function(){
            this.getElement().style.transform='scale(1)';
          });
          
          verifiedMarkers.push(marker);
        });
        
        console.log('Added',verifiedMarkers.length,'verified report markers');
      };
      
      // Hail contours
      window.updateHailContours=function(contourData){
        console.log('updateHailContours called with:',contourData);
        
        if(hailContourLayer){
          map.removeLayer(hailContourLayer);
          hailContourLayer=null;
        }
        
        if(!contourData||!contourData.features||contourData.features.length===0){
          console.log('No contour features to display');
          return;
        }
        
        console.log('Adding',contourData.features.length,'contour features to map');
        
        var sortedFeatures=contourData.features.sort(function(a,b){
          return b.properties.level-a.properties.level;
        });
        
        hailContourLayer=L.geoJSON({
          type:'FeatureCollection',
          features:sortedFeatures
        },{
          style:function(feature){
            return{
              fillColor:feature.properties.color,
              fillOpacity:0.3,
              color:feature.properties.color,
              weight:2,
              opacity:0.8
            };
          },
          onEachFeature:function(feature,layer){
            var props=feature.properties;
            var popupContent='<div style="font-size:14px;">';
            popupContent+='<h4 style="margin:0 0 8px 0;color:'+props.color+';">Hail Zone</h4>';
            popupContent+='<p style="margin:4px 0;"><strong>Size Range:</strong> '+props.description+'</p>';
            popupContent+='<p style="margin:4px 0;font-style:italic;color:#6b7280;">Click anywhere in this zone to start canvassing</p>';
            popupContent+='</div>';
            layer.bindPopup(popupContent);
          }
        }).addTo(map);
        
        hailContourLayer.bringToBack();
        console.log('Hail contour layer added to map');
        
        try{
          var bounds=hailContourLayer.getBounds();
          console.log('Contour bounds:',bounds);
          
          if(bounds.isValid()){
            var sw=bounds.getSouthWest();
            var ne=bounds.getNorthEast();
            console.log('SouthWest:',sw.lat,sw.lng,'NorthEast:',ne.lat,ne.lng);
            
            if(Math.abs(sw.lat)<1&&Math.abs(sw.lng)<1){
              console.log('WARNING: Bounds are near 0,0 - likely invalid coordinates');
              map.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]});
            }else{
              console.log('Fitting map to valid hail contour bounds');
              map.fitBounds(bounds,{padding:[50,50]});
            }
          }else{
            console.log('Bounds are not valid, using Oklahoma default bounds');
            map.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]});
          }
        }catch(e){
          console.log('Could not fit bounds:',e);
          map.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]});
        }
      };
      
      // Map click handler
      map.on('click',function(e){
        if(window.ReactNativeWebView){
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type:'mapClick',
            lat:e.latlng.lat,
            lng:e.latlng.lng
          }));
        }
      });
      
      // Initial data - only user location, knocks handled by parent component
      ${userLocation?`updateUserLocation(${userLocation.lat},${userLocation.lng});`:''}
      
      // Message listener
      window.addEventListener('message',function(event){
        console.log('WebView received message:',event.data?event.data.substring(0,100)+'...':'empty');
        try{
          var data=JSON.parse(event.data);
          console.log('Parsed message type:',data.type);
          if(data.type==='updateKnocks'){
            updateKnocks(data.knocks);
          }else if(data.type==='updateUserLocation'){
            updateUserLocation(data.lat,data.lng);
          }else if(data.type==='centerOnUser'){
            centerOnUser();
          }else if(data.type==='updateHailContours'){
            console.log('Received updateHailContours message');
            updateHailContours(data.contourData);
          }else if(data.type==='focusOnHail'){
            console.log('Focusing on hail contours');
            if(hailContourLayer){
              try{
                var bounds=hailContourLayer.getBounds();
                if(bounds.isValid()){
                  var sw=bounds.getSouthWest();
                  var ne=bounds.getNorthEast();
                  if(Math.abs(sw.lat)<1&&Math.abs(sw.lng)<1){
                    map.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]});
                  }else{
                    map.fitBounds(bounds,{padding:[50,50]});
                  }
                }
              }catch(e){
                console.log('Could not focus on hail:',e);
              }
            }
          }else if(data.type==='focusOnBounds'){
            console.log('Focusing on specific bounds:',data.bounds);
            if(data.bounds){
              try{
                var leafletBounds=L.latLngBounds(
                  [data.bounds.south,data.bounds.west],
                  [data.bounds.north,data.bounds.east]
                );
                map.fitBounds(leafletBounds,{padding:[50,50]});
              }catch(e){
                console.log('Could not focus on bounds:',e);
              }
            }
          }else if(data.type==='toggleMapType'){
            console.log('Toggling map type');
            if(window.toggleMapType){
              window.toggleMapType();
            }
          }else if(data.type==='centerOnLocation'){
            console.log('Centering on location:',data.lat,data.lng);
            if(data.lat&&data.lng){
              var zoom=data.zoom||13;
              map.setView([data.lat,data.lng],zoom);
            }
          }else if(data.type==='updateVerifiedReports'){
            console.log('Received updateVerifiedReports message');
            updateVerifiedReports(data.reports);
          }else if(data.type==='updateSingleKnock'){
            console.log('Received updateSingleKnock message');
            updateSingleKnock(data.knock);
          }else if(data.type==='updateKnocksDifferential'){
            console.log('Received updateKnocksDifferential message');
            updateKnocksDifferential(data);
          }
        }catch(e){
          console.error('Message error:',e);
        }
      });
      
      // Send ready message
      console.log('Map initialized, sending ready message');
      if(window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
      }
    }catch(e){
      console.error('Error initializing map:',e);
      document.body.innerHTML='<div style="padding:20px;">Error: '+e.message+'</div>';
      if(window.ReactNativeWebView){
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type:'mapError',
          error:e.message
        }));
      }
    }
  }else{
    console.log('Leaflet not loaded');
    document.body.innerHTML='<div style="padding:20px;">Leaflet failed to load. Try refreshing.</div>';
    if(window.ReactNativeWebView){
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type:'mapError',
        error:'Leaflet library not loaded'
      }));
    }
  }
},1000);
</script>
</body>
</html>`;
  }, []);

  // Track if we have pending contours to send
  const [pendingContours, setPendingContours] = useState<any>(null);

  // Removed duplicate knock update - now handled by parent component with differential updates

  useEffect(() => {
    if (!isLoading && webViewRef.current && userLocation) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateUserLocation',
        lat: userLocation.lat,
        lng: userLocation.lng
      }));
    }
  }, [userLocation, isLoading]);

  useEffect(() => {
    console.log('WebMapOptimizedSafe hailContours useEffect - isLoading:', isLoading, 'webViewRef.current:', !!webViewRef.current, 'hailContours:', hailContours);
    if (!isLoading && webViewRef.current) {
      if (hailContours !== undefined) {
        console.log('Sending hail contours to WebView:', hailContours);
        try {
          const message = JSON.stringify({
            type: 'updateHailContours',
            contourData: hailContours
          });
          console.log('Stringified message length:', message.length);
          webViewRef.current.postMessage(message);
          setPendingContours(null);
        } catch (error) {
          console.error('Error stringifying hail contours:', error);
        }
      }
    } else if (isLoading && hailContours) {
      console.log('Map still loading, storing hail contours as pending');
      setPendingContours(hailContours);
    }
  }, [hailContours, isLoading]);

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

  useEffect(() => {
    console.log('WebMapOptimizedSafe verifiedReports useEffect - isLoading:', isLoading, 'verifiedReports count:', verifiedReports.length);
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
        console.log('WebMapOptimizedSafe received mapReady message');
        setIsLoading(false);
        if (onMapReady) {
          onMapReady();
        }
      } else if (data.type === 'mapError') {
        console.error('WebMapOptimizedSafe error:', data.error);
        setIsLoading(false);
      } else if (data.type === 'mapClick') {
        KnockDebugger.startSession();
        KnockDebugger.log('🗺️ Map clicked', {
          latitude: data.lat,
          longitude: data.lng
        });
        
        if (onKnockClick) {
          KnockDebugger.log('📤 Passing click to parent handler');
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
        } else {
          KnockDebugger.error('No onKnockClick handler provided', null);
        }
      } else if (data.type === 'editKnock') {
        const knock = knocks.find(k => k.id === data.knockId);
        if (knock && onKnockClick) {
          onKnockClick(knock);
        }
      } else if (data.type === 'clearKnock') {
        if (onKnockClear) {
          onKnockClear(data.knockId);
        }
      }
    } catch (error) {
      console.error('WebMapOptimizedSafe message error:', error);
    }
  };

  // OPTIMIZATION: Reduce timeout from 3s to 2s
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

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

export default WebMapOptimizedSafe;

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
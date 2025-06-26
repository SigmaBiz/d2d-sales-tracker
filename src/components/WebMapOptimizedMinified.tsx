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
  hailContours?: any;
  activeStorms?: string[];
  verifiedReports?: any[];
}

const WebMapOptimizedMinified = React.forwardRef<WebView, WebMapProps>(({ knocks, userLocation, onKnockClick, onKnockClear, hailContours = null, activeStorms = [], verifiedReports = [] }, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);

  console.log('WebMapOptimizedMinified render - hailContours prop:', hailContours);

  React.useImperativeHandle(ref, () => webViewRef.current as WebView);

  // OPTIMIZATION: Minified HTML with same functionality
  const mapHTML = React.useMemo(() => {
    // Minify colors and emojis objects
    const colorsStr = JSON.stringify({
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
    });
    
    const emojisStr = JSON.stringify({
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
    });

    // Minified CSS
    const minCSS = `body{margin:0;padding:0}#map{height:100vh;width:100vw}.marker-cluster-small{background-color:rgba(110,204,57,0.6)}.marker-cluster-medium{background-color:rgba(240,194,12,0.6)}.marker-cluster-large{background-color:rgba(241,128,23,0.6)}.marker-cluster div{background-color:rgba(255,255,255,0.9);font-weight:bold}@keyframes pulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2);opacity:0}}.leaflet-control-layers{position:fixed!important;right:16px!important;bottom:240px!important;top:auto!important;margin:0!important}.custom-div-icon{background:transparent!important;border:none!important}.verified-marker{background:transparent!important;border:none!important;transition:transform 0.2s ease}`;

    // Minified JavaScript
    const minJS = `var c=${colorsStr},e=${emojisStr},ol=console.log;
console.log=function(){ol.apply(console,arguments);window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'console',message:Array.from(arguments).join(' ')}))};
console.log('Waiting for Leaflet to load...');
setTimeout(function(){
console.log('Checking if Leaflet loaded...');
if(typeof L!=='undefined'){
console.log('Leaflet loaded successfully!');
try{
var m=L.map('map').setView([${userLocation?.lat||35.4676},${userLocation?.lng||-97.5164}],13),
sl=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}),
sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'Tiles © Esri'});
sl.addTo(m);
var cl='street';
window.toggleMapType=function(){if(cl==='street'){m.removeLayer(sl);m.addLayer(sat);cl='satellite'}else{m.removeLayer(sat);m.addLayer(sl);cl='street'}};
var mcg=L.markerClusterGroup({maxClusterRadius:80,spiderfyOnMaxZoom:true,showCoverageOnHover:false,zoomToBoundsOnClick:true,disableClusteringAtZoom:18,
iconCreateFunction:function(cluster){var n=cluster.getChildCount(),s=n<10?'small':n<100?'medium':'large';
return new L.DivIcon({html:'<div><span>'+n+'</span></div>',className:'marker-cluster marker-cluster-'+s,iconSize:new L.Point(40,40)})}});
var um=null,hcl=null,vm=[],kmm=new Map();
window.updateKnocks=function(kd){
var cki=new Set(kd.map(function(k){return k.id}));
kmm.forEach(function(marker,id){if(!cki.has(id)){mcg.removeLayer(marker);kmm.delete(id)}});
kd.forEach(function(k){
var em=kmm.get(k.id);
if(em){mcg.removeLayer(em);kmm.delete(k.id)}
var col=c[k.outcome]||'#6b7280',emo=e[k.outcome]||'📍';
var icon=L.divIcon({html:'<div style="background-color:'+col+';width:24px;height:24px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px;">'+emo+'</div>',iconSize:[24,24],iconAnchor:[12,12],className:'custom-div-icon'});
var pc='<div style="font-size:14px;"><h4 style="margin:0 0 8px 0;color:#1e40af;">'+emo+' '+k.outcome.replace(/_/g,' ').toUpperCase()+'</h4>';
pc+='<p style="margin:4px 0;"><strong>Address:</strong> '+(k.address||'No address')+'</p>';
pc+='<p style="margin:4px 0;"><strong>Time:</strong> '+new Date(k.timestamp).toLocaleString()+'</p>';
if(k.history&&k.history.length>0){pc+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;"><strong>History:</strong>';
k.history.forEach(function(h){var he=e[h.outcome]||'📍';pc+='<br><span style="color:#6b7280;font-size:12px;">'+he+' '+h.outcome.replace(/_/g,' ')+' - '+new Date(h.timestamp).toLocaleDateString()+'</span>'});pc+='</div>'}
if(k.notes){pc+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;"><strong>Notes:</strong><br>'+k.notes.replace(/\\n/g,'<br>')+'</div>'}
pc+='<div style="margin-top:10px;"><button onclick="window.editKnock(\\''+k.id+'\\')" style="background-color:#1e40af;color:white;padding:8px 16px;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-right:8px;">Edit</button>';
pc+='<button onclick="window.clearKnock(\\''+k.id+'\\')" style="background-color:#ef4444;color:white;padding:8px 16px;border:none;border-radius:6px;font-size:14px;cursor:pointer;">Clear</button></div></div>';
var marker=L.marker([k.latitude,k.longitude],{icon:icon}).bindPopup(pc);
mcg.addLayer(marker);kmm.set(k.id,marker)});
if(!m.hasLayer(mcg)){m.addLayer(mcg)}};
window.updateUserLocation=function(lat,lng){
if(um){um.setLatLng([lat,lng])}else{
var ui=L.divIcon({html:'<div style="width:16px;height:16px;background-color:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"><div style="width:40px;height:40px;background-color:rgba(59,130,246,0.2);border-radius:50%;position:absolute;top:-12px;left:-12px;animation:pulse 2s infinite;"></div></div>',iconSize:[16,16],iconAnchor:[8,8]});
um=L.marker([lat,lng],{icon:ui}).addTo(m)}};
window.centerOnUser=function(){if(um){m.setView(um.getLatLng(),16)}};
window.editKnock=function(id){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'editKnock',knockId:id}))};
window.clearKnock=function(id){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'clearKnock',knockId:id}))};
window.updateVerifiedReports=function(r){
vm.forEach(function(marker){m.removeLayer(marker)});vm=[];
r.forEach(function(rp){
var icon=L.divIcon({html:'<div style="background-color:#10b981;width:32px;height:32px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;position:relative;"><div style="font-size:18px;color:white;">✓</div><div style="position:absolute;bottom:-4px;right:-4px;background-color:white;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);"><div style="font-size:12px;">🧊</div></div></div>',iconSize:[32,32],iconAnchor:[16,16],className:'verified-marker'});
var pc='<div style="font-size:14px;"><h4 style="margin:0 0 8px 0;color:#10b981;">✓ Verified Hail Report</h4>';
pc+='<p style="margin:4px 0;"><strong>Size:</strong> '+rp.size.toFixed(2)+' inches</p>';
pc+='<p style="margin:4px 0;"><strong>Time:</strong> '+new Date(rp.timestamp).toLocaleString()+'</p>';
pc+='<p style="margin:4px 0;"><strong>Location:</strong> '+(rp.city||'Unknown')+'</p>';
pc+='<p style="margin:4px 0;"><strong>Source:</strong> '+(rp.source||'NOAA Storm Events')+'</p>';
pc+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;color:#10b981;font-style:italic;">This is a verified ground truth report from the NOAA Storm Events Database</div></div>';
var marker=L.marker([rp.latitude,rp.longitude],{icon:icon}).bindPopup(pc).addTo(m);
marker.on('mouseover',function(){this.getElement().style.transform='scale(1.1)'});
marker.on('mouseout',function(){this.getElement().style.transform='scale(1)'});
vm.push(marker)})};
window.updateHailContours=function(cd){
if(hcl){m.removeLayer(hcl);hcl=null}
if(!cd||!cd.features||cd.features.length===0)return;
var sf=cd.features.sort(function(a,b){return b.properties.level-a.properties.level});
hcl=L.geoJSON({type:'FeatureCollection',features:sf},{
style:function(f){return{fillColor:f.properties.color,fillOpacity:0.3,color:f.properties.color,weight:2,opacity:0.8}},
onEachFeature:function(f,l){
var p=f.properties,pc='<div style="font-size:14px;"><h4 style="margin:0 0 8px 0;color:'+p.color+';">Hail Zone</h4>';
pc+='<p style="margin:4px 0;"><strong>Size Range:</strong> '+p.description+'</p>';
pc+='<p style="margin:4px 0;font-style:italic;color:#6b7280;">Click anywhere in this zone to start canvassing</p></div>';
l.bindPopup(pc)}}).addTo(m);
hcl.bringToBack();
try{var b=hcl.getBounds();if(b.isValid()){var sw=b.getSouthWest(),ne=b.getNorthEast();
if(Math.abs(sw.lat)<1&&Math.abs(sw.lng)<1){m.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]})}
else{m.fitBounds(b,{padding:[50,50]})}}else{m.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]})}}
catch(e){m.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]})}};
m.on('click',function(e){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}))});
${knocks.length>0?`updateKnocks(${JSON.stringify(knocks)});`:''}
${userLocation?`updateUserLocation(${userLocation.lat},${userLocation.lng});`:''}
window.addEventListener('message',function(ev){
try{var d=JSON.parse(ev.data);
if(d.type==='updateKnocks')updateKnocks(d.knocks);
else if(d.type==='updateUserLocation')updateUserLocation(d.lat,d.lng);
else if(d.type==='centerOnUser')centerOnUser();
else if(d.type==='updateHailContours')updateHailContours(d.contourData);
else if(d.type==='focusOnHail'&&hcl){try{var b=hcl.getBounds();if(b.isValid()){var sw=b.getSouthWest(),ne=b.getNorthEast();
if(Math.abs(sw.lat)<1&&Math.abs(sw.lng)<1){m.fitBounds([[33.6,-103.0],[37.0,-94.4]],{padding:[50,50]})}
else{m.fitBounds(b,{padding:[50,50]})}}catch(e){}}
else if(d.type==='focusOnBounds'&&d.bounds){try{var lb=L.latLngBounds([d.bounds.south,d.bounds.west],[d.bounds.north,d.bounds.east]);
m.fitBounds(lb,{padding:[50,50]})}catch(e){}}
else if(d.type==='toggleMapType')window.toggleMapType&&window.toggleMapType();
else if(d.type==='centerOnLocation'&&d.lat&&d.lng)m.setView([d.lat,d.lng],d.zoom||13);
else if(d.type==='updateVerifiedReports')updateVerifiedReports(d.reports)}catch(e){}});
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}))}
catch(e){console.error('Error initializing map:', e);document.body.innerHTML='<div style="padding:20px;">Error: '+e.message+'<br>Stack: '+e.stack+'</div>';
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapError',error:e.message}))}}
else{console.log('Leaflet not loaded');document.body.innerHTML='<div style="padding:20px;">Leaflet failed to load. Try refreshing.</div>';
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapError',error:'Leaflet library not loaded'}))}},1000);`;

    return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/><link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script><style>${minCSS}</style></head><body><div id="map"></div><script>${minJS}</script></body></html>`;
  }, []);

  // Track if we have pending contours to send
  const [pendingContours, setPendingContours] = useState<any>(null);

  useEffect(() => {
    console.log('WebMapOptimizedMinified knocks useEffect - isLoading:', isLoading, 'knocks count:', knocks.length);
    if (!isLoading && webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'updateKnocks',
        knocks: knocks
      }));
    }
  }, [knocks, isLoading]);

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
    console.log('WebMapOptimizedMinified hailContours useEffect - isLoading:', isLoading, 'webViewRef.current:', !!webViewRef.current, 'hailContours:', hailContours);
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
    console.log('WebMapOptimizedMinified verifiedReports useEffect - isLoading:', isLoading, 'verifiedReports count:', verifiedReports.length);
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
        console.log('WebMapOptimizedMinified received mapReady message');
        setIsLoading(false);
      } else if (data.type === 'mapError') {
        console.error('WebMapOptimizedMinified error:', data.error);
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
      console.error('WebMapOptimizedMinified message error:', error);
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

export default WebMapOptimizedMinified;

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
# WebView Hail Contour Display Debug Guide

## Issue Summary
The hail contour GeoJSON data is being generated correctly but not rendering in the WebView's Leaflet map.

## Key Findings

### 1. WebView Communication Bridge
- **PostMessage is working**: Messages are being sent from React Native to WebView
- **Message size**: No apparent size limits hit (typical limit is ~100MB for React Native WebView)
- **Timing issue identified**: The map might not be fully initialized when contours are sent

### 2. Lifecycle and Timing Issues
- The WebView loads asynchronously and Leaflet initialization takes ~2 seconds
- Hail contours might be sent before the map is ready to receive them
- The current implementation has a race condition between map initialization and data sending

### 3. Data Structure Validation
The GeoJSON structure appears correct:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "level": 1.0,
        "color": "rgba(255, 215, 0, 0.5)",
        "description": "1-1.5\" (Quarter-Walnut)"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[lng, lat], ...]]
      }
    }
  ]
}
```

## Root Causes Identified

1. **Race Condition**: The `updateHailContours` function is called before Leaflet's L.geoJSON is ready
2. **Missing Error Handling**: Silent failures in the WebView JavaScript
3. **Incorrect Message Handling**: The WebView's message event listener might not be properly attached
4. **Console Logging Override**: The console.log override might interfere with error reporting

## Recommended Fixes

### Fix 1: Ensure Proper Initialization Order
```javascript
// In WebView HTML
var mapInitialized = false;
var pendingContours = null;

function initMap() {
  // ... initialize map ...
  mapInitialized = true;
  
  // Process any pending contours
  if (pendingContours) {
    updateHailContours(pendingContours);
    pendingContours = null;
  }
}

function updateHailContours(contourData) {
  if (!mapInitialized) {
    pendingContours = contourData;
    return;
  }
  // ... rest of function ...
}
```

### Fix 2: Add Explicit Error Boundaries
```javascript
window.onerror = function(msg, url, line, col, error) {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'error',
      message: msg,
      stack: error ? error.stack : 'No stack trace'
    }));
  }
  return true;
};
```

### Fix 3: Validate GeoJSON Before Rendering
```javascript
function validateGeoJSON(data) {
  if (!data || data.type !== 'FeatureCollection') return false;
  if (!Array.isArray(data.features)) return false;
  
  return data.features.every(feature => {
    return feature.type === 'Feature' &&
           feature.geometry &&
           feature.geometry.coordinates &&
           feature.properties;
  });
}
```

### Fix 4: Use WebMapFixed Component
The WebMapFixed component I created addresses these issues with:
- Proper initialization sequencing
- MapReady state tracking
- Deferred message sending
- Better error handling

## Testing Steps

1. **Use WebMapDebug component** to see detailed logs:
   ```tsx
   import WebMapDebug from '../components/WebMapDebug';
   // Replace WebMap with WebMapDebug temporarily
   ```

2. **Test with static data**:
   ```tsx
   import { testContourData } from '../utils/testContourData';
   // Use testContourData instead of generated contours
   ```

3. **Check WebView console**:
   - Enable remote debugging for the WebView
   - Use Safari Web Inspector (iOS) or Chrome DevTools (Android)

4. **Verify Leaflet is loaded**:
   ```javascript
   // Add to WebView HTML
   if (typeof L === 'undefined') {
     alert('Leaflet not loaded!');
   }
   ```

## Quick Fix Implementation

Replace the current WebMap import in RealMapScreen.tsx:
```tsx
// Change from:
import WebMap from '../components/WebMap';
// To:
import WebMap from '../components/WebMapFixed';
```

This should resolve the timing issues and ensure contours render properly.
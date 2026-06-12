/**
 * NativeMap — react-native-maps based map component.
 *
 * Hail swaths are rendered as smooth contour polygons using IDW interpolation
 * + d3-contour, matching the professional appearance of the old Leaflet WebView.
 *
 * Exposes imperative methods via ref:
 *   centerOnLocation(lat, lng, zoom?)
 *   fitToBounds(north, south, east, west)
 *   focusOnHail(reports)
 */

import React, { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import MapView, { Marker, Polygon, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { StyleSheet, Text, View } from 'react-native';
// @ts-ignore — no @types/d3-contour available
import { contours as d3contours } from 'd3-contour';
import { Knock, KNOCK_OUTCOME_EMOJI } from '../types';
import { HailReport } from '../services/mrmsService';

const RES = 0.01; // degrees per grid cell — matches MRMS native resolution
const PAD = 0.3;  // degrees of padding around the data extent so edges fade naturally
const THRESHOLDS = [0.75, 1.0, 1.5, 2.0];
const TARGET_CELLS = 40000; // hard cap on the interpolation grid (statewide guard)
const CUTOFF = 0.5;         // deg — pairs with the d2 > 0.25 influence cutoff below

function contourFillColor(threshold: number): string {
  if (threshold >= 2.0) return '#ef444438'; // red ~22% opacity
  if (threshold >= 1.5) return '#f9731638'; // orange
  if (threshold >= 1.0) return '#eab30838'; // yellow
  return '#84cc1638';                        // lime
}
function contourStrokeColor(threshold: number): string {
  if (threshold >= 2.0) return '#ef444477';
  if (threshold >= 1.5) return '#f9731677';
  if (threshold >= 1.0) return '#eab30877';
  return '#84cc1677';
}

// ── IDW interpolation + d3-contour ───────────────────────────────────────────
interface ContourPoly {
  key: string;
  threshold: number;
  coordinates: { latitude: number; longitude: number }[];
  holes: { latitude: number; longitude: number }[][];
}

function buildContours(meshReports: HailReport[]): ContourPoly[] {
  if (meshReports.length === 0) return [];

  // Compute bounds dynamically from actual data + padding so the swath is never
  // clipped. Loops, not Math.max(...spread): Hermes throws RangeError past
  // ~50k spread arguments, which statewide storms can exceed.
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const r of meshReports) {
    if (r.latitude < minLat) minLat = r.latitude;
    if (r.latitude > maxLat) maxLat = r.latitude;
    if (r.longitude < minLon) minLon = r.longitude;
    if (r.longitude > maxLon) maxLon = r.longitude;
  }
  const bounds = {
    north: maxLat + PAD,
    south: minLat - PAD,
    east:  maxLon + PAD,
    west:  minLon - PAD,
  };

  // Adaptive resolution: metro-size extents stay at native 0.01° (identical
  // output to the original); statewide extents coarsen (~0.03°) so the grid
  // never exceeds TARGET_CELLS — bounded compute regardless of storm size.
  const extentArea = (bounds.north - bounds.south) * (bounds.east - bounds.west);
  const res = Math.max(RES, Math.sqrt(extentArea / TARGET_CELLS));
  const gridW = Math.round((bounds.east - bounds.west) / res);
  const gridH = Math.round((bounds.north - bounds.south) / res);

  // Downsample inputs onto the render lattice when coarsened (max size wins —
  // preserves peak hail, dilates the swath by ≤ res/2). 0.01°-spaced points
  // add nothing to a coarser grid; this bounds the worst-case op count.
  let points = meshReports;
  if (res > RES) {
    const best = new Map<number, HailReport>();
    for (const r of meshReports) {
      const key = Math.round((r.latitude - bounds.south) / res) * 100000
                + Math.round((r.longitude - bounds.west) / res);
      const cur = best.get(key);
      if (!cur || r.size > cur.size) best.set(key, r);
    }
    points = Array.from(best.values());
  }

  // Spatial hash at CUTOFF-sized buckets: every report within 0.5° of a cell
  // lives in the cell's 3×3 bucket neighborhood, so the IDW loop scans only
  // those instead of every report. Same output as the brute-force loop (the
  // d2 > 0.25 cutoff already excluded everything farther).
  const bucketsW = Math.max(1, Math.ceil((bounds.east - bounds.west) / CUTOFF));
  const bucketsH = Math.max(1, Math.ceil((bounds.north - bounds.south) / CUTOFF));
  const buckets = new Map<number, HailReport[]>();
  for (const r of points) {
    const key = Math.floor((r.latitude - bounds.south) / CUTOFF) * bucketsW
              + Math.floor((r.longitude - bounds.west) / CUTOFF);
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, arr = []);
    arr.push(r);
  }

  // IDW interpolation
  const values = new Float64Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    const lat = bounds.north - y * res;
    const by = Math.floor((lat - bounds.south) / CUTOFF);
    for (let x = 0; x < gridW; x++) {
      const lon = bounds.west + x * res;
      const bx = Math.floor((lon - bounds.west) / CUTOFF);
      let wSum = 0;
      let wTot = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = by + dy;
        if (ny < 0 || ny >= bucketsH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          if (nx < 0 || nx >= bucketsW) continue;
          const arr = buckets.get(ny * bucketsW + nx);
          if (!arr) continue;
          for (const r of arr) {
            const ddx = lon - r.longitude;
            const ddy = lat - r.latitude;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 > 0.25) continue; // ~55km cutoff — fades smoothly beyond data edges
            const w = d2 < 1e-10 ? 1e10 : 1 / d2;
            wSum += r.size * w;
            wTot += w;
          }
        }
      }
      values[y * gridW + x] = wTot > 0 ? wSum / wTot : 0;
    }
  }

  // Generate contour polygons
  const contourGen = d3contours().size([gridW, gridH]).thresholds(THRESHOLDS);
  const features = contourGen(Array.from(values));

  const toLatLng = (ring: number[][]) =>
    ring.map(([x, y]) => ({
      latitude:  bounds.north - (y / gridH) * (bounds.north - bounds.south),
      longitude: bounds.west  + (x / gridW) * (bounds.east  - bounds.west),
    }));

  const result: ContourPoly[] = [];
  features.forEach((feature: any, fi: number) => {
    feature.coordinates.forEach((polygon: any, pi: number) => {
      if (polygon[0].length < 3) return;
      result.push({
        key: `c_${fi}_${pi}`,
        threshold: feature.value,
        coordinates: toLatLng(polygon[0]),
        holes: polygon.slice(1).map(toLatLng),
      });
    });
  });

  return result;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface NativeMapProps {
  knocks: Knock[];
  hailReports: HailReport[];
  verifiedReports: HailReport[];
  userLocation: { lat: number; lng: number } | null;
  mapType: 'standard' | 'satellite' | 'hybrid';
  onMapPress: (lat: number, lng: number) => void;
  onKnockPress: (knock: Knock) => void;
  searchedPin: { lat: number; lng: number; address: string } | null;
  onSearchedPinPress: () => void;
}

export interface NativeMapRef {
  centerOnLocation: (lat: number, lng: number, zoom?: number) => void;
  fitToBounds: (north: number, south: number, east: number, west: number) => void;
  focusOnHail: (reports: HailReport[]) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
const NativeMap = forwardRef<NativeMapRef, NativeMapProps>(({
  knocks,
  hailReports,
  verifiedReports,
  userLocation,
  mapType,
  onMapPress,
  onKnockPress,
  searchedPin,
  onSearchedPinPress,
}, ref) => {
  const mapRef = useRef<MapView>(null);

  // Compute contours only when hailReports changes — memoized to avoid re-running IDW on every render
  const contourPolygons = useMemo(() => {
    const meshReports = hailReports.filter(r => !r.groundTruth);
    return buildContours(meshReports);
  }, [hailReports]);

  // Default region — OKC Metro
  const initialRegion: Region = userLocation
    ? { latitude: userLocation.lat, longitude: userLocation.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : { latitude: 35.4676, longitude: -97.5164, latitudeDelta: 0.1, longitudeDelta: 0.1 };

  useImperativeHandle(ref, () => ({
    centerOnLocation(lat, lng, zoom = 0.01) {
      mapRef.current?.animateToRegion({
        latitude: lat,
        longitude: lng,
        latitudeDelta: zoom,
        longitudeDelta: zoom,
      }, 600);
    },

    fitToBounds(north, south, east, west) {
      mapRef.current?.fitToCoordinates(
        [
          { latitude: north, longitude: west },
          { latitude: south, longitude: east },
        ],
        { edgePadding: { top: 80, right: 40, bottom: 80, left: 40 }, animated: true }
      );
    },

    focusOnHail(reports) {
      if (!reports.length) return;
      const meshReports = reports.filter(r => !r.groundTruth);
      const coords = (meshReports.length > 0 ? meshReports : reports)
        .map(r => ({ latitude: r.latitude, longitude: r.longitude }));
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
        animated: true,
      });
    },
  }));

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_DEFAULT}
      mapType={mapType}
      initialRegion={initialRegion}
      showsUserLocation
      showsMyLocationButton={false}
      onPress={e => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        onMapPress(latitude, longitude);
      }}
    >
      {/* Hail contour polygons — smooth IDW-interpolated swaths, lowest threshold first */}
      {contourPolygons.map(poly => (
        <Polygon
          key={poly.key}
          coordinates={poly.coordinates}
          holes={poly.holes.length > 0 ? poly.holes : undefined}
          fillColor={contourFillColor(poly.threshold)}
          strokeColor={contourStrokeColor(poly.threshold)}
          strokeWidth={1}
        />
      ))}

      {/* SPC spotter markers — always visible regardless of zoom */}
      {verifiedReports.map((report, i) => (
        <Marker
          key={`spc_${i}`}
          coordinate={{ latitude: report.latitude, longitude: report.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={styles.spotterPin} pointerEvents="none">
            <Text style={styles.spotterText}>🌨️</Text>
          </View>
        </Marker>
      ))}

      {/* Searched-address pin — blue standard pin, distinct from emoji knocks.
          Press reopens the storm card; never enters the knock "Opened?" gate. */}
      {searchedPin && (
        <Marker
          coordinate={{ latitude: searchedPin.lat, longitude: searchedPin.lng }}
          pinColor="#2563eb"
          onPress={e => {
            e.stopPropagation();
            onSearchedPinPress();
          }}
        />
      )}

      {/* Knock markers — emoji pin */}
      {knocks.map(knock => (
        <Marker
          key={knock.id}
          coordinate={{ latitude: knock.latitude, longitude: knock.longitude }}
          onPress={e => {
            e.stopPropagation();
            onKnockPress(knock);
          }}
          tracksViewChanges={false}
        >
          <View style={styles.emojiPin} pointerEvents="none">
            <Text style={styles.emojiText}>
              {KNOCK_OUTCOME_EMOJI[knock.label] ?? '📍'}
            </Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
});

export default NativeMap;

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  emojiPin: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  emojiText: {
    fontSize: 22,
  },
  spotterPin: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
  spotterText: {
    fontSize: 16,
  },
});

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

  // Compute bounds dynamically from actual data + padding so the swath is never clipped
  const lats = meshReports.map(r => r.latitude);
  const lons = meshReports.map(r => r.longitude);
  const bounds = {
    north: Math.max(...lats) + PAD,
    south: Math.min(...lats) - PAD,
    east:  Math.max(...lons) + PAD,
    west:  Math.min(...lons) - PAD,
  };
  const gridW = Math.round((bounds.east - bounds.west) / RES);
  const gridH = Math.round((bounds.north - bounds.south) / RES);

  // IDW interpolation
  const values = new Float64Array(gridW * gridH);

  for (let y = 0; y < gridH; y++) {
    const lat = bounds.north - y * RES;
    for (let x = 0; x < gridW; x++) {
      const lon = bounds.west + x * RES;
      let wSum = 0;
      let wTot = 0;
      for (const r of meshReports) {
        const dx = lon - r.longitude;
        const dy = lat - r.latitude;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.25) continue; // ~55km cutoff — fades smoothly beyond data edges
        const w = d2 < 1e-10 ? 1e10 : 1 / d2;
        wSum += r.size * w;
        wTot += w;
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

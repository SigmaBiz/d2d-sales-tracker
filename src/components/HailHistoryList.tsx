/**
 * HailHistoryList — "which uploaded storms hit this point" rows.
 * Shared by the searched-pin storm card and the knock detail sheet.
 * Row tap loads that storm's swath ADDITIVELY (other storms' visibility
 * untouched — keeps compatibility with the future swath-visibility filter).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HailHistoryService, StormHit, HAIL_RADIUS_MILES } from '../services/hailHistoryService';
import { MRMSService } from '../services/mrmsService';
import { IEMArchiveService } from '../services/tier2IEMService';

interface HailHistoryListProps {
  lat: number;
  lng: number;
  onStormLoaded?: () => void; // parent refreshes overlays (loadHailData)
}

function formatStormDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

export default function HailHistoryList({ lat, lng, onStormLoaded }: HailHistoryListProps) {
  const [hits, setHits] = useState<StormHit[] | null>(null);
  const [lookupError, setLookupError] = useState(false);
  const [loadingDate, setLoadingDate] = useState<string | null>(null);

  const fetchHits = useCallback(async () => {
    setLookupError(false);
    setHits(null);
    try {
      setHits(await HailHistoryService.getStormsForPoint(lat, lng));
    } catch (err) {
      console.error('[HailHistory] lookup failed:', err);
      setLookupError(true);
    }
  }, [lat, lng]);

  useEffect(() => { fetchHits(); }, [fetchHits]);

  const handleLoadSwath = async (hit: StormHit) => {
    setLoadingDate(hit.date);
    try {
      const reports = await IEMArchiveService.fetchHistoricalStorm(new Date(`${hit.date}T12:00:00`));
      if (reports.length === 0) {
        Alert.alert('No swath data', `No processed swath found for ${formatStormDate(hit.date)}.`);
        return;
      }
      const storm = await MRMSService.groupIntoStormEvents(reports);
      const [y, m, d] = hit.date.split('-').map(Number);
      storm.startTime = new Date(y, m - 1, d, 12, 0, 0); // local noon — avoids UTC date shift
      storm.name = `OKC Metro - ${m}/${d}/${y}`;
      storm.source = 'IEM';
      await MRMSService.saveStormEvent(storm);
      onStormLoaded?.();
    } catch (err) {
      console.error('[HailHistory] swath load failed:', err);
      Alert.alert('Error', 'Failed to load the swath. Check your connection.');
    } finally {
      setLoadingDate(null);
    }
  };

  if (lookupError) {
    return (
      <View style={styles.stateRow}>
        <Text style={styles.errorText}>Couldn't check storms</Text>
        <TouchableOpacity onPress={fetchHits}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (hits === null) {
    return <ActivityIndicator size="small" color="#1e40af" style={styles.stateRow} />;
  }
  if (hits.length === 0) {
    return (
      <Text style={styles.emptyText}>
        No uploaded storms within {HAIL_RADIUS_MILES} mi of this address
      </Text>
    );
  }
  return (
    <View>
      {hits.map(hit => (
        <TouchableOpacity
          key={hit.date}
          style={styles.row}
          onPress={() => handleLoadSwath(hit)}
          disabled={loadingDate !== null}
        >
          <Text style={styles.rowDate}>🌩️ {formatStormDate(hit.date)}</Text>
          <Text style={styles.rowDetail}>
            {hit.maxSizeInches.toFixed(2)}″ max · {hit.nearestMiles.toFixed(1)} mi
          </Text>
          {loadingDate === hit.date
            ? <ActivityIndicator size="small" color="#1e40af" />
            : <Ionicons name="chevron-forward" size={16} color="#9ca3af" />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  rowDetail: {
    fontSize: 13,
    color: '#6b7280',
    marginRight: 8,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#ef4444',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
  },
  emptyText: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
});

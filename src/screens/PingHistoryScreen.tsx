import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabaseClient';

interface PingEntry {
  id: string;
  from_user_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  sent_at: string;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'just now';
}

export default function PingHistoryScreen() {
  const [pings, setPings] = useState<PingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPings = async () => {
    const { data, error } = await supabase
      .from('ping_log')
      .select('id, from_user_id, address, lat, lng, sent_at')
      .order('sent_at', { ascending: false })
      .limit(50);

    if (!error && data) setPings(data as PingEntry[]);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { loadPings(); }, []));
  const onRefresh = () => { setRefreshing(true); loadPings(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  if (pings.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No pings yet.</Text>
        <Text style={styles.emptySubtext}>Pings appear here when a canvasser taps "Ping Owner".</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={pings}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>🔔</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.address} numberOfLines={1}>
              {item.address ?? `${item.lat?.toFixed(4)}, ${item.lng?.toFixed(4)}`}
            </Text>
            <Text style={styles.meta}>Live Inspection · {timeAgo(item.sent_at)}</Text>
          </View>
          <Text style={styles.time}>
            {new Date(item.sent_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6', padding: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptySubtext: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  iconCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#dbeafe', justifyContent: 'center', alignItems: 'center',
  },
  icon: { fontSize: 18 },
  rowBody: { flex: 1 },
  address: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  time: { fontSize: 12, color: '#9ca3af' },
  separator: { height: 1, backgroundColor: '#f3f4f6' },
});

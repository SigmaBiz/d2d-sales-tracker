/**
 * Lead Log — the work-ledger feed.
 *
 * Lists active leads (knocks with a lifecycle status). Each row shows the address
 * (tap → "teleport" to that door on the map), a status pill, and the role-legal
 * action menu. RLS scopes visibility: a setter (member) sees their own leads, a
 * runner (owner) sees the whole team's.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SupabaseService } from '../services/supabaseService';
import { Knock } from '../types';
import {
  LeadStatus, Role, STATUS_LABEL, STATUS_COLOR,
} from '../services/leadLifecycle';
import LeadActionMenu from '../components/LeadActionMenu';

export default function LeadLogScreen({ navigation }: any) {
  const [leads, setLeads] = useState<Knock[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const [data, r] = await Promise.all([
      SupabaseService.getActiveLeads(),
      SupabaseService.getRole(),
    ]);
    setLeads(data);
    setRole(r);
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, []));
  const onRefresh = () => { setRefreshing(true); load(); };

  const teleport = (knock: Knock) => {
    (global as any).pendingLeadLocation = {
      lat: knock.latitude, lng: knock.longitude, knockId: knock.id,
    };
    navigation.navigate('Map');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  if (leads.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No active leads.</Text>
        <Text style={styles.emptySub}>
          Leads appear here once a setter pings an owner or schedules an inspection.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={leads}
      keyExtractor={item => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
      contentContainerStyle={{ padding: 12 }}
      renderItem={({ item }) => {
        const status = (item.status ?? null) as LeadStatus | null;
        return (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => teleport(item)}>
                <Text style={styles.address} numberOfLines={1}>
                  📍 {item.address ?? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`}
                </Text>
                <Text style={styles.meta}>
                  {item.service_type ? `${item.service_type} · ` : ''}cycle {item.cycle_number ?? 1}
                </Text>
              </TouchableOpacity>
              {status && (
                <View style={[styles.pill, { backgroundColor: STATUS_COLOR[status] }]}>
                  <Text style={styles.pillText}>{STATUS_LABEL[status]}</Text>
                </View>
              )}
            </View>
            <LeadActionMenu
              knockId={item.id}
              status={status}
              role={role}
              onTransitioned={() => load()}
            />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6', padding: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  address: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: 'white', fontSize: 12, fontWeight: '700' },
});

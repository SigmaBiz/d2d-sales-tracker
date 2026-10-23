/**
 * Lead Log — the work-ledger feed.
 *
 * Two views behind a segmented toggle:
 *  - Active: leads with a lifecycle status (pinged/scheduled/live…). Row shows the
 *    address (tap → "teleport" to that door on the map), a status pill, and the
 *    role-legal action menu. RLS scopes visibility: a setter (member) sees their
 *    own leads, a runner (owner) sees the whole team's.
 *  - Contacts: the follow-up "CRM" list — every non-terminal door with a callable
 *    phone number, defaulting to this week. Tap row → teleport; tap phone → dialer.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SupabaseService } from '../services/supabaseService';
import { Knock, KnockContact } from '../types';
import {
  LeadStatus, Role, STATUS_LABEL, STATUS_COLOR,
} from '../services/leadLifecycle';
import { rangeWindow } from '../utils/analytics';
import LeadActionMenu from '../components/LeadActionMenu';

type Mode = 'active' | 'contacts';
type ContactRange = 'week' | 'all';

/** "today" / "3d ago" style stamp for contact rows. */
function daysAgo(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

export default function LeadLogScreen({ navigation }: any) {
  const [mode, setMode] = useState<Mode>('active');
  const [range, setRange] = useState<ContactRange>('week');
  const [leads, setLeads] = useState<Knock[]>([]);
  const [contacted, setContacted] = useState<Array<{ knock: Knock; contact: KnockContact }>>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (m: Mode = mode, r: ContactRange = range) => {
    if (m === 'active') {
      const [data, rr] = await Promise.all([
        SupabaseService.getActiveLeads(),
        SupabaseService.getRole(true), // force — never show actions for a stale role
      ]);
      setLeads(data);
      setRole(rr);
    } else {
      const since = r === 'week'
        ? rangeWindow('week').start?.toISOString()
        : undefined;
      setContacted(await SupabaseService.getContactedDoors(since));
    }
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { load(); }, [mode, range]));
  const onRefresh = () => { setRefreshing(true); load(); };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setLoading(true);
    load(m);
  };
  const switchRange = (r: ContactRange) => {
    if (r === range) return;
    setRange(r);
    setLoading(true);
    load('contacts', r);
  };

  const teleport = (knock: Knock) => {
    (global as any).pendingLeadLocation = {
      lat: knock.latitude, lng: knock.longitude, knockId: knock.id,
    };
    navigation.navigate('Map');
  };

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.segment}>
        {(['active', 'contacts'] as Mode[]).map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.segmentBtn, mode === m && styles.segmentBtnOn]}
            onPress={() => switchMode(m)}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>
              {m === 'active' ? 'Active' : 'Contacts'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === 'contacts' && (
        <View style={styles.chips}>
          {(['week', 'all'] as ContactRange[]).map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, range === r && styles.chipOn]}
              onPress={() => switchRange(r)}
            >
              <Text style={[styles.chipText, range === r && styles.chipTextOn]}>
                {r === 'week' ? 'This Week' : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1e40af" />
        </View>
      </View>
    );
  }

  const empty = mode === 'active' ? leads.length === 0 : contacted.length === 0;
  if (empty) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {mode === 'active' ? 'No active leads.' : 'No contacts yet.'}
          </Text>
          <Text style={styles.emptySub}>
            {mode === 'active'
              ? 'Leads appear here once a setter pings an owner or schedules an inspection.'
              : range === 'week'
                ? 'Doors where you save a phone number show up here. Try "All" for older ones.'
                : 'Doors where you save a phone number show up here.'}
          </Text>
        </View>
      </View>
    );
  }

  if (mode === 'contacts') {
    return (
      <View style={styles.container}>
        {header}
        <FlatList
          data={contacted}
          keyExtractor={item => item.knock.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => {
            const { knock, contact } = item;
            const status = (knock.status ?? null) as LeadStatus | null;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => teleport(knock)}>
                    <Text style={styles.address} numberOfLines={1}>
                      📍 {knock.address ?? `${knock.latitude.toFixed(4)}, ${knock.longitude.toFixed(4)}`}
                    </Text>
                    <Text style={styles.contactName} numberOfLines={1}>
                      👤 {contact.name || 'No name'} · {daysAgo(knock.knocked_at)}
                    </Text>
                  </TouchableOpacity>
                  {status && (
                    <View style={[styles.pill, { backgroundColor: STATUS_COLOR[status] }]}>
                      <Text style={styles.pillText}>{STATUS_LABEL[status]}</Text>
                    </View>
                  )}
                </View>
                {contact.phone && (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => Linking.openURL(`tel:${contact.phone}`)}
                  >
                    <Text style={styles.callBtnText}>📞 {contact.phone}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <FlatList
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
                  {item.appointment_at && (
                    <Text style={styles.appt}>
                      📅 {new Date(item.appointment_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 20 },
  headerWrap: { paddingHorizontal: 12, paddingTop: 10 },
  segment: {
    flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 10, padding: 3,
  },
  segmentBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segmentBtnOn: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 },
  segmentText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  segmentTextOn: { color: '#1e40af' },
  chips: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14,
    backgroundColor: '#e5e7eb',
  },
  chipOn: { backgroundColor: '#1e40af' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  chipTextOn: { color: 'white' },
  card: {
    backgroundColor: 'white', borderRadius: 12, padding: 14, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  address: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' },
  contactName: { fontSize: 13, color: '#374151', marginTop: 3 },
  appt: { fontSize: 12, color: '#a16207', marginTop: 2, fontWeight: '600' },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: 'white', fontSize: 12, fontWeight: '700' },
  callBtn: {
    marginTop: 10, backgroundColor: '#eff6ff', borderRadius: 8,
    paddingVertical: 8, alignItems: 'center',
  },
  callBtnText: { color: '#1e40af', fontSize: 14, fontWeight: '700' },
});

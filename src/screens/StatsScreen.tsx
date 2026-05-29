import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SupabaseService } from '../services/supabaseService';
import { Knock, KnockOutcome, KNOCK_OUTCOME_EMOJI, KNOCK_OUTCOME_LABEL } from '../types';

// Mirrors the map gate's "opened" set — outcomes that require the door to open.
const OPENED_LABELS: KnockOutcome[] = [
  'conversation', 'not_interested', 'renter', 'inspected', 'lead', 'signed', 'follow_up',
];
const INSPECTION_LABELS: KnockOutcome[] = ['inspected', 'signed'];
const CLOSED_LABELS: KnockOutcome[] = ['signed'];

const ALL_LABELS: KnockOutcome[] = [
  'no_home', 'not_interested', 'no_soliciting', 'renter',
  'conversation', 'inspected', 'follow_up', 'lead', 'signed', 'scout',
];

function pct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

export default function StatsScreen() {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  const loadData = async () => {
    const [knocksData, teamData] = await Promise.all([
      SupabaseService.getKnocks(),
      SupabaseService.getMyTeam(),
    ]);
    setKnocks(knocksData);
    setIsOwner(teamData?.role === 'owner');
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const counts = knocks.reduce((acc, k) => {
    acc[k.label] = (acc[k.label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const total = knocks.length;
  const opened = OPENED_LABELS.reduce((s, l) => s + (counts[l] || 0), 0);
  const inspections = INSPECTION_LABELS.reduce((s, l) => s + (counts[l] || 0), 0);
  const closed = CLOSED_LABELS.reduce((s, l) => s + (counts[l] || 0), 0);

  const today = new Date().toDateString();
  const todayTotal = knocks.filter(k => new Date(k.knocked_at).toDateString() === today).length;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
    >
      {/* ── Header ── */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>
          {isOwner ? 'Team Stats' : 'My Stats'}
        </Text>
        <View style={styles.headerRow}>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>{total}</Text>
            <Text style={styles.headerLabel}>Total Doors</Text>
          </View>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>{todayTotal}</Text>
            <Text style={styles.headerLabel}>Today</Text>
          </View>
        </View>
      </View>

      {/* ── Conversion Funnel ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONVERSION FUNNEL</Text>

        <View style={styles.funnelRow}>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{total}</Text>
            <Text style={styles.funnelLabel}>Doors</Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{opened}</Text>
            <Text style={styles.funnelLabel}>Opened</Text>
            <Text style={styles.funnelPct}>{pct(opened, total)}</Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{inspections}</Text>
            <Text style={styles.funnelLabel}>Inspections</Text>
            <Text style={styles.funnelPct}>{pct(inspections, opened)}</Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={[styles.funnelStep, styles.funnelStepSigned]}>
            <Text style={[styles.funnelValue, styles.funnelValueSigned]}>{closed}</Text>
            <Text style={[styles.funnelLabel, styles.funnelLabelSigned]}>Signed</Text>
            <Text style={[styles.funnelPct, styles.funnelPctSigned]}>{pct(closed, inspections)}</Text>
          </View>
        </View>

        <View style={styles.rateRow}>
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>{pct(opened, total)}</Text>
            <Text style={styles.rateLabel}>Open Rate</Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>{pct(inspections, opened)}</Text>
            <Text style={styles.rateLabel}>Inspection Rate</Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>{pct(closed, inspections)}</Text>
            <Text style={styles.rateLabel}>Close Rate</Text>
          </View>
        </View>
      </View>

      {/* ── Label Breakdown ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LABEL BREAKDOWN</Text>
        {ALL_LABELS.map(label => {
          const count = counts[label] || 0;
          const barWidth = total > 0 ? (count / total) * 100 : 0;
          return (
            <View key={label} style={styles.labelRow}>
              <Text style={styles.labelEmoji}>{KNOCK_OUTCOME_EMOJI[label]}</Text>
              <Text style={styles.labelName}>{KNOCK_OUTCOME_LABEL[label]}</Text>
              <View style={styles.labelBarTrack}>
                <View style={[styles.labelBarFill, { width: `${barWidth}%` }]} />
              </View>
              <Text style={styles.labelCount}>{count}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  // Header
  headerSection: { backgroundColor: '#1e40af', padding: 16, paddingBottom: 20 },
  headerTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  headerRow: { flexDirection: 'row', gap: 12 },
  headerCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: 16, alignItems: 'center' },
  headerValue: { fontSize: 36, fontWeight: '800', color: 'white' },
  headerLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  // Section
  section: { backgroundColor: 'white', marginTop: 12, paddingVertical: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.8 },

  // Funnel
  funnelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 16 },
  funnelStep: { flex: 1, alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 8, paddingVertical: 10 },
  funnelStepSigned: { backgroundColor: '#dcfce7' },
  funnelValue: { fontSize: 22, fontWeight: '800', color: '#111827' },
  funnelValueSigned: { color: '#15803d' },
  funnelLabel: { fontSize: 10, color: '#6b7280', marginTop: 2 },
  funnelLabelSigned: { color: '#15803d' },
  funnelPct: { fontSize: 11, fontWeight: '600', color: '#1e40af', marginTop: 2 },
  funnelPctSigned: { color: '#15803d' },
  funnelArrow: { fontSize: 16, color: '#d1d5db', marginHorizontal: 4 },

  rateRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12, marginHorizontal: 16 },
  rateItem: { flex: 1, alignItems: 'center' },
  rateDivider: { width: 1, backgroundColor: '#e5e7eb' },
  rateValue: { fontSize: 18, fontWeight: '700', color: '#1e40af' },
  rateLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },

  // Label breakdown
  labelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  labelEmoji: { fontSize: 16, width: 24, textAlign: 'center' },
  labelName: { fontSize: 13, color: '#374151', width: 110 },
  labelBarTrack: { flex: 1, height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden' },
  labelBarFill: { height: 6, backgroundColor: '#1e40af', borderRadius: 3 },
  labelCount: { fontSize: 13, fontWeight: '600', color: '#111827', width: 28, textAlign: 'right' },
});

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SupabaseService } from '../services/supabaseService';
import { Knock, KnockOutcome, KNOCK_OUTCOME_EMOJI, KNOCK_OUTCOME_LABEL } from '../types';
import {
  RangeKey,
  rangeWindow,
  previousWindow,
  computeRangeStats,
  trendPct,
  openRateBand,
} from '../utils/analytics';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];

// Breakdown rows: picker labels + lifecycle-written ones (flaked/retarget).
const BREAKDOWN_LABELS: KnockOutcome[] = [
  'no_home', 'not_interested', 'no_soliciting', 'renter',
  'conversation', 'inspected', 'follow_up', 'lead', 'signed', 'scout',
  'flaked', 'retarget',
];

/** Format a 0–1 rate (or null) as a percent string. */
function fmtRate(r: number | null): string {
  return r == null ? '—' : `${Math.round(r * 100)}%`;
}

export default function StatsScreen() {
  const [range, setRange] = useState<RangeKey>('today');
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [dailyGoal, setDailyGoal] = useState(75);
  const [limitHit, setLimitHit] = useState(false);

  const loadData = async (r: RangeKey) => {
    // One fetch covers BOTH windows: previous window starts before (and is
    // contiguous with) the current one, so its start bounds everything needed.
    const since = previousWindow(r)?.start ?? rangeWindow(r).start ?? undefined;
    const [knocksData, teamData, goal] = await Promise.all([
      SupabaseService.getKnocks(since),
      SupabaseService.getMyTeam(),
      SupabaseService.getTeamDailyDoorGoal(),
    ]);
    setKnocks(knocksData);
    setIsOwner(teamData?.role === 'owner');
    setDailyGoal(goal);
    setLimitHit(knocksData.length >= (since ? 5000 : 2000));
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { loadData(range); }, [range]));

  const onRefresh = () => { setRefreshing(true); loadData(range); };

  const current = useMemo(() => computeRangeStats(knocks, rangeWindow(range)), [knocks, range]);
  const previous = useMemo(() => {
    const prev = previousWindow(range);
    return prev ? computeRangeStats(knocks, prev) : null;
  }, [knocks, range]);
  const todayStats = useMemo(() => computeRangeStats(knocks, rangeWindow('today')), [knocks]);

  const rateBand = openRateBand(current.openRate);
  const trend = trendPct(current.avgDailyDoors, previous?.avgDailyDoors ?? null);
  const goalProgress = Math.min(1, todayStats.doors / Math.max(1, dailyGoal));
  const achievement = current.avgDailyDoors != null ? current.avgDailyDoors / dailyGoal : null;

  const breakdownTotal = Object.values(current.counts).reduce((s, n) => s + n, 0);
  const archHardCount = current.counts['arch_hard'] ?? 0;

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
      {/* ── Header: range selector + headline cards ── */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>
          {isOwner ? 'Team Stats' : 'My Stats'}
        </Text>

        <View style={styles.rangeRow}>
          {RANGES.map(r => (
            <TouchableOpacity
              key={r.key}
              style={[styles.rangeButton, range === r.key && styles.rangeButtonActive]}
              onPress={() => setRange(r.key)}
            >
              <Text style={[styles.rangeButtonText, range === r.key && styles.rangeButtonTextActive]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.headerRow}>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>{current.doors}</Text>
            <Text style={styles.headerLabel}>Doors</Text>
          </View>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>
              {current.opened}
              <Text style={[styles.headerRate, { color: rateBand.color === '#9ca3af' ? 'rgba(255,255,255,0.6)' : rateBand.color }]}>
                {'  '}{fmtRate(current.openRate)}
              </Text>
            </Text>
            <Text style={styles.headerLabel}>Opened</Text>
          </View>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>{current.pipeline}</Text>
            <Text style={styles.headerLabel}>Pipeline</Text>
          </View>
          <View style={styles.headerCard}>
            <Text style={styles.headerValue}>{current.signed}</Text>
            <Text style={styles.headerLabel}>Signed</Text>
          </View>
        </View>
        {rateBand.hint && current.doors > 0 && (
          <Text style={styles.bandHint}>Open rate below 20% — {rateBand.hint}</Text>
        )}
      </View>

      {/* ── Daily goal ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>DAILY DOOR GOAL</Text>
        <View style={styles.goalHeaderRow}>
          <Text style={styles.goalToday}>
            {todayStats.doors} <Text style={styles.goalOf}>/ {dailyGoal} today</Text>
          </Text>
          <Text style={styles.goalCaption}>Team goal: {dailyGoal} doors/day</Text>
        </View>
        <View style={styles.goalBarTrack}>
          <View style={[styles.goalBarFill, { width: `${goalProgress * 100}%` }]} />
        </View>

        {range !== 'today' && (
          <View style={styles.goalMetaRow}>
            <View style={styles.goalMetaItem}>
              <Text style={styles.goalMetaValue}>
                {current.avgDailyDoors != null ? Math.round(current.avgDailyDoors) : '—'}
              </Text>
              <Text style={styles.goalMetaLabel}>
                avg/day ({current.activeDays} active day{current.activeDays !== 1 ? 's' : ''})
              </Text>
            </View>
            <View style={styles.rateDivider} />
            <View style={styles.goalMetaItem}>
              <Text style={styles.goalMetaValue}>{fmtRate(achievement)}</Text>
              <Text style={styles.goalMetaLabel}>of goal</Text>
            </View>
            <View style={styles.rateDivider} />
            <View style={styles.goalMetaItem}>
              <Text style={[
                styles.goalMetaValue,
                trend != null && { color: trend >= 0 ? '#16a34a' : '#dc2626' },
              ]}>
                {trend == null ? '—' : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend * 100))}%`}
              </Text>
              <Text style={styles.goalMetaLabel}>vs previous {range}</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Conversion Funnel ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>CONVERSION FUNNEL</Text>

        <View style={styles.funnelRow}>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{current.doors}</Text>
            <Text style={styles.funnelLabel}>Doors</Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{current.opened}</Text>
            <Text style={styles.funnelLabel}>Opened</Text>
            <Text style={styles.funnelPct}>{fmtRate(current.openRate)}</Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={styles.funnelStep}>
            <Text style={styles.funnelValue}>{current.inspectedPlus}</Text>
            <Text style={styles.funnelLabel}>Inspections</Text>
            <Text style={styles.funnelPct}>
              {fmtRate(current.opened > 0 ? current.inspectedPlus / current.opened : null)}
            </Text>
          </View>
          <Text style={styles.funnelArrow}>→</Text>
          <View style={[styles.funnelStep, styles.funnelStepSigned]}>
            <Text style={[styles.funnelValue, styles.funnelValueSigned]}>{current.signed}</Text>
            <Text style={[styles.funnelLabel, styles.funnelLabelSigned]}>Signed</Text>
            <Text style={[styles.funnelPct, styles.funnelPctSigned]}>
              {fmtRate(current.inspectedPlus > 0 ? current.signed / current.inspectedPlus : null)}
            </Text>
          </View>
        </View>

        <View style={styles.rateRow}>
          <View style={styles.rateItem}>
            <Text style={[styles.rateValue, { color: rateBand.color === '#9ca3af' ? '#1e40af' : rateBand.color }]}>
              {fmtRate(current.openRate)}
            </Text>
            <Text style={styles.rateLabel}>Open Rate</Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>{fmtRate(current.pipelineRate)}</Text>
            <Text style={styles.rateLabel}>Open → Pipeline</Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>{fmtRate(current.convToInspRate)}</Text>
            <Text style={styles.rateLabel}>Conv → Inspected</Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem}>
            <Text style={styles.rateValue}>
              {fmtRate(current.doors > 0 ? current.signed / current.doors : null)}
            </Text>
            <Text style={styles.rateLabel}>Door → Sale</Text>
          </View>
        </View>

        <Text style={styles.benchmarkNote}>
          Industry: 30–40% contact rate is healthy · ~7% door→sale
        </Text>
      </View>

      {/* ── Label Breakdown ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LABEL BREAKDOWN</Text>
        {BREAKDOWN_LABELS.map(label => {
          const count = current.counts[label] || 0;
          const barWidth = breakdownTotal > 0 ? (count / breakdownTotal) * 100 : 0;
          return (
            <View key={label} style={styles.labelRow}>
              <Text style={styles.labelEmoji}>{KNOCK_OUTCOME_EMOJI[label] ?? '❔'}</Text>
              <Text style={styles.labelName}>{KNOCK_OUTCOME_LABEL[label] ?? label}</Text>
              <View style={styles.labelBarTrack}>
                <View style={[styles.labelBarFill, { width: `${barWidth}%` }]} />
              </View>
              <Text style={styles.labelCount}>{count}</Text>
            </View>
          );
        })}
        {archHardCount > 0 && (
          <View style={styles.labelRow}>
            <Text style={styles.labelEmoji}>🪦</Text>
            <Text style={styles.labelName}>Archived</Text>
            <View style={styles.labelBarTrack}>
              <View style={[styles.labelBarFill, { width: `${(archHardCount / breakdownTotal) * 100}%` }]} />
            </View>
            <Text style={styles.labelCount}>{archHardCount}</Text>
          </View>
        )}
      </View>

      {limitHit && (
        <Text style={styles.truncationNote}>
          Based on the most recent {knocks.length.toLocaleString()} knocks — older history not included.
        </Text>
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f3f4f6' },

  // Header
  headerSection: { backgroundColor: '#1e40af', padding: 16, paddingBottom: 20 },
  headerTitle: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  headerRow: { flexDirection: 'row', gap: 8 },
  headerCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center' },
  headerValue: { fontSize: 24, fontWeight: '800', color: 'white' },
  headerRate: { fontSize: 12, fontWeight: '700' },
  headerLabel: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  bandHint: { fontSize: 12, color: '#fecaca', marginTop: 10, textAlign: 'center' },

  // Range selector
  rangeRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  rangeButton: { flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center' },
  rangeButtonActive: { backgroundColor: 'white' },
  rangeButtonText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  rangeButtonTextActive: { color: '#1e40af' },

  // Section
  section: { backgroundColor: 'white', marginTop: 12, paddingVertical: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', paddingHorizontal: 16, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.8 },

  // Goal
  goalHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  goalToday: { fontSize: 26, fontWeight: '800', color: '#111827' },
  goalOf: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  goalCaption: { fontSize: 12, color: '#9ca3af' },
  goalBarTrack: { height: 10, backgroundColor: '#f3f4f6', borderRadius: 5, overflow: 'hidden', marginHorizontal: 16 },
  goalBarFill: { height: 10, backgroundColor: '#1e40af', borderRadius: 5 },
  goalMetaRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12, marginTop: 14, marginHorizontal: 16 },
  goalMetaItem: { flex: 1, alignItems: 'center' },
  goalMetaValue: { fontSize: 17, fontWeight: '700', color: '#1e40af' },
  goalMetaLabel: { fontSize: 10, color: '#6b7280', marginTop: 2, textAlign: 'center' },

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
  rateValue: { fontSize: 16, fontWeight: '700', color: '#1e40af' },
  rateLabel: { fontSize: 10, color: '#6b7280', marginTop: 2, textAlign: 'center' },
  benchmarkNote: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },

  // Label breakdown
  labelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  labelEmoji: { fontSize: 16, width: 24, textAlign: 'center' },
  labelName: { fontSize: 13, color: '#374151', width: 110 },
  labelBarTrack: { flex: 1, height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, overflow: 'hidden' },
  labelBarFill: { height: 6, backgroundColor: '#1e40af', borderRadius: 3 },
  labelCount: { fontSize: 13, fontWeight: '600', color: '#111827', width: 28, textAlign: 'right' },

  truncationNote: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },
});

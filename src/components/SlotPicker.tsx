/**
 * SlotPicker — real open windows from the owner's Google Calendar.
 *
 * Turns the doorstep line ("would Tuesday or Wednesday 4–6 work?") into
 * something read off the screen instead of guessed, so a slot is never promised
 * over an existing commitment.
 *
 * ζ — the fallback is the load-bearing part: if slots can't load (no signal,
 * calendar unconfigured, token expired) this reports `unavailable` and the
 * caller falls back to the manual time picker. Being unable to commit to a time
 * while a homeowner stands in front of you is strictly worse than an occasional
 * double-book, so the Google path is an enhancement and never a gate.
 */

import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { SupabaseService } from '../services/supabaseService';

export interface Slot { startISO: string; endISO: string }

interface Props {
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  /** Fired when the calendar can't be used, so the caller can degrade. */
  onUnavailable: () => void;
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function SlotPicker({ selected, onSelect, onUnavailable }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await SupabaseService.getCalendarSlots(7);
      if (cancelled) return;
      if (!res.configured) {
        setLoading(false);
        onUnavailable();
        return;
      }
      setSlots(res.slots);
      setLoading(false);
      if (res.slots.length === 0) onUnavailable(); // fully booked → manual entry
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#1e40af" />
        <Text style={styles.loadingText}>Checking your calendar…</Text>
      </View>
    );
  }

  if (slots.length === 0) return null; // caller has already switched to manual

  // Group by day, preserving the server's chronological order.
  const byDay: { key: string; items: Slot[] }[] = [];
  for (const s of slots) {
    const k = dayKey(s.startISO);
    const last = byDay[byDay.length - 1];
    if (last && last.key === k) last.items.push(s);
    else byDay.push({ key: k, items: [s] });
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>OPEN TIMES</Text>
      <ScrollView style={styles.scroll} nestedScrollEnabled>
        {byDay.map(day => (
          <View key={day.key} style={styles.dayBlock}>
            <Text style={styles.dayLabel}>{day.key}</Text>
            <View style={styles.chips}>
              {day.items.map(s => {
                const on = selected?.startISO === s.startISO;
                return (
                  <TouchableOpacity
                    key={s.startISO}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => onSelect(s)}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>
                      {timeLabel(s.startISO)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  heading: {
    fontSize: 10, fontWeight: '800', color: '#6b7280',
    letterSpacing: 0.6, marginBottom: 6,
  },
  scroll: { maxHeight: 180 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  loadingText: { fontSize: 13, color: '#6b7280' },
  dayBlock: { marginBottom: 10 },
  dayLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8,
    backgroundColor: '#eef2ff',
  },
  chipOn: { backgroundColor: '#1e40af' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#1e40af' },
  chipTextOn: { color: 'white' },
});

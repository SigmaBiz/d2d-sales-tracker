/**
 * SlotPicker — pick a real opening from the owner's Google Calendar.
 *
 * Shape: a compact trigger button that opens a modal with a horizontal day
 * strip and a grid of times for the chosen day. The first version stacked every
 * day's times into a 180px scroll, so you could only see about half a day at
 * once — this shows one day at a time and the whole day fits without scrolling.
 *
 * ζ — the fallback is the load-bearing part: if slots can't load (no signal,
 * calendar unconfigured, token expired) this reports `unavailable` and the
 * caller falls back to the manual time picker. Being unable to commit to a time
 * while a homeowner stands in front of you is strictly worse than an occasional
 * double-book, so the Google path is an enhancement and never a gate.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import { SupabaseService } from '../services/supabaseService';

export interface Slot { startISO: string; endISO: string }

interface Props {
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  /** Fired when the calendar can't be used, so the caller can degrade. */
  onUnavailable: () => void;
}

/** Booking window. Owner's hours — 8am to 6pm. */
const DAY_START = 8;
const DAY_END = 18;
const DAYS = 7;

const dayKeyOf = (iso: string) => new Date(iso).toDateString();
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function dayChipLabel(d: Date, todayKey: string): string {
  if (d.toDateString() === todayKey) return 'Today';
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export default function SlotPicker({ selected, onSelect, onUnavailable }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const notified = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await SupabaseService.getCalendarSlots(DAYS, DAY_START, DAY_END);
      if (cancelled) return;
      setLoading(false);
      // Guarded: onUnavailable flips parent state, and firing it twice would
      // fight the parent's render.
      if ((!res.configured || res.slots.length === 0) && !notified.current) {
        notified.current = true;
        onUnavailable();
        return;
      }
      setSlots(res.slots);
      setActiveDay(res.slots.length ? dayKeyOf(res.slots[0].startISO) : null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Days that actually have openings, in order, with their slots. */
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const k = dayKeyOf(s.startISO);
      const arr = map.get(k);
      if (arr) arr.push(s);
      else map.set(k, [s]);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key, items, date: new Date(items[0].startISO),
    }));
  }, [slots]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#1e40af" />
        <Text style={styles.loadingText}>Checking your calendar…</Text>
      </View>
    );
  }
  if (slots.length === 0) return null; // caller already switched to manual

  const todayKey = new Date().toDateString();
  const active = days.find(d => d.key === activeDay) ?? days[0];

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={[styles.triggerText, !selected && styles.triggerPlaceholder]}>
          {selected
            ? `📅  ${new Date(selected.startISO).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}`
            : '📅  Pick a time'}
        </Text>
        <Text style={styles.triggerChevron}>›</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropFill} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.title}>Pick a time</Text>
            <Text style={styles.subtitle}>Open slots on your calendar · 8am–6pm</Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayStrip}
            >
              {days.map(d => {
                const on = d.key === active?.key;
                return (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    onPress={() => setActiveDay(d.key)}
                  >
                    <Text style={[styles.dayChipTop, on && styles.dayChipTextOn]}>
                      {dayChipLabel(d.date, todayKey)}
                    </Text>
                    <Text style={[styles.dayChipNum, on && styles.dayChipTextOn]}>
                      {d.date.getDate()}
                    </Text>
                    <Text style={[styles.dayChipCount, on && styles.dayChipTextOn]}>
                      {d.items.length} open
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.timeGrid}>
              {active?.items.map(s => {
                const on = selected?.startISO === s.startISO;
                return (
                  <TouchableOpacity
                    key={s.startISO}
                    style={[styles.timeChip, on && styles.timeChipOn]}
                    onPress={() => { onSelect(s); setOpen(false); }}
                  >
                    <Text style={[styles.timeText, on && styles.timeTextOn]}>
                      {timeLabel(s.startISO)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.cancel} onPress={() => setOpen(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  loadingText: { fontSize: 13, color: '#6b7280' },

  trigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#eef2ff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  triggerText: { fontSize: 15, fontWeight: '700', color: '#1e40af' },
  triggerPlaceholder: { fontWeight: '600', color: '#4f6ae0' },
  triggerChevron: { fontSize: 20, color: '#1e40af', fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropFill: { flex: 1 },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#111827', textAlign: 'center' },
  subtitle: {
    fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 4, marginBottom: 14,
  },

  dayStrip: { gap: 8, paddingBottom: 14 },
  dayChip: {
    width: 64, paddingVertical: 9, borderRadius: 12,
    backgroundColor: '#f3f4f6', alignItems: 'center',
  },
  dayChipOn: { backgroundColor: '#1e40af' },
  dayChipTop: { fontSize: 11, fontWeight: '700', color: '#6b7280' },
  dayChipNum: { fontSize: 19, fontWeight: '800', color: '#111827', marginVertical: 1 },
  dayChipCount: { fontSize: 9, color: '#9ca3af', fontWeight: '600' },
  dayChipTextOn: { color: 'white' },

  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  timeChip: {
    minWidth: 82, paddingVertical: 11, borderRadius: 10,
    backgroundColor: '#eef2ff', alignItems: 'center', flexGrow: 1,
  },
  timeChipOn: { backgroundColor: '#1e40af' },
  timeText: { fontSize: 14, fontWeight: '700', color: '#1e40af' },
  timeTextOn: { color: 'white' },

  cancel: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
});

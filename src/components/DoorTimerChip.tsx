/**
 * DoorTimerChip — the on-screen face of the door timer.
 *
 * Only ever shown for a door that OPENED: a no-answer door has nothing holding
 * you there, so it gets no alarm (only the shift pace applies).
 *
 * Layout matters here. The first cut was absolutely positioned at the bottom
 * and covered the Save Knock button. Default is now IN FLOW (it sits at the top
 * of the knock sheet and pushes content down, so it can never cover a control);
 * `floating` is only for the map, where it's top-anchored under the stats card
 * and clear of the bottom button stacks.
 *
 * The interval here is COSMETIC. The alarm that actually pulls you out of a
 * conversation is OS-scheduled in doorTimerService and survives a locked screen.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DoorTimerService } from '../services/doorTimerService';
import {
  DoorPhase, PHASE_LABEL, CAP_SECONDS, formatElapsed,
} from '../utils/pacing';

interface Props {
  visible: boolean;
  /** Silence the alarm early — you're wrapping up. Labelling still required. */
  onStop: () => void;
  /** Map mode: absolutely positioned under the stats card. */
  floating?: boolean;
}

export default function DoorTimerChip({ visible, onStop, floating }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<DoorPhase>('conversation');

  useEffect(() => {
    if (!visible) return;
    setElapsed(DoorTimerService.elapsedSeconds());
    setPhase(DoorTimerService.currentPhase());
    const id = setInterval(() => {
      setElapsed(DoorTimerService.elapsedSeconds());
      setPhase(DoorTimerService.currentPhase());
    }, 1000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  const cap = CAP_SECONDS[phase];
  const over = cap !== null && elapsed > cap;
  const near = cap !== null && !over && elapsed > cap * 0.8;
  const color = over ? '#dc2626' : near ? '#d97706' : '#1e40af';
  const pct = cap ? Math.min(1, elapsed / cap) : 0;

  const bump = async (p: DoorPhase) => {
    await DoorTimerService.extend(p);
    setPhase(p);
  };

  return (
    <View style={[styles.chip, floating && styles.floating, { borderColor: color }]}>
      <View style={styles.row}>
        <Text style={[styles.time, { color }]}>{formatElapsed(elapsed)}</Text>
        <Text style={styles.cap}>
          {PHASE_LABEL[phase]}
          {cap !== null ? ` · ${Math.round(cap / 60)}m` : ' · no cap'}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.stopBtn} onPress={onStop}>
          <Text style={styles.stopText}>Stop</Text>
        </TouchableOpacity>
      </View>

      {cap !== null && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={() => bump('inspect')}>
          <Text style={styles.btnText}>+10 Inspect</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => bump('signing')}>
          <Text style={styles.btnText}>+30 Sign</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnExempt]}
          onPress={() => bump('exempt')}
        >
          <Text style={[styles.btnText, styles.btnExemptText]}>Exempt</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: '#f9fafb', borderRadius: 12, borderWidth: 1.5,
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10,
  },
  floating: {
    position: 'absolute', top: 124, left: 16, right: 16, zIndex: 900,
    backgroundColor: 'white',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 5, elevation: 4,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  time: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cap: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  stopBtn: {
    backgroundColor: '#e5e7eb', borderRadius: 7,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  stopText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  track: {
    height: 3, backgroundColor: '#e5e7eb', borderRadius: 2,
    overflow: 'hidden', marginTop: 7,
  },
  fill: { height: 3, borderRadius: 2 },
  actions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  btn: {
    flex: 1, backgroundColor: '#eef2ff', borderRadius: 7,
    paddingVertical: 6, alignItems: 'center',
  },
  btnText: { fontSize: 11, fontWeight: '700', color: '#1e40af' },
  btnExempt: { backgroundColor: '#fef3c7' },
  btnExemptText: { color: '#92400e' },
});

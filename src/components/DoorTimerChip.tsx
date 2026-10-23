/**
 * DoorTimerChip — the on-screen face of the door timer.
 *
 * The interval here is COSMETIC. The alarm that actually pulls you out of a
 * conversation is OS-scheduled in doorTimerService (survives a locked screen);
 * this just animates the number while you're looking at it.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DoorTimerService } from '../services/doorTimerService';
import {
  DoorPhase, PHASE_LABEL, CAP_SECONDS, formatElapsed,
} from '../utils/pacing';

interface Props {
  visible: boolean;
  /** Cut the door short — "they're not opening". Closes the session. */
  onCutShort: () => void;
}

export default function DoorTimerChip({ visible, onCutShort }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<DoorPhase>('knocking');

  useEffect(() => {
    if (!visible) return;
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

  const bump = async (p: DoorPhase) => {
    await DoorTimerService.extend(p);
    setPhase(p);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.chip, { borderColor: color }]}>
        <View style={styles.row}>
          <Text style={[styles.time, { color }]}>{formatElapsed(elapsed)}</Text>
          <Text style={styles.cap}>
            {PHASE_LABEL[phase]}
            {cap !== null ? ` · cap ${Math.round(cap / 60)}m` : ' · no cap'}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btn} onPress={onCutShort}>
            <Text style={styles.btnText}>Didn't open</Text>
          </TouchableOpacity>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', bottom: 24, left: 12, right: 12, alignItems: 'center',
  },
  chip: {
    backgroundColor: 'white', borderRadius: 14, borderWidth: 2,
    paddingHorizontal: 14, paddingVertical: 10, width: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 5,
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  time: { fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cap: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 6, marginTop: 8 },
  btn: {
    flex: 1, backgroundColor: '#f3f4f6', borderRadius: 8,
    paddingVertical: 7, alignItems: 'center',
  },
  btnText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  btnExempt: { backgroundColor: '#fef3c7' },
  btnExemptText: { color: '#92400e' },
});

/**
 * StarRating — 0–5 in half steps.
 *
 * Input works by tapping the LEFT or RIGHT half of a star (left = x.5, right =
 * x.0). A slider was rejected: this gets used one-handed, outdoors, often with
 * gloves — discrete tap targets survive that, a drag gesture does not.
 *
 * Tapping the exact value already set clears it back to null, so a mis-tap is
 * recoverable without a separate clear button.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  value?: number | null;
  /** Omit for read-only (list rows). */
  onChange?: (value: number | null) => void;
  size?: number;
  /** Show the numeric value beside the stars. */
  showValue?: boolean;
}

export default function StarRating({ value, onChange, size = 24, showValue }: Props) {
  const v = value ?? 0;
  const readOnly = !onChange;

  const iconFor = (position: number) => {
    // position is 1..5; each star covers (position-1, position]
    if (v >= position) return 'star';
    if (v >= position - 0.5) return 'star-half';
    return 'star-outline';
  };

  const tap = (position: number, half: boolean) => {
    if (!onChange) return;
    const next = half ? position - 0.5 : position;
    onChange(next === value ? null : next); // re-tap same value clears
  };

  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map(position => {
        const icon = (
          <Ionicons
            name={iconFor(position) as any}
            size={size}
            color={v >= position - 0.5 ? '#f59e0b' : '#d1d5db'}
          />
        );
        if (readOnly) return <View key={position}>{icon}</View>;
        return (
          <View key={position} style={styles.starWrap}>
            {icon}
            {/* Two invisible halves layered over the glyph — the actual hit targets. */}
            <TouchableOpacity
              style={[styles.half, { left: 0, width: size / 2, height: size }]}
              onPress={() => tap(position, true)}
            />
            <TouchableOpacity
              style={[styles.half, { right: 0, width: size / 2, height: size }]}
              onPress={() => tap(position, false)}
            />
          </View>
        );
      })}
      {showValue && (
        <Text style={[styles.value, { fontSize: Math.max(12, size * 0.5) }]}>
          {value ? value.toFixed(1) : '—'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  starWrap: { position: 'relative' },
  half: { position: 'absolute', top: 0 },
  value: { marginLeft: 6, fontWeight: '700', color: '#92400e' },
});

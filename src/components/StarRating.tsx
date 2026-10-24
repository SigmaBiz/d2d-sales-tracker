/**
 * StarRating — 0–5 in half steps, set by dragging/scrubbing across the stars.
 *
 * Owner asked for a scrub gesture (an earlier tap-the-half-of-a-star version was
 * replaced). A single tap still works — PanResponder's grant fires on touch-down
 * and sets the value immediately, so a tap is just a zero-length drag.
 *
 * Dragging off the LEFT edge clears the rating (value < quarter of a star → null).
 * That's the only clear affordance, which is why the gesture is allowed to track
 * negative x rather than being clamped at zero.
 */

import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  value?: number | null;
  /** Omit for read-only (list rows get no responder at all). */
  onChange?: (value: number | null) => void;
  size?: number;
  showValue?: boolean;
}

export default function StarRating({ value, onChange, size = 24, showValue }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startXRef = useRef(0);
  // Live value during a drag, so the stars track the finger even though the
  // parent only commits on release for remote writes.
  const [dragValue, setDragValue] = useState<number | null | undefined>(undefined);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  /** x (px, may be negative) → nearest half-star, or null to clear. */
  const valueFor = (x: number): number | null => {
    const w = widthRef.current;
    if (w <= 0) return null;
    const raw = (x / w) * 5;
    if (raw < 0.25) return null;            // dragged off the left edge → clear
    const half = Math.ceil(raw * 2) / 2;
    return Math.max(0.5, Math.min(5, half));
  };

  // Declared before the responder: its callbacks close over this binding, and
  // reassigning it each render keeps them fresh without rebuilding the responder
  // (a rebuilt responder mid-gesture drops the drag).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Claim the gesture so a parent ScrollView doesn't steal the horizontal drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startXRef.current = e.nativeEvent.locationX;
        setDragValue(valueFor(startXRef.current));
      },
      onPanResponderMove: (_e, g) => {
        setDragValue(valueFor(startXRef.current + g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        const final = valueFor(startXRef.current + g.dx);
        setDragValue(undefined);          // hand control back to the prop
        onChangeRef.current?.(final);
      },
      onPanResponderTerminate: () => setDragValue(undefined),
    })
  ).current;

  const shown = dragValue !== undefined ? dragValue : value;
  const v = shown ?? 0;
  const readOnly = !onChange;

  const iconFor = (position: number) => {
    if (v >= position) return 'star';
    if (v >= position - 0.5) return 'star-half';
    return 'star-outline';
  };

  const stars = (
    <View style={styles.stars} onLayout={onLayout}>
      {[1, 2, 3, 4, 5].map(position => (
        <Ionicons
          key={position}
          name={iconFor(position) as any}
          size={size}
          color={v >= position - 0.5 ? '#f59e0b' : '#d1d5db'}
        />
      ))}
    </View>
  );

  return (
    <View style={styles.row}>
      {readOnly ? stars : <View {...responder.panHandlers}>{stars}</View>}
      {showValue && (
        <Text style={[styles.value, { fontSize: Math.max(12, size * 0.5) }]}>
          {shown ? shown.toFixed(1) : '—'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  stars: { flexDirection: 'row', alignItems: 'center' },
  value: { marginLeft: 8, fontWeight: '700', color: '#92400e', minWidth: 30 },
});

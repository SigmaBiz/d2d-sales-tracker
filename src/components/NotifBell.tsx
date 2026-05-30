/**
 * NotifBell (F2e) — the "looming" notification bell.
 *
 * Presentational + props-driven so it works anywhere (the map). Escalating attention:
 *   - unread > 0, not urgent → gentle balloon PULSE (scale loop)
 *   - urgent                 → cartoon-alarm SHAKE (rotate loop) + one buzz on becoming urgent
 *   - nothing unread         → static
 * Core RN Animated + Vibration only (no extra deps).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, TouchableOpacity, Text, View, StyleSheet, Vibration, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  unreadCount: number;
  urgent: boolean;
  onPress: () => void;
  style?: any; // container style (matches the other map action buttons)
}

export default function NotifBell({ unreadCount, urgent, onPress, style }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const wasUrgent = useRef(false);

  useEffect(() => {
    // Stop any running loop before starting a new mode.
    loopRef.current?.stop();
    scale.setValue(1);
    rotate.setValue(0);

    if (urgent) {
      // Buzz once when it BECOMES urgent (not on every re-render).
      if (!wasUrgent.current) {
        Vibration.vibrate(Platform.OS === 'ios' ? [0, 200, 120, 200] : [0, 200, 120, 200]);
      }
      // Snappy shake — rotate left/right repeatedly with brief rests.
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(rotate, { toValue: 1, duration: 60, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: -1, duration: 120, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 0, duration: 60, useNativeDriver: true }),
          Animated.delay(900),
        ])
      );
      loopRef.current.start();
    } else if (unreadCount > 0) {
      // Gentle balloon pulse.
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loopRef.current.start();
    }

    wasUrgent.current = urgent;
    return () => loopRef.current?.stop();
  }, [urgent, unreadCount, scale, rotate]);

  const rotateDeg = rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });

  return (
    <TouchableOpacity style={style} onPress={onPress} activeOpacity={0.7}>
      <Animated.View style={{ transform: [{ scale }, { rotate: rotateDeg }] }}>
        <Ionicons name="notifications" size={24} color={urgent ? '#dc2626' : '#FF6B6B'} />
      </Animated.View>
      {unreadCount > 0 && (
        <View style={[styles.badge, urgent && styles.badgeUrgent]}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute', top: -5, right: -5,
    backgroundColor: '#ef4444', borderRadius: 10,
    minWidth: 20, height: 20, paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'white',
  },
  badgeUrgent: { backgroundColor: '#b91c1c' },
  badgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
});

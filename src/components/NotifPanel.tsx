/**
 * NotifPanel (F2e) — unified in-app notification feed, backed by Supabase.
 *
 * Shows lead updates, scheduled reminders, nudges, and hail alerts (newest first).
 * Tapping a row with a knock_id "teleports" the map to that door. Opening the panel
 * marks everything read (handled by the caller via openNotifications).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Modal, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SupabaseService } from '../services/supabaseService';
import { AppNotification } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onTeleport: (lat: number, lng: number, knockId: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

const TYPE_ICON: Record<string, string> = {
  lead_update: '📍', lead_reminder: '📅', nudge: '👈', hail: '🌩️',
};

export default function NotifPanel({ visible, onClose, onTeleport }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await SupabaseService.getNotifications(50);
    setItems(data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { if (visible) { setLoading(true); load(); } }, [visible, load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const handleTap = (n: AppNotification) => {
    if (n.knock_id && n.lat != null && n.lng != null) {
      onClose();
      onTeleport(n.lat, n.lng, n.knock_id);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Notifications</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.center}><ActivityIndicator size="large" color="#1e40af" /></View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="notifications-off-outline" size={56} color="#ccc" />
              <Text style={styles.emptyText}>No notifications yet</Text>
              <Text style={styles.emptySub}>Lead updates, reminders, and storm alerts appear here.</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={i => i.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1e40af" />}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => {
                const tappable = !!item.knock_id && item.lat != null && item.lng != null;
                return (
                  <TouchableOpacity
                    style={[styles.row, !item.read_at && styles.rowUnread]}
                    onPress={() => handleTap(item)}
                    disabled={!tappable}
                    activeOpacity={tappable ? 0.6 : 1}
                  >
                    <Text style={styles.rowIcon}>{item.urgent ? '❗' : (TYPE_ICON[item.type] ?? '🔔')}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{item.title ?? 'Notification'}</Text>
                      {item.body ? <Text style={styles.rowBody} numberOfLines={1}>{item.body}</Text> : null}
                      <Text style={styles.rowTime}>{timeAgo(item.created_at)}{tappable ? ' · tap to view on map' : ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  panel: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', minHeight: '45%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  closeBtn: { padding: 5 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, minHeight: 240 },
  emptyText: { fontSize: 17, fontWeight: '600', color: '#666', marginTop: 16 },
  emptySub: { fontSize: 13, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: 'white' },
  rowUnread: { backgroundColor: '#eff6ff' },
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  rowBody: { fontSize: 13, color: '#6b7280', marginTop: 1 },
  rowTime: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  sep: { height: 1, backgroundColor: '#f3f4f6' },
});

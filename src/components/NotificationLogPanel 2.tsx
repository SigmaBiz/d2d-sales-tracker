import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { StorageService } from '../services/storageService';
import { MRMSService } from '../services/mrmsService';
import { NotificationLogEntry } from '../types';
import SwipeableNotificationItem from './SwipeableNotificationItem';

interface NotificationLogPanelProps {
  visible: boolean;
  onClose: () => void;
  onCreateOverlay: (notification: NotificationLogEntry) => void;
}

export default function NotificationLogPanel({ visible, onClose, onCreateOverlay }: NotificationLogPanelProps) {
  const [notifications, setNotifications] = useState<NotificationLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (visible) {
      loadNotifications();
    }
  }, [visible]);

  const loadNotifications = async () => {
    try {
      const log = await StorageService.getNotificationLog();
      setNotifications(log);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  };

  const handleCreateOverlay = async (notification: NotificationLogEntry) => {
    try {
      // Create storm overlay from notification data
      const storm = {
        id: notification.stormId || `storm_${Date.now()}`,
        name: `Storm ${format(new Date(notification.timestamp), 'MMM d')}`,
        startTime: notification.timestamp,
        center: {
          lat: notification.location.latitude,
          lng: notification.location.longitude
        },
        reports: [{
          id: `report_${Date.now()}`,
          latitude: notification.location.latitude,
          longitude: notification.location.longitude,
          size: notification.hailSize,
          timestamp: notification.timestamp,
          confidence: notification.confidence,
          city: notification.location.city,
          confidenceFactors: {}
        }],
        maxSize: notification.hailSize,
        active: false,
        enabled: true,
        isActive: false,
        source: 'notification' as const,
        confidence: notification.confidence
      };

      await MRMSService.saveStormEvent(storm);
      
      // Mark notification as actioned
      await StorageService.markNotificationActioned(notification.id);
      await loadNotifications();

      // Notify parent to refresh overlays
      onCreateOverlay(notification);
      
      Alert.alert(
        'Success',
        'Storm overlay created successfully',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error creating overlay:', error);
      Alert.alert('Error', 'Failed to create storm overlay');
    }
  };

  const getTypeColor = (type: NotificationLogEntry['type']) => {
    switch (type) {
      case 'initial':
        return '#FF6B6B';
      case 'escalation':
        return '#FFA500';
      case 'expansion':
        return '#FFD700';
      default:
        return '#808080';
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    await StorageService.deleteNotificationLogEntry(notificationId);
    await loadNotifications();
  };

  const renderNotification = ({ item }: { item: NotificationLogEntry }) => (
    <SwipeableNotificationItem
      item={item}
      onDelete={handleDeleteNotification}
      onCreateOverlay={handleCreateOverlay}
      getTypeColor={getTypeColor}
    />
  );

  const clearLog = () => {
    Alert.alert(
      'Clear Notification Log',
      'Are you sure you want to clear all notifications?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await StorageService.clearNotificationLog();
            setNotifications([]);
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title}>Notification Log</Text>
            <View style={styles.headerButtons}>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={clearLog} style={styles.clearButton}>
                  <Ionicons name="trash-outline" size={24} color="#FF6B6B" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
          </View>

          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="notifications-off-outline" size={64} color="#CCC" />
              <Text style={styles.emptyText}>No notifications yet</Text>
              <Text style={styles.emptySubtext}>
                Storm alerts will appear here when detected
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.swipeHint}>
                <Text style={styles.swipeHintText}>Long press any notification to delete</Text>
              </View>
              <FlatList
                data={notifications}
                keyExtractor={(item) => item.id}
                renderItem={renderNotification}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
                contentContainerStyle={styles.listContent}
                scrollEnabled={true}
                showsVerticalScrollIndicator={true}
              />
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clearButton: {
    padding: 5,
    marginRight: 10,
  },
  closeButton: {
    padding: 5,
  },
  listContent: {
    paddingVertical: 10,
  },
  swipeHint: {
    backgroundColor: '#F0F0F0',
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  swipeHintText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 20,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
});
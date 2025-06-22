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
        startTime: notification.timestamp,
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
        enabled: true
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

  const renderNotification = ({ item }: { item: NotificationLogEntry }) => (
    <View style={[styles.notificationItem, item.actioned && styles.actionedItem]}>
      <View style={styles.notificationHeader}>
        <View style={[styles.typeBadge, { backgroundColor: getTypeColor(item.type) }]}>
          <Text style={styles.typeText}>{item.type.toUpperCase()}</Text>
        </View>
        <Text style={styles.timestamp}>
          {format(new Date(item.timestamp), 'MMM d, h:mm a')}
        </Text>
      </View>
      
      <Text style={styles.message}>{item.message}</Text>
      
      <View style={styles.detailsRow}>
        <View style={styles.detail}>
          <Ionicons name="resize" size={16} color="#666" />
          <Text style={styles.detailText}>{item.hailSize.toFixed(1)}"</Text>
        </View>
        <View style={styles.detail}>
          <Ionicons name="analytics" size={16} color="#666" />
          <Text style={styles.detailText}>{item.confidence}%</Text>
        </View>
        {item.location.city && (
          <View style={styles.detail}>
            <Ionicons name="location" size={16} color="#666" />
            <Text style={styles.detailText}>{item.location.city}</Text>
          </View>
        )}
      </View>

      {!item.actioned && (
        <TouchableOpacity
          style={styles.createOverlayButton}
          onPress={() => handleCreateOverlay(item)}
        >
          <Ionicons name="map" size={20} color="#FFF" />
          <Text style={styles.buttonText}>Create Overlay</Text>
        </TouchableOpacity>
      )}
      
      {item.actioned && (
        <View style={styles.actionedBadge}>
          <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
          <Text style={styles.actionedText}>Overlay Created</Text>
        </View>
      )}
    </View>
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
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderNotification}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              contentContainerStyle={styles.listContent}
            />
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
  notificationItem: {
    backgroundColor: '#F9F9F9',
    marginHorizontal: 15,
    marginVertical: 5,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  actionedItem: {
    opacity: 0.6,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFF',
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
  },
  message: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
    marginBottom: 10,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
    marginBottom: 5,
  },
  detailText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  createOverlayButton: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  actionedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  actionedText: {
    color: '#4CAF50',
    fontSize: 14,
    marginLeft: 4,
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
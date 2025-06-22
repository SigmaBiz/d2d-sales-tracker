import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { NotificationLogEntry } from '../types';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SwipeableNotificationItemProps {
  item: NotificationLogEntry;
  onDelete: (id: string) => void;
  onCreateOverlay: (notification: NotificationLogEntry) => void;
  getTypeColor: (type: NotificationLogEntry['type']) => string;
}

export default function SwipeableNotificationItem({
  item,
  onDelete,
  onCreateOverlay,
  getTypeColor,
}: SwipeableNotificationItemProps) {
  const [showDelete, setShowDelete] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleDelete = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      onDelete(item.id);
    });
  };

  const toggleDelete = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowDelete(!showDelete);
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <TouchableOpacity
        activeOpacity={0.95}
        onLongPress={toggleDelete}
        delayLongPress={300}
      >
        <View style={styles.notificationWrapper}>
          {showDelete && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={handleDelete}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={20} color="#FFF" />
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          )}
          
          <View style={[
            styles.notificationItem,
            item.actioned && styles.actionedItem,
            showDelete && styles.notificationItemShifted
          ]}>
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
                onPress={() => onCreateOverlay(item)}
                activeOpacity={0.8}
              >
                <Ionicons name="map" size={20} color="#FFF" />
                <Text style={styles.buttonText}>Create Overlay</Text>
              </TouchableOpacity>
            )}
            
            {item.actioned && (
              <View style={styles.actionedBadge}>
                <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                <Text style={styles.actionedText}>
                  {item.hailSize >= 2.0 ? 'Auto-Created' : 'Overlay Created'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 15,
    marginVertical: 5,
  },
  notificationWrapper: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  deleteButton: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 15,
    borderRadius: 10,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  deleteButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  notificationItem: {
    backgroundColor: '#F9F9F9',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flex: 1,
  },
  notificationItemShifted: {
    marginLeft: 0,
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
});
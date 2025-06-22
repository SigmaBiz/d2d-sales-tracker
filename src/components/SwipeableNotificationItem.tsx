import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { NotificationLogEntry } from '../types';

const { width: screenWidth } = Dimensions.get('window');
const SWIPE_THRESHOLD = screenWidth * 0.25; // Reduced threshold for easier swiping

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
  const translateX = useRef(new Animated.Value(0)).current;
  const itemOpacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Activate pan responder on horizontal swipe
        const shouldSet = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 5;
        if (shouldSet) {
          console.log('Pan responder activated', gestureState.dx);
        }
        return shouldSet;
      },
      onPanResponderGrant: () => {
        // Start of gesture
        console.log('Swipe gesture started');
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow left swipe
        console.log('Moving:', gestureState.dx);
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          // Animate delete
          Animated.parallel([
            Animated.timing(translateX, {
              toValue: -screenWidth,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(itemOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => {
            onDelete(item.id);
          });
        } else {
          // Snap back
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 5,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        // Another component has become the responder, snap back
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 5,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      {/* Delete background */}
      <View style={styles.deleteBackground}>
        <Ionicons name="trash-outline" size={24} color="#FFF" />
        <Text style={styles.deleteText}>Delete</Text>
      </View>

      {/* Swipeable content */}
      <Animated.View
        style={[
          styles.notificationItem,
          item.actioned && styles.actionedItem,
          {
            transform: [{ translateX }],
            opacity: itemOpacity,
          },
        ]}
      >
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
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
            <Text style={styles.actionedText}>Overlay Created</Text>
          </View>
        )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 15,
    marginVertical: 5,
  },
  deleteBackground: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: '#FF4444',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 20,
  },
  deleteText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  notificationItem: {
    backgroundColor: '#F9F9F9',
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
});
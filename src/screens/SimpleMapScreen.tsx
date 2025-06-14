import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { Knock } from '../types';

const OUTCOME_COLORS = {
  // Primary outcomes
  not_home: '#6b7280',      // 👻 Gray
  revisit: '#3b82f6',       // 👀 Blue
  no_soliciting: '#ef4444', // 🚫 Red
  lead: '#10b981',          // ✅ Green
  sale: '#22c55e',          // 📝 Bright green
  callback: '#f59e0b',      // 🔄 Orange
  // Property status
  new_roof: '#8b5cf6',      // 🏠 Purple
  competitor: '#dc2626',    // 🚧 Dark red
  renter: '#6366f1',        // 🔑 Indigo
  poor_condition: '#78716c', // 🏚️ Brown
  // Action taken
  proposal_left: '#0891b2', // 📋 Cyan
  stay_away: '#991b1b',     // ⚠️ Dark red
  // Legacy
  not_interested: '#991b1b',
};

export default function SimpleMapScreen() {
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    initializeLocation();
    loadKnocks();
  }, []);

  const initializeLocation = async () => {
    const hasPermission = await LocationService.requestPermissions();
    if (hasPermission) {
      const location = await LocationService.getCurrentLocation();
      if (location) {
        setCurrentLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        });
      }
    }
  };

  const loadKnocks = async () => {
    const storedKnocks = await StorageService.getKnocks();
    // Sort by most recent first
    const sortedKnocks = storedKnocks.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    setKnocks(sortedKnocks);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadKnocks();
    await initializeLocation();
    setRefreshing(false);
  };

  const toggleTracking = async () => {
    if (isTracking) {
      await LocationService.stopBackgroundLocationTracking();
      setIsTracking(false);
    } else {
      await LocationService.startBackgroundLocationTracking();
      setIsTracking(true);
    }
  };

  const getTimeAgo = (timestamp: Date) => {
    const now = new Date();
    const knockTime = new Date(timestamp);
    const diffMs = now.getTime() - knockTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    // Simple distance calculation in meters
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    const d = R * c;
    
    if (d < 1000) return `${Math.round(d)}m away`;
    return `${(d/1000).toFixed(1)}km away`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Territory Activity</Text>
        <Text style={styles.subtitle}>
          {knocks.length} total knock{knocks.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <ScrollView 
        style={styles.knocksList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {knocks.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="map-outline" size={64} color="#9ca3af" />
            <Text style={styles.emptyText}>No knocks recorded yet</Text>
            <Text style={styles.emptySubtext}>
              Start knocking to see your territory activity
            </Text>
          </View>
        ) : (
          knocks.map((knock) => (
            <View key={knock.id} style={styles.knockCard}>
              <View style={styles.knockHeader}>
                <View style={styles.knockOutcomeContainer}>
                  <View 
                    style={[
                      styles.knockDot, 
                      { backgroundColor: OUTCOME_COLORS[knock.outcome] }
                    ]} 
                  />
                  <Text style={styles.knockOutcome}>
                    {knock.outcome.replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.knockTime}>{getTimeAgo(knock.timestamp)}</Text>
              </View>
              
              <Text style={styles.knockAddress}>
                {knock.address || `${knock.latitude.toFixed(6)}, ${knock.longitude.toFixed(6)}`}
              </Text>
              
              {currentLocation && (
                <Text style={styles.knockDistance}>
                  {getDistance(currentLocation.lat, currentLocation.lng, knock.latitude, knock.longitude)}
                </Text>
              )}
              
              {knock.notes && (
                <Text style={styles.knockNotes}>{knock.notes}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity 
        style={[styles.trackingButton, isTracking && styles.trackingActive]} 
        onPress={toggleTracking}
      >
        <Ionicons 
          name={isTracking ? "pause-circle" : "play-circle"} 
          size={24} 
          color="white" 
        />
        <Text style={styles.trackingText}>
          {isTracking ? 'Stop Tracking' : 'Start Tracking'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    backgroundColor: 'white',
    padding: 20,
    paddingTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 4,
  },
  knocksList: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#4b5563',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },
  knockCard: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  knockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  knockOutcomeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  knockDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  knockOutcome: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  knockTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  knockAddress: {
    fontSize: 14,
    color: '#4b5563',
    marginBottom: 4,
  },
  knockDistance: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  knockNotes: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
    fontStyle: 'italic',
  },
  trackingButton: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: '#1e40af',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  trackingActive: {
    backgroundColor: '#dc2626',
  },
  trackingText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '600',
  },
});
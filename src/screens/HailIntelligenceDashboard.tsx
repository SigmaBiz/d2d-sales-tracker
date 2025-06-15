import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IntegratedHailIntelligence } from '../services/integratedHailIntelligence';
import { useNavigation } from '@react-navigation/native';

export default function HailIntelligenceDashboard() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [stormTracker, setStormTracker] = useState<any>(null);
  const [accuracy, setAccuracy] = useState<any>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [status, tracker, accuracyData] = await Promise.all([
        IntegratedHailIntelligence.getSystemStatus(),
        IntegratedHailIntelligence.getStormTracker(),
        IntegratedHailIntelligence.getAccuracyDashboard()
      ]);

      setSystemStatus(status);
      setStormTracker(tracker);
      setAccuracy(accuracyData);
    } catch (error) {
      console.error('Error loading dashboard:', error);
      Alert.alert('Error', 'Failed to load hail intelligence data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const navigateToStormSearch = () => {
    navigation.navigate('StormSearch' as never);
  };

  const navigateToDataFlow = () => {
    navigation.navigate('DataFlowDashboard' as never);
  };

  const showCustomerPresentation = async () => {
    // Example address - in production, get from current location
    const presentation = await IntegratedHailIntelligence.getCustomerPresentation({
      latitude: 35.4676,
      longitude: -97.5164
    });

    Alert.alert(
      'Customer Hail History',
      presentation.recommendation,
      [
        { text: 'OK' }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>3-Tier Hail Intelligence</Text>
        <Text style={styles.subtitle}>NOAA MRMS • IEM Archives • Storm Events</Text>
      </View>

      {/* System Status Cards */}
      <View style={styles.tierContainer}>
        {/* TIER 1: Real-Time */}
        <TouchableOpacity style={styles.tierCard} onPress={navigateToDataFlow}>
          <View style={styles.tierHeader}>
            <View style={[styles.tierIcon, { backgroundColor: '#3b82f6' }]}>
              <Ionicons name="flash" size={24} color="#fff" />
            </View>
            <View style={styles.tierInfo}>
              <Text style={styles.tierName}>TIER 1: Real-Time</Text>
              <Text style={styles.tierSource}>NCEP MRMS Feed</Text>
            </View>
            <View style={[
              styles.statusDot,
              { backgroundColor: systemStatus?.tiers.realTime.status === 'complete' ? '#10b981' : '#f59e0b' }
            ]} />
          </View>
          <Text style={styles.tierDescription}>
            2-minute updates • Push alerts • {stormTracker?.activeStorms.length || 0} active storms
          </Text>
        </TouchableOpacity>

        {/* TIER 2: Historical */}
        <TouchableOpacity style={styles.tierCard} onPress={navigateToStormSearch}>
          <View style={styles.tierHeader}>
            <View style={[styles.tierIcon, { backgroundColor: '#f59e0b' }]}>
              <Ionicons name="time" size={24} color="#fff" />
            </View>
            <View style={styles.tierInfo}>
              <Text style={styles.tierName}>TIER 2: Historical</Text>
              <Text style={styles.tierSource}>IEM Archives</Text>
            </View>
            <View style={[
              styles.statusDot,
              { backgroundColor: systemStatus?.tiers.historical.status === 'complete' ? '#10b981' : '#f59e0b' }
            ]} />
          </View>
          <Text style={styles.tierDescription}>
            Oct 2019-Present • Validated data • Territory planning
          </Text>
        </TouchableOpacity>

        {/* TIER 3: Validation */}
        <View style={styles.tierCard}>
          <View style={styles.tierHeader}>
            <View style={[styles.tierIcon, { backgroundColor: '#10b981' }]}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </View>
            <View style={styles.tierInfo}>
              <Text style={styles.tierName}>TIER 3: Validation</Text>
              <Text style={styles.tierSource}>Storm Events DB</Text>
            </View>
            <View style={[
              styles.statusDot,
              { backgroundColor: systemStatus?.tiers.validation.status === 'complete' ? '#10b981' : '#f59e0b' }
            ]} />
          </View>
          <Text style={styles.tierDescription}>
            Weekly sync • {accuracy?.message || 'Calculating accuracy...'}
          </Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsContainer}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        
        <TouchableOpacity style={styles.actionButton} onPress={navigateToStormSearch}>
          <Ionicons name="search" size={20} color="#fff" />
          <Text style={styles.actionText}>Search Historical Storms</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={showCustomerPresentation}>
          <Ionicons name="person" size={20} color="#fff" />
          <Text style={styles.actionText}>Customer Presentation Mode</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={navigateToDataFlow}>
          <Ionicons name="analytics" size={20} color="#fff" />
          <Text style={styles.actionText}>View Data Flow Monitor</Text>
        </TouchableOpacity>
      </View>

      {/* Performance Metrics */}
      {accuracy && (
        <View style={styles.metricsContainer}>
          <Text style={styles.sectionTitle}>System Performance</Text>
          
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Precision:</Text>
            <Text style={styles.metricValue}>
              {((accuracy.currentMetrics?.precision || 0) * 100).toFixed(1)}%
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Recall:</Text>
            <Text style={styles.metricValue}>
              {((accuracy.currentMetrics?.recall || 0) * 100).toFixed(1)}%
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>F1 Score:</Text>
            <Text style={styles.metricValue}>
              {((accuracy.currentMetrics?.f1Score || 0) * 100).toFixed(1)}%
            </Text>
          </View>

          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Trend:</Text>
            <Text style={[
              styles.metricValue,
              { color: accuracy.trend === 'improving' ? '#10b981' : 
                       accuracy.trend === 'declining' ? '#ef4444' : '#6b7280' }
            ]}>
              {accuracy.trend || 'stable'} ({accuracy.percentChange || 0}%)
            </Text>
          </View>
        </View>
      )}

      {/* Feature Highlights */}
      <View style={styles.featuresContainer}>
        <Text style={styles.sectionTitle}>Intelligence Features</Text>
        
        <View style={styles.featureItem}>
          <Ionicons name="notifications" size={20} color="#3b82f6" />
          <Text style={styles.featureText}>Auto-alerts when MESH >25mm detected</Text>
        </View>

        <View style={styles.featureItem}>
          <Ionicons name="map" size={20} color="#3b82f6" />
          <Text style={styles.featureText}>Live storm timeline & progression tracking</Text>
        </View>

        <View style={styles.featureItem}>
          <Ionicons name="calendar" size={20} color="#3b82f6" />
          <Text style={styles.featureText}>Search storms back to October 2019</Text>
        </View>

        <View style={styles.featureItem}>
          <Ionicons name="pin" size={20} color="#3b82f6" />
          <Text style={styles.featureText}>Territory heat maps & reliability scoring</Text>
        </View>

        <View style={styles.featureItem}>
          <Ionicons name="trending-up" size={20} color="#3b82f6" />
          <Text style={styles.featureText}>ML-powered accuracy improvements</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#1e40af',
    padding: 20,
    paddingTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#93bbfc',
    marginTop: 4,
  },
  tierContainer: {
    padding: 16,
  },
  tierCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tierIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tierInfo: {
    flex: 1,
  },
  tierName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  tierSource: {
    fontSize: 12,
    color: '#6b7280',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  tierDescription: {
    fontSize: 13,
    color: '#6b7280',
  },
  actionsContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#1e40af',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
  },
  actionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
  },
  metricsContainer: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  metricLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  featuresContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 12,
    flex: 1,
  },
});
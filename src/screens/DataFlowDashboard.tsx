import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HailDataFlowService, DataFlowStage } from '../services/hailDataFlowService';

export default function DataFlowDashboard({ navigation }: any) {
  const [flowState, setFlowState] = useState<Record<string, DataFlowStage>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadFlowState();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadFlowState, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadFlowState = async () => {
    try {
      const state = await HailDataFlowService.getFlowState();
      setFlowState(state);
    } catch (error) {
      console.error('Error loading flow state:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadFlowState();
  };

  const triggerStage = async (stage: 'realtime' | 'historical' | 'validation') => {
    setLoading(true);
    try {
      switch (stage) {
        case 'realtime':
          await HailDataFlowService.processRealtimeStage();
          break;
        case 'historical':
          await HailDataFlowService.processHistoricalStage();
          break;
        case 'validation':
          await HailDataFlowService.processValidationStage();
          break;
      }
      await loadFlowState();
    } catch (error) {
      console.error(`Error triggering ${stage}:`, error);
    }
  };

  const getStageIcon = (stage: string) => {
    switch (stage) {
      case 'realtime':
        return 'flash';
      case 'historical':
        return 'time';
      case 'validation':
        return 'checkmark-circle';
      default:
        return 'help-circle';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return '#10b981';
      case 'processing':
        return '#3b82f6';
      case 'error':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  const formatTimestamp = (timestamp: Date | string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours < 1) {
      const mins = Math.floor(diff / (1000 * 60));
      return `${mins}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  if (loading && Object.keys(flowState).length === 0) {
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
        <Text style={styles.title}>Hail Intelligence Data Flow</Text>
        <Text style={styles.subtitle}>Real-time monitoring of all data stages</Text>
      </View>

      {/* Stage 1: Real-Time */}
      <View style={styles.stageCard}>
        <View style={styles.stageHeader}>
          <View style={styles.stageIconContainer}>
            <Ionicons 
              name={getStageIcon('realtime')} 
              size={24} 
              color="#fff" 
            />
          </View>
          <View style={styles.stageInfo}>
            <Text style={styles.stageName}>Stage 1: Real-Time Detection</Text>
            <Text style={styles.stageDescription}>
              Immediate storm detection & canvassing alerts
            </Text>
          </View>
          <View style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(flowState.realtime?.status || 'pending') }
          ]}>
            <Text style={styles.statusText}>
              {flowState.realtime?.status || 'pending'}
            </Text>
          </View>
        </View>

        {flowState.realtime?.data && (
          <View style={styles.stageData}>
            <Text style={styles.dataLabel}>
              Reports: {flowState.realtime.data.reportCount || 0}
            </Text>
            <Text style={styles.dataLabel}>
              Last Check: {formatTimestamp(flowState.realtime.data.lastCheck || new Date())}
            </Text>
          </View>
        )}

        <TouchableOpacity 
          style={styles.triggerButton}
          onPress={() => triggerStage('realtime')}
        >
          <Text style={styles.triggerButtonText}>Run Now</Text>
        </TouchableOpacity>
      </View>

      {/* Stage 2: Historical */}
      <View style={styles.stageCard}>
        <View style={styles.stageHeader}>
          <View style={[styles.stageIconContainer, { backgroundColor: '#f59e0b' }]}>
            <Ionicons 
              name={getStageIcon('historical')} 
              size={24} 
              color="#fff" 
            />
          </View>
          <View style={styles.stageInfo}>
            <Text style={styles.stageName}>Stage 2: Historical Archive</Text>
            <Text style={styles.stageDescription}>
              24-48hr processing for territory planning
            </Text>
          </View>
          <View style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(flowState.historical?.status || 'pending') }
          ]}>
            <Text style={styles.statusText}>
              {flowState.historical?.status || 'pending'}
            </Text>
          </View>
        </View>

        {flowState.historical?.data && (
          <View style={styles.stageData}>
            <Text style={styles.dataLabel}>
              Processed: {flowState.historical.data.reportsProcessed || 0} reports
            </Text>
            {flowState.historical.data.insights?.hotspots && (
              <Text style={styles.dataLabel}>
                Hotspots: {flowState.historical.data.insights.hotspots.length}
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity 
          style={styles.triggerButton}
          onPress={() => triggerStage('historical')}
        >
          <Text style={styles.triggerButtonText}>Run Now</Text>
        </TouchableOpacity>
      </View>

      {/* Stage 3: Validation */}
      <View style={styles.stageCard}>
        <View style={styles.stageHeader}>
          <View style={[styles.stageIconContainer, { backgroundColor: '#10b981' }]}>
            <Ionicons 
              name={getStageIcon('validation')} 
              size={24} 
              color="#fff" 
            />
          </View>
          <View style={styles.stageInfo}>
            <Text style={styles.stageName}>Stage 3: Validation</Text>
            <Text style={styles.stageDescription}>
              Weekly accuracy check & algorithm tuning
            </Text>
          </View>
          <View style={[
            styles.statusBadge,
            { backgroundColor: getStatusColor(flowState.validation?.status || 'pending') }
          ]}>
            <Text style={styles.statusText}>
              {flowState.validation?.status || 'pending'}
            </Text>
          </View>
        </View>

        {flowState.validation?.data && (
          <View style={styles.stageData}>
            {flowState.validation.data.precision !== undefined && (
              <>
                <Text style={styles.dataLabel}>
                  Precision: {(flowState.validation.data.precision * 100).toFixed(1)}%
                </Text>
                <Text style={styles.dataLabel}>
                  F1 Score: {(flowState.validation.data.f1Score * 100).toFixed(1)}%
                </Text>
              </>
            )}
          </View>
        )}

        <TouchableOpacity 
          style={styles.triggerButton}
          onPress={() => triggerStage('validation')}
        >
          <Text style={styles.triggerButtonText}>Run Now</Text>
        </TouchableOpacity>
      </View>

      {/* Flow Status Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>System Health</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryItem}>
            <Ionicons name="pulse" size={20} color="#3b82f6" />
            <Text style={styles.summaryLabel}>Active</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="cloud-download" size={20} color="#10b981" />
            <Text style={styles.summaryLabel}>Connected</Text>
          </View>
          <View style={styles.summaryItem}>
            <Ionicons name="shield-checkmark" size={20} color="#10b981" />
            <Text style={styles.summaryLabel}>Validated</Text>
          </View>
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
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  stageCard: {
    backgroundColor: 'white',
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stageIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stageInfo: {
    flex: 1,
  },
  stageName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  stageDescription: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  stageData: {
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  dataLabel: {
    fontSize: 13,
    color: '#374151',
    marginBottom: 4,
  },
  triggerButton: {
    backgroundColor: '#1e40af',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  triggerButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: 'white',
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3.84,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
});
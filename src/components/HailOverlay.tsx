import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MRMSService, StormEvent } from '../services/mrmsService';

interface HailOverlayProps {
  onStormToggle: (stormId: string, enabled: boolean) => void;
  onStormDelete: (stormId: string) => void;
  onStormFocus: (stormId: string) => void;
}

export default function HailOverlay({ 
  onStormToggle, 
  onStormDelete,
  onStormFocus 
}: HailOverlayProps) {
  const [storms, setStorms] = useState<StormEvent[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    loadStorms();
  }, []);

  const loadStorms = async () => {
    const activeStorms = await MRMSService.getActiveStorms();
    setStorms(activeStorms);
  };

  const handleToggle = async (stormId: string, enabled: boolean) => {
    await MRMSService.toggleStorm(stormId, enabled);
    onStormToggle(stormId, enabled);
    loadStorms();
  };

  const handleDelete = async (stormId: string) => {
    await MRMSService.deleteStorm(stormId);
    onStormDelete(stormId);
    loadStorms();
  };

  const handleFocus = async (stormId: string) => {
    await MRMSService.focusOnStorm(stormId);
    onStormFocus(stormId);
    loadStorms();
  };


  const getHailSizeEmoji = (size: number) => {
    if (size >= 3) return '🔴';
    if (size >= 2) return '🟠';
    if (size >= 1) return '🟡';
    return '🟢';
  };

  if (storms.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.headerLeft}>
          <Ionicons 
            name={expanded ? "chevron-down" : "chevron-up"} 
            size={20} 
            color="#1e40af" 
          />
          <Text style={styles.title}>Active Storms ({storms.length}/3)</Text>
        </View>
        {storms.some(s => s.enabled) && (
          <TouchableOpacity
            onPress={() => storms.forEach(s => handleToggle(s.id, false))}
            style={styles.toggleAllButton}
          >
            <Text style={styles.toggleAllText}>Hide All</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {expanded && (
        <ScrollView style={styles.stormList}>
          {storms.map((storm) => (
            <View key={storm.id} style={styles.stormItem}>
              <TouchableOpacity
                style={styles.stormToggle}
                onPress={() => handleToggle(storm.id, !storm.enabled)}
              >
                <Ionicons 
                  name={storm.enabled ? "checkbox" : "square-outline"} 
                  size={24} 
                  color={storm.enabled ? "#1e40af" : "#9ca3af"} 
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.stormInfo}
                onPress={() => handleFocus(storm.id)}
              >
                <View style={styles.stormHeader}>
                  <Text style={[
                    styles.stormName,
                    !storm.enabled && styles.disabledText
                  ]}>
                    {storm.name}
                  </Text>
                  <View style={styles.sizeIndicator}>
                    <Text style={styles.sizeEmoji}>
                      {getHailSizeEmoji(storm.peakSize)}
                    </Text>
                    <Text style={styles.sizeText}>
                      {storm.peakSize.toFixed(1)}"
                    </Text>
                  </View>
                </View>
                
                <Text style={styles.stormDetails}>
                  {storm.reports.length} reports • {storm.startTime.toLocaleTimeString()}
                </Text>
                
                {storm.reports.length > 0 && (
                  <Text style={styles.confidenceText}>
                    Avg confidence: {Math.round(
                      storm.reports.reduce((sum, r) => sum + r.confidence, 0) / storm.reports.length
                    )}%
                  </Text>
                )}
                
                {storm.enabled && storm.reports.length > 0 && (
                  <Text style={styles.liveIndicator}>
                    🔴 LIVE
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(storm.id)}
              >
                <Ionicons name="trash-outline" size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Hail Size Legend:</Text>
        <View style={styles.legendItems}>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>🟢</Text>
            <Text style={styles.legendText}>{'<1"'}</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>🟡</Text>
            <Text style={styles.legendText}>1-2"</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>🟠</Text>
            <Text style={styles.legendText}>2-3"</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>🔴</Text>
            <Text style={styles.legendText}>3+"</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
    maxHeight: 300,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginLeft: 8,
  },
  toggleAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
  },
  toggleAllText: {
    fontSize: 12,
    color: '#6b7280',
  },
  stormList: {
    maxHeight: 150,
  },
  stormItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  stormToggle: {
    marginRight: 12,
  },
  stormInfo: {
    flex: 1,
  },
  stormHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stormName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937',
    flex: 1,
  },
  disabledText: {
    color: '#9ca3af',
  },
  sizeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sizeEmoji: {
    fontSize: 16,
    marginRight: 4,
  },
  sizeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  stormDetails: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  liveIndicator: {
    fontSize: 10,
    color: '#ef4444',
    marginTop: 2,
  },
  deleteButton: {
    padding: 8,
  },
  legend: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  legendTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  legendItems: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendEmoji: {
    fontSize: 14,
    marginRight: 4,
  },
  legendText: {
    fontSize: 12,
    color: '#6b7280',
  },
  confidenceText: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: '500',
    marginTop: 2,
  },
});
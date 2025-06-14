import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LocationService } from '../services/locationService';
import { StorageService } from '../services/storageService';
import { SupabaseService } from '../services/supabaseService';
import { Knock, KnockOutcome } from '../types';

const OUTCOMES: { value: KnockOutcome; label: string; color: string; emoji: string }[] = [
  // Primary outcomes
  { value: 'not_home', label: '👻 Not Home', color: '#6b7280', emoji: '👻' },
  { value: 'revisit', label: '👀 Revisit', color: '#3b82f6', emoji: '👀' },
  { value: 'no_soliciting', label: '🚫 No Soliciting', color: '#ef4444', emoji: '🚫' },
  { value: 'lead', label: '✅ Lead', color: '#10b981', emoji: '✅' },
  { value: 'sale', label: '📝 Signed', color: '#22c55e', emoji: '📝' },
  { value: 'callback', label: '🔄 Follow Up', color: '#f59e0b', emoji: '🔄' },
  
  // Property status
  { value: 'new_roof', label: '🏠 New Roof', color: '#8b5cf6', emoji: '🏠' },
  { value: 'competitor', label: '🚧 Competitor', color: '#dc2626', emoji: '🚧' },
  { value: 'renter', label: '🔑 Renter', color: '#6366f1', emoji: '🔑' },
  { value: 'poor_condition', label: '🏚️ Poor Condition', color: '#78716c', emoji: '🏚️' },
  
  // Action taken
  { value: 'proposal_left', label: '📋 Proposal Left', color: '#0891b2', emoji: '📋' },
  { value: 'stay_away', label: '⚠️ Stay Away', color: '#991b1b', emoji: '⚠️' },
];

export default function KnockScreen() {
  const [selectedOutcome, setSelectedOutcome] = useState<KnockOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    setLoading(true);
    const location = await LocationService.getCurrentLocation();
    if (location) {
      setCurrentLocation({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
      
      // Get address from coordinates
      const addr = await LocationService.reverseGeocode(
        location.coords.latitude,
        location.coords.longitude
      );
      setAddress(addr);
    }
    setLoading(false);
  };

  const saveKnock = async () => {
    if (!selectedOutcome) {
      Alert.alert('Error', 'Please select an outcome');
      return;
    }

    if (!currentLocation) {
      Alert.alert('Error', 'Unable to get current location');
      return;
    }

    const knock: Knock = {
      id: Date.now().toString(),
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
      address,
      outcome: selectedOutcome,
      notes,
      timestamp: new Date(),
      repId: 'current-user', // TODO: Get from auth
      syncStatus: 'pending',
    };

    try {
      await StorageService.saveKnock(knock);
      
      // Update daily stats
      const today = new Date();
      const dailyStats = await StorageService.getDailyStats();
      const todayStats = dailyStats.find(
        s => new Date(s.date).toDateString() === today.toDateString()
      ) || {
        date: today,
        knocks: 0,
        contacts: 0,
        leads: 0,
        sales: 0,
        revenue: 0,
      };

      todayStats.knocks += 1;
      if (selectedOutcome === 'lead') todayStats.leads += 1;
      if (selectedOutcome === 'sale') todayStats.sales += 1;
      if (['lead', 'sale', 'callback', 'not_interested'].includes(selectedOutcome)) {
        todayStats.contacts += 1;
      }

      await StorageService.saveDailyStats(todayStats);

      // Auto-sync if enabled
      const settings = await StorageService.getSettings();
      if (settings.autoSync) {
        // Sync in background, don't wait
        SupabaseService.syncKnocks().catch(console.error);
      }

      Alert.alert('Success', 'Knock recorded successfully', [
        {
          text: 'OK',
          onPress: () => {
            setSelectedOutcome(null);
            setNotes('');
            getCurrentLocation();
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save knock');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.locationCard}>
        <View style={styles.locationHeader}>
          <Ionicons name="location" size={24} color="#1e40af" />
          <Text style={styles.locationTitle}>Current Location</Text>
          <TouchableOpacity onPress={getCurrentLocation}>
            <Ionicons name="refresh" size={24} color="#1e40af" />
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <Text style={styles.address}>{address || 'Getting location...'}</Text>
        )}
      </View>

      <View style={styles.outcomeSection}>
        <Text style={styles.sectionTitle}>Primary Outcomes</Text>
        <View style={styles.outcomeGrid}>
          {OUTCOMES.slice(0, 6).map((outcome) => (
            <TouchableOpacity
              key={outcome.value}
              style={[
                styles.outcomeButton,
                { borderColor: outcome.color },
                selectedOutcome === outcome.value && {
                  backgroundColor: outcome.color,
                },
              ]}
              onPress={() => setSelectedOutcome(outcome.value)}
            >
              <Text style={styles.outcomeEmoji}>{outcome.emoji}</Text>
              <Text
                style={[
                  styles.outcomeText,
                  selectedOutcome === outcome.value && styles.selectedOutcomeText,
                ]}
              >
                {outcome.label.replace(outcome.emoji + ' ', '')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Property Status</Text>
        <View style={styles.outcomeGrid}>
          {OUTCOMES.slice(6, 10).map((outcome) => (
            <TouchableOpacity
              key={outcome.value}
              style={[
                styles.outcomeButton,
                { borderColor: outcome.color },
                selectedOutcome === outcome.value && {
                  backgroundColor: outcome.color,
                },
              ]}
              onPress={() => setSelectedOutcome(outcome.value)}
            >
              <Text style={styles.outcomeEmoji}>{outcome.emoji}</Text>
              <Text
                style={[
                  styles.outcomeText,
                  selectedOutcome === outcome.value && styles.selectedOutcomeText,
                ]}
              >
                {outcome.label.replace(outcome.emoji + ' ', '')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Actions</Text>
        <View style={styles.outcomeGrid}>
          {OUTCOMES.slice(10).map((outcome) => (
            <TouchableOpacity
              key={outcome.value}
              style={[
                styles.outcomeButton,
                { borderColor: outcome.color },
                selectedOutcome === outcome.value && {
                  backgroundColor: outcome.color,
                },
              ]}
              onPress={() => setSelectedOutcome(outcome.value)}
            >
              <Text style={styles.outcomeEmoji}>{outcome.emoji}</Text>
              <Text
                style={[
                  styles.outcomeText,
                  selectedOutcome === outcome.value && styles.selectedOutcomeText,
                ]}
              >
                {outcome.label.replace(outcome.emoji + ' ', '')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.notesSection}>
        <Text style={styles.sectionTitle}>Notes (Optional)</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add any additional notes..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      <TouchableOpacity
        style={[styles.saveButton, !selectedOutcome && styles.saveButtonDisabled]}
        onPress={saveKnock}
        disabled={!selectedOutcome || loading}
      >
        <Ionicons name="checkmark-circle" size={24} color="white" />
        <Text style={styles.saveButtonText}>Save Knock</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  locationCard: {
    backgroundColor: 'white',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginLeft: 8,
  },
  address: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 20,
  },
  loader: {
    marginVertical: 8,
  },
  outcomeSection: {
    margin: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#1f2937',
  },
  outcomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  outcomeButton: {
    width: '31%',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
    backgroundColor: 'white',
    alignItems: 'center',
  },
  outcomeEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  outcomeText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: '#1f2937',
  },
  selectedOutcomeText: {
    color: 'white',
  },
  notesSection: {
    margin: 16,
  },
  notesInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    minHeight: 100,
  },
  saveButton: {
    backgroundColor: '#1e40af',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
});
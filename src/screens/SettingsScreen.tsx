import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StorageService } from '../services/storageService';

export default function SettingsScreen() {
  const [settings, setSettings] = useState({
    autoSync: true,
    trackingEnabled: true,
    showIncomeOverlay: false,
    notificationsEnabled: true,
    dailyKnockGoal: '100',
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const savedSettings = await StorageService.getSettings();
    if (savedSettings && Object.keys(savedSettings).length > 0) {
      setSettings({ ...settings, ...savedSettings });
    }
  };

  const updateSetting = async (key: string, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await StorageService.saveSettings(newSettings);
  };

  const clearData = () => {
    Alert.alert(
      'Clear All Data',
      'Are you sure you want to delete all data? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await StorageService.clearAll();
            Alert.alert('Success', 'All data has been cleared');
          },
        },
      ]
    );
  };

  const syncData = async () => {
    const unsyncedKnocks = await StorageService.getUnsyncedKnocks();
    Alert.alert(
      'Sync Status',
      `${unsyncedKnocks.length} knocks waiting to sync.\n\nSync functionality will be available with the backend integration.`
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>General Settings</Text>
        
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto Sync</Text>
            <Text style={styles.settingDescription}>
              Automatically sync data when connected
            </Text>
          </View>
          <Switch
            value={settings.autoSync}
            onValueChange={(value) => updateSetting('autoSync', value)}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={settings.autoSync ? '#1e40af' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Background Tracking</Text>
            <Text style={styles.settingDescription}>
              Track location in the background
            </Text>
          </View>
          <Switch
            value={settings.trackingEnabled}
            onValueChange={(value) => updateSetting('trackingEnabled', value)}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={settings.trackingEnabled ? '#1e40af' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Show Income Overlay</Text>
            <Text style={styles.settingDescription}>
              Display neighborhood income data on map
            </Text>
          </View>
          <Switch
            value={settings.showIncomeOverlay}
            onValueChange={(value) => updateSetting('showIncomeOverlay', value)}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={settings.showIncomeOverlay ? '#1e40af' : '#f3f4f6'}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Notifications</Text>
            <Text style={styles.settingDescription}>
              Receive daily reminders and updates
            </Text>
          </View>
          <Switch
            value={settings.notificationsEnabled}
            onValueChange={(value) => updateSetting('notificationsEnabled', value)}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={settings.notificationsEnabled ? '#1e40af' : '#f3f4f6'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Goals</Text>
        
        <View style={styles.goalRow}>
          <Text style={styles.settingLabel}>Daily Knock Goal</Text>
          <TextInput
            style={styles.goalInput}
            value={settings.dailyKnockGoal}
            onChangeText={(value) => updateSetting('dailyKnockGoal', value)}
            keyboardType="numeric"
            placeholder="100"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data Management</Text>
        
        <TouchableOpacity style={styles.actionButton} onPress={syncData}>
          <Ionicons name="cloud-upload" size={24} color="#1e40af" />
          <Text style={styles.actionButtonText}>Sync Data</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionButton, styles.dangerButton]} 
          onPress={clearData}
        >
          <Ionicons name="trash" size={24} color="#dc2626" />
          <Text style={[styles.actionButtonText, styles.dangerText]}>
            Clear All Data
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.aboutText}>D2D Sales Tracker v1.0.0</Text>
        <Text style={styles.aboutText}>© 2024 Your Company</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  section: {
    backgroundColor: 'white',
    marginVertical: 8,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    color: '#1f2937',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  goalRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  goalInput: {
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginVertical: 4,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
  },
  dangerButton: {
    backgroundColor: '#fee2e2',
  },
  actionButtonText: {
    fontSize: 16,
    color: '#1e40af',
    marginLeft: 12,
    fontWeight: '500',
  },
  dangerText: {
    color: '#dc2626',
  },
  aboutText: {
    fontSize: 14,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
});
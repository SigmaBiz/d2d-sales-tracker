/**
 * Native Module Test Screen
 * Tests native storage performance vs AsyncStorage
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { OPTIMIZATIONS } from '../config/optimization';
import { StorageServiceNative } from '../services/storageServiceNative';
import { NativeModuleManager } from '../native/NativeModuleManager';
import { Knock } from '../types';

export default function NativeTestScreen() {
  const [results, setResults] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  
  const log = (message: string) => {
    console.log(message);
    setResults(prev => [...prev, message]);
  };
  
  const clearResults = () => {
    setResults([]);
  };
  
  const testNativeAvailability = async () => {
    log('=== Testing Native Module Availability ===');
    
    const hasNative = NativeModuleManager.hasNativeModules();
    log(`Native modules available: ${hasNative}`);
    
    const metrics = await NativeModuleManager.getPerformanceMetrics();
    log(`Platform: ${metrics.platform}`);
    log(`Storage enabled: ${metrics.storageEnabled || false}`);
    log(`Map enabled: ${metrics.mapEnabled || false}`);
    
    if (NativeModuleManager.storage) {
      try {
        const enabled = await NativeModuleManager.storage.isEnabled();
        log(`Native storage kill switch: ${enabled ? 'ON' : 'OFF'}`);
      } catch (error) {
        log(`Error checking native storage: ${error}`);
      }
    } else {
      log('Native storage module not found');
    }
  };
  
  const testPerformanceComparison = async () => {
    log('\n=== Performance Comparison Test ===');
    setTesting(true);
    
    try {
      await StorageServiceNative.comparePerformance();
      log('Performance test completed - check console for detailed results');
    } catch (error) {
      log(`Performance test error: ${error}`);
    }
    
    setTesting(false);
  };
  
  const testSaveAndLoad = async () => {
    log('\n=== Save and Load Test ===');
    setTesting(true);
    
    const testKnock: Knock = {
      id: `native-test-${Date.now()}`,
      latitude: 35.4676,
      longitude: -97.5164,
      outcome: 'lead',
      timestamp: new Date(),
      address: '123 Native Test St',
      notes: 'Testing native storage module',
      syncStatus: 'pending',
      history: [{
        outcome: 'not_home',
        timestamp: new Date(Date.now() - 86400000),
        notes: 'Previous visit'
      }]
    };
    
    try {
      // Test save
      log('Saving test knock...');
      const saveStart = Date.now();
      await StorageServiceNative.saveKnock(testKnock);
      log(`Save completed in ${Date.now() - saveStart}ms`);
      
      // Test load
      log('Loading all knocks...');
      const loadStart = Date.now();
      const knocks = await StorageServiceNative.getKnocks();
      log(`Loaded ${knocks.length} knocks in ${Date.now() - loadStart}ms`);
      
      // Verify our knock is there
      const found = knocks.find(k => k.id === testKnock.id);
      if (found) {
        log('✅ Test knock found successfully');
        log(`  Address: ${found.address}`);
        log(`  Outcome: ${found.outcome}`);
        log(`  Has history: ${found.history ? 'YES' : 'NO'}`);
      } else {
        log('❌ Test knock not found!');
      }
      
      // Test other methods
      log('\nTesting getRecentKnocks...');
      const recentStart = Date.now();
      const recent = await StorageServiceNative.getRecentKnocks(5);
      log(`Got ${recent.length} recent knocks in ${Date.now() - recentStart}ms`);
      
      // Clean up
      log('\nCleaning up test knock...');
      await StorageServiceNative.deleteKnock(testKnock.id);
      log('Test knock deleted');
      
    } catch (error) {
      log(`Test error: ${error}`);
    }
    
    setTesting(false);
  };
  
  const toggleKillSwitch = () => {
    OPTIMIZATIONS.USE_NATIVE_STORAGE = !OPTIMIZATIONS.USE_NATIVE_STORAGE;
    log(`\nNative storage kill switch: ${OPTIMIZATIONS.USE_NATIVE_STORAGE ? 'ON' : 'OFF'}`);
    Alert.alert(
      'Kill Switch Toggled',
      `Native storage is now ${OPTIMIZATIONS.USE_NATIVE_STORAGE ? 'ENABLED' : 'DISABLED'}`,
      [{ text: 'OK' }]
    );
  };
  
  const emergencyKillSwitch = () => {
    NativeModuleManager.disableAllNativeModules();
    log('\n🚨 EMERGENCY KILL SWITCH ACTIVATED');
    log('All native modules disabled');
    Alert.alert(
      'Emergency Kill Switch',
      'All native modules have been disabled. App will use JavaScript implementations.',
      [{ text: 'OK' }]
    );
  };
  
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Native Module Testing</Text>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#10b981' }]} 
          onPress={testNativeAvailability}
          disabled={testing}
        >
          <Text style={styles.buttonText}>Check Native Modules</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#3b82f6' }]} 
          onPress={testSaveAndLoad}
          disabled={testing}
        >
          <Text style={styles.buttonText}>Test Save & Load</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#8b5cf6' }]} 
          onPress={testPerformanceComparison}
          disabled={testing}
        >
          <Text style={styles.buttonText}>Compare Performance</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#f59e0b' }]} 
          onPress={toggleKillSwitch}
          disabled={testing}
        >
          <Text style={styles.buttonText}>
            Toggle Kill Switch ({OPTIMIZATIONS.USE_NATIVE_STORAGE ? 'ON' : 'OFF'})
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#ef4444' }]} 
          onPress={emergencyKillSwitch}
          disabled={testing}
        >
          <Text style={styles.buttonText}>🚨 Emergency Kill Switch</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: '#6b7280' }]} 
          onPress={clearResults}
        >
          <Text style={styles.buttonText}>Clear Results</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.results}>
        <Text style={styles.resultsTitle}>Test Results:</Text>
        {results.map((result, index) => (
          <Text key={index} style={styles.resultText}>{result}</Text>
        ))}
        {testing && <Text style={styles.loadingText}>Testing in progress...</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 20,
    marginTop: 40,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  results: {
    marginTop: 20,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    minHeight: 200,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 4,
    color: '#374151',
  },
  loadingText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#6b7280',
    marginTop: 10,
  },
});
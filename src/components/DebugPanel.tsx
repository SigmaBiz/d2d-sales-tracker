import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KnockDebugger } from '../utils/knockDebugger';

export default function DebugPanel() {
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const showLogs = () => {
    setLogs(KnockDebugger.getLogs());
    setVisible(true);
  };

  const clearLogs = () => {
    KnockDebugger.clear();
    setLogs([]);
  };

  return (
    <>
      {/* Debug Button - Small floating button */}
      <TouchableOpacity
        style={styles.debugButton}
        onPress={showLogs}
      >
        <Ionicons name="bug" size={20} color="white" />
      </TouchableOpacity>

      {/* Debug Modal */}
      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.header}>
              <Text style={styles.title}>🐛 Knock Debug Logs</Text>
              <View style={styles.headerButtons}>
                <TouchableOpacity onPress={clearLogs} style={styles.clearButton}>
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVisible(false)}>
                  <Ionicons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
            </View>
            
            <ScrollView style={styles.logContainer}>
              {logs.length === 0 ? (
                <Text style={styles.emptyText}>No logs yet. Click on the map to start logging.</Text>
              ) : (
                logs.map((log, index) => (
                  <Text key={index} style={styles.logText}>{log}</Text>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  debugButton: {
    position: 'absolute',
    bottom: 150,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  clearText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  logContainer: {
    padding: 16,
  },
  logText: {
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 4,
    color: '#374151',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9ca3af',
    marginTop: 20,
  },
});
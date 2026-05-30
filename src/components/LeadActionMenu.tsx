/**
 * Shared lead action menu — renders the legal next actions for a lead given its
 * current status + the viewer's role, and performs the transition on tap.
 *
 * Used in both the Log screen and the map knock-detail sheet. The button set is
 * advisory (from leadLifecycle.legalActions); the server re-validates and may
 * still reject (shown as an alert).
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { SupabaseService } from '../services/supabaseService';
import {
  legalActions, LeadStatus, Role, ActionOption,
} from '../services/leadLifecycle';

interface Props {
  knockId: string;
  status: LeadStatus | null;
  role: Role | null;
  recoveryUsed?: boolean;
  overrideUsed?: boolean;
  /** called after a successful transition (refresh caller) */
  onTransitioned?: (newStatus?: string, newLabel?: string) => void;
}

export default function LeadActionMenu({
  knockId, status, role, recoveryUsed, overrideUsed, onTransitioned,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const options: ActionOption[] = legalActions(status, role, { recoveryUsed, overrideUsed });

  if (options.length === 0) return null;

  const run = async (opt: ActionOption) => {
    const doIt = async () => {
      setBusy(opt.action);
      const res = await SupabaseService.transitionLead(knockId, opt.action);
      setBusy(null);
      if (!res.ok) {
        Alert.alert('Action failed', res.error ?? 'Could not update lead');
        return;
      }
      onTransitioned?.(res.status, res.label);
    };
    if (opt.destructive) {
      Alert.alert(opt.label, 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: opt.label, style: 'destructive', onPress: doIt },
      ]);
    } else {
      doIt();
    }
  };

  return (
    <View style={styles.row}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.action}
          style={[styles.btn, opt.destructive && styles.btnDestructive]}
          onPress={() => run(opt)}
          disabled={busy !== null}
        >
          {busy === opt.action
            ? <ActivityIndicator size="small" color={opt.destructive ? '#dc2626' : '#1e40af'} />
            : <Text style={[styles.btnText, opt.destructive && styles.btnTextDestructive]}>
                {opt.emoji}  {opt.label}
              </Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: {
    borderWidth: 1, borderColor: '#1e40af', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#eff6ff',
  },
  btnDestructive: { borderColor: '#dc2626', backgroundColor: '#fef2f2' },
  btnText: { color: '#1e40af', fontWeight: '700', fontSize: 14 },
  btnTextDestructive: { color: '#dc2626' },
});

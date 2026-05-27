import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SupabaseService } from '../services/supabaseService';

interface Props {
  onComplete: () => void;
}

export default function TeamSetupScreen({ onComplete }: Props) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!teamName.trim()) {
      Alert.alert('Team Name Required', 'Enter a name for your team.');
      return;
    }
    setLoading(true);
    const result = await SupabaseService.createTeam(teamName.trim());
    setLoading(false);

    if (!result.success) {
      Alert.alert('Error', result.error ?? 'Could not create team.');
      return;
    }
    setCreatedCode(result.invite_code!);
  };

  const handleJoin = async () => {
    if (inviteCode.trim().length < 6) {
      Alert.alert('Invalid Code', 'Enter the 6-character invite code from your team owner.');
      return;
    }
    setLoading(true);
    const result = await SupabaseService.joinTeam(inviteCode.trim());
    setLoading(false);

    if (!result.success) {
      Alert.alert('Error', result.error ?? 'Could not join team.');
      return;
    }
    onComplete();
  };

  const handleSkip = async () => {
    await SupabaseService.markTeamSetupDone();
    onComplete();
  };

  // ── Created successfully — show invite code ──────────────────────────────
  if (createdCode) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.emoji}>✅</Text>
          <Text style={styles.title}>Team Created!</Text>
          <Text style={styles.subtitle}>
            Share this code with your canvassers so they can join your team.
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.code}>{createdCode}</Text>
          </View>
          <Text style={styles.codeHint}>
            Find this code anytime in Settings → Team.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onComplete}>
            <Text style={styles.primaryBtnText}>Start Canvassing</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Choose mode ──────────────────────────────────────────────────────────
  if (mode === 'choose') {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.emoji}>👥</Text>
          <Text style={styles.title}>Team Setup</Text>
          <Text style={styles.subtitle}>
            Teams let every rep see all door pins — no double-knocking. Owner keeps all data if a rep leaves.
          </Text>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setMode('create')}>
            <Text style={styles.primaryBtnText}>Create a Team</Text>
            <Text style={styles.primaryBtnSub}>I'm the owner / manager</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('join')}>
            <Text style={styles.secondaryBtnText}>Join a Team</Text>
            <Text style={styles.secondaryBtnSub}>I have an invite code</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipText}>Use Solo (no team)</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Create mode ──────────────────────────────────────────────────────────
  if (mode === 'create') {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <TouchableOpacity onPress={() => setMode('choose')} style={styles.backBtn}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Create a Team</Text>
            <Text style={styles.label}>Team Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. OKC Storm Chasers"
              value={teamName}
              onChangeText={setTeamName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleCreate}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="white" />
                : <Text style={styles.primaryBtnText}>Create Team</Text>
              }
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Join mode ────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <TouchableOpacity onPress={() => setMode('choose')} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Join a Team</Text>
          <Text style={styles.label}>Invite Code</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="ABC123"
            value={inviteCode}
            onChangeText={v => setInviteCode(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleJoin}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled]}
            onPress={handleJoin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={styles.primaryBtnText}>Join Team</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e40af',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: 'white',
    margin: 24,
    borderRadius: 20,
    padding: 28,
  },
  emoji: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#f9fafb',
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#1e40af',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  primaryBtnSub: {
    color: '#93c5fd',
    fontSize: 12,
    marginTop: 2,
  },
  secondaryBtn: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  secondaryBtnText: {
    color: '#1e40af',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtnSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  skipBtn: {
    padding: 12,
    alignItems: 'center',
  },
  skipText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  backBtn: {
    marginBottom: 16,
  },
  backText: {
    color: '#1e40af',
    fontSize: 14,
    fontWeight: '600',
  },
  codeBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 20,
    marginVertical: 20,
    borderWidth: 2,
    borderColor: '#86efac',
  },
  code: {
    fontSize: 36,
    fontWeight: '800',
    color: '#166534',
    textAlign: 'center',
    letterSpacing: 8,
  },
  codeHint: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
  },
});

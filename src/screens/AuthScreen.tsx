import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SupabaseService } from '../services/supabaseService';

interface Props {
  onAuthenticated: () => void;
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Required', 'Enter your email and password.');
      return;
    }
    setLoading(true);
    const result = mode === 'signin'
      ? await SupabaseService.signIn(email.trim(), password)
      : await SupabaseService.signUp(email.trim(), password);
    setLoading(false);

    if (result.success) {
      onAuthenticated();
    } else {
      Alert.alert(mode === 'signin' ? 'Sign In Failed' : 'Sign Up Failed', result.error);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>🏠</Text>
        <Text style={styles.title}>D2D Sales Tracker</Text>
        <Text style={styles.subtitle}>
          {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />

        <TouchableOpacity style={styles.button} onPress={handle} disabled={loading}>
          {loading
            ? <ActivityIndicator color="white" />
            : <Text style={styles.buttonText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchMode}
          onPress={() => setMode(m => m === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin'
              ? "Don't have an account? Sign up"
              : 'Already have an account? Sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#1e40af',
    justifyContent: 'center', padding: 24,
  },
  card: {
    backgroundColor: 'white', borderRadius: 20,
    padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: '#1e40af', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 24 },
  input: {
    width: '100%', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, padding: 14, fontSize: 16,
    color: '#111827', marginBottom: 12, backgroundColor: '#f9fafb',
  },
  button: {
    width: '100%', backgroundColor: '#1e40af',
    borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 8,
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '700' },
  switchMode: { marginTop: 20 },
  switchText: { color: '#6b7280', fontSize: 14 },
});

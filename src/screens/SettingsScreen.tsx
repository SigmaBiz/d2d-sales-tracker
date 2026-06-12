import React, { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Share,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SupabaseService, TeamInfo } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';

export default function SettingsScreen({ navigation }: any) {
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dateOfLoss, setDateOfLoss] = useState<string | null>(null); // team's active campaign
  const [showDolPicker, setShowDolPicker] = useState(false);
  const [dailyGoal, setDailyGoal] = useState<number>(75); // team daily door goal
  const goalSaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Refetch every time the tab gains focus (not just once on mount) so team state
  // never shows stale — e.g. right after joining a team or an RLS change.
  useFocusEffect(useCallback(() => { loadData(); }, []));

  const loadData = async () => {
    const [teamResult, sessionResult, dol, goal] = await Promise.all([
      SupabaseService.getMyTeam(),
      supabase.auth.getSession(),
      SupabaseService.getTeamDefaultDateOfLoss(true),
      SupabaseService.getTeamDailyDoorGoal(true),
    ]);
    setTeam(teamResult);
    setUserEmail(sessionResult.data.session?.user?.email ?? null);
    setDateOfLoss(dol);
    setDailyGoal(goal);
    setLoadingTeam(false);
  };

  const handleSetDateOfLoss = async (d: Date) => {
    const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const res = await SupabaseService.setTeamDefaultDateOfLoss(iso);
    if (res.ok) setDateOfLoss(iso);
    else Alert.alert('Error', res.error ?? 'Could not set date of loss');
  };

  /** Optimistic step + debounced save (one write after the taps settle). */
  const stepDailyGoal = (delta: number) => {
    setDailyGoal(prev => {
      const next = Math.max(5, Math.min(500, prev + delta));
      if (goalSaveTimer.current) clearTimeout(goalSaveTimer.current);
      goalSaveTimer.current = setTimeout(async () => {
        const res = await SupabaseService.setTeamDailyDoorGoal(next);
        if (!res.ok) Alert.alert('Error', res.error ?? 'Could not save the goal');
      }, 600);
      return next;
    });
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await SupabaseService.signOut();
        },
      },
    ]);
  };

  const handleLeaveTeam = () => {
    Alert.alert(
      'Leave Team',
      'You will no longer see team pins or be able to add knocks to this team.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await SupabaseService.leaveTeam();
            setTeam(null);
          },
        },
      ]
    );
  };

  const handleShareInviteCode = async (code: string) => {
    await Share.share({
      message: `Join my D2D Sales Tracker team! Use invite code: ${code}`,
    });
  };

  return (
    <ScrollView style={styles.container}>

      {/* ── ACCOUNT ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.accountRow}>
          <Ionicons name="person-circle-outline" size={20} color="#6b7280" />
          <Text style={styles.accountEmail} numberOfLines={1}>
            {userEmail ?? '—'}
          </Text>
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color="#dc2626" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* ── TEAM ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Team</Text>

        {loadingTeam ? (
          <ActivityIndicator style={{ margin: 16 }} color="#1e40af" />
        ) : team ? (
          <View style={styles.teamContainer}>
            <View style={styles.teamHeader}>
              <Text style={styles.teamName}>{team.name}</Text>
              <View style={[styles.roleBadge, team.role === 'owner' ? styles.roleBadgeOwner : styles.roleBadgeMember]}>
                <Text style={[styles.roleText, team.role === 'owner' ? styles.roleTextOwner : styles.roleTextMember]}>
                  {team.role === 'owner' ? 'Owner' : 'Member'}
                </Text>
              </View>
            </View>

            {team.role === 'owner' && (
              <>
                <Text style={styles.teamLabel}>INVITE CODE</Text>
                <TouchableOpacity
                  style={styles.inviteCodeBox}
                  onPress={() => handleShareInviteCode(team.invite_code)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.inviteCode}>{team.invite_code}</Text>
                  <View style={styles.shareChip}>
                    <Ionicons name="share-outline" size={14} color="#166534" />
                    <Text style={styles.shareChipText}>Share</Text>
                  </View>
                </TouchableOpacity>
                {team.member_count !== undefined && (
                  <Text style={styles.teamMeta}>
                    {team.member_count} member{team.member_count !== 1 ? 's' : ''}
                  </Text>
                )}

                {/* Active campaign — date of loss (owner sets; new knocks inherit it) */}
                <Text style={[styles.teamLabel, { marginTop: 16 }]}>ACTIVE DATE OF LOSS</Text>
                <TouchableOpacity style={styles.dolBox} onPress={() => setShowDolPicker(true)} activeOpacity={0.7}>
                  <Text style={styles.dolText}>
                    {dateOfLoss
                      ? new Date(dateOfLoss + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
                      : 'Not set — tap to choose'}
                  </Text>
                  <Ionicons name="calendar-outline" size={18} color="#1e40af" />
                </TouchableOpacity>
                <Text style={styles.dolHint}>New knocks are stamped with this campaign date.</Text>
                {showDolPicker && (
                  <DateTimePicker
                    value={dateOfLoss ? new Date(dateOfLoss + 'T00:00:00') : new Date()}
                    mode="date"
                    maximumDate={new Date()}
                    onChange={(_e, d) => {
                      setShowDolPicker(Platform.OS === 'ios');
                      if (d) handleSetDateOfLoss(d);
                    }}
                  />
                )}

                {/* Team daily door goal (analytics) */}
                <Text style={[styles.teamLabel, { marginTop: 16 }]}>TEAM DAILY DOOR GOAL</Text>
                <View style={styles.goalRow}>
                  <TouchableOpacity style={styles.goalStepBtn} onPress={() => stepDailyGoal(-5)}>
                    <Ionicons name="remove" size={20} color="#1e40af" />
                  </TouchableOpacity>
                  <Text style={styles.goalValue}>{dailyGoal} doors/day</Text>
                  <TouchableOpacity style={styles.goalStepBtn} onPress={() => stepDailyGoal(5)}>
                    <Ionicons name="add" size={20} color="#1e40af" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.dolHint}>Daily door target for goal tracking in Stats.</Text>
              </>
            )}

            {team.role === 'member' && (
              <TouchableOpacity style={styles.leaveButton} onPress={handleLeaveTeam}>
                <Ionicons name="exit-outline" size={18} color="#dc2626" />
                <Text style={styles.leaveText}>Leave Team</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Text style={styles.soloText}>
            Solo mode. Ask your owner for an invite code, then sign out and sign back in to join a team.
          </Text>
        )}
      </View>

      {/* ── NOTIFICATIONS ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <TouchableOpacity
          style={styles.navRow}
          onPress={() => Linking.openURL('app-settings:')}
        >
          <Ionicons name="notifications-outline" size={20} color="#1e40af" />
          <Text style={styles.navRowText}>Open iPhone Notification Settings</Text>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      {/* ── ADVANCED (owner only) ── */}
      {team?.role === 'owner' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Advanced</Text>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('PingHistory')}
          >
            <Ionicons name="notifications-outline" size={20} color="#1e40af" />
            <Text style={styles.navRowText}>Ping History</Text>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('DataFlow')}
          >
            <Ionicons name="analytics-outline" size={20} color="#1e40af" />
            <Text style={styles.navRowText}>Data Flow Monitor</Text>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navRow}
            onPress={() => navigation.navigate('HailIntelligence')}
          >
            <Ionicons name="thunderstorm-outline" size={20} color="#1e40af" />
            <Text style={styles.navRowText}>3-Tier Hail Intelligence</Text>
            <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── ABOUT ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <Text style={styles.aboutText}>D2D Sales Tracker v1.0.0</Text>
        <Text style={styles.aboutText}>© 2026</Text>
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
    marginTop: 12,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  // Account
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  accountEmail: {
    fontSize: 15,
    color: '#1f2937',
    flex: 1,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  signOutText: {
    fontSize: 15,
    color: '#dc2626',
    fontWeight: '500',
  },

  // Team
  teamContainer: {
    paddingHorizontal: 16,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  teamName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleBadgeOwner: {
    backgroundColor: '#dbeafe',
  },
  roleBadgeMember: {
    backgroundColor: '#f3f4f6',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  roleTextOwner: {
    color: '#1e40af',
  },
  roleTextMember: {
    color: '#6b7280',
  },
  teamLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  dolBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#eff6ff', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  dolText: { fontSize: 15, fontWeight: '600', color: '#1e40af' },
  dolHint: { fontSize: 12, color: '#9ca3af', marginTop: 6 },
  goalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#eff6ff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  goalStepBtn: {
    width: 38, height: 38, borderRadius: 8, backgroundColor: 'white',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#bfdbfe',
  },
  goalValue: { fontSize: 16, fontWeight: '600', color: '#1e40af' },
  inviteCodeBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#86efac',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inviteCode: {
    fontSize: 28,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 6,
  },
  shareChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  shareChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
  },
  teamMeta: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: 4,
  },
  leaveText: {
    fontSize: 15,
    color: '#dc2626',
    fontWeight: '500',
  },
  soloText: {
    fontSize: 14,
    color: '#9ca3af',
    paddingHorizontal: 16,
    lineHeight: 20,
  },

  // Nav rows
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  navRowText: {
    flex: 1,
    fontSize: 15,
    color: '#1f2937',
  },

  // About
  aboutText: {
    fontSize: 14,
    color: '#9ca3af',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
});

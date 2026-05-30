import React, { useEffect, useState, useRef } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, Modal,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  Linking, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import NativeMap, { NativeMapRef } from '../components/NativeMap';
import { LocationService } from '../services/locationService';
import { SupabaseService } from '../services/supabaseService';
import { MRMSService, HailReport } from '../services/mrmsService';
import { IEMArchiveService } from '../services/tier2IEMService';
import { HailAlertService } from '../services/hailAlertService';
import HailOverlay from '../components/HailOverlay';
import AddressSearchBar from '../components/AddressSearchBar';
import NotificationLogPanel from '../components/NotificationLogPanel';
import { Knock, KnockContact, KnockOutcome, KNOCK_OUTCOME_EMOJI, KNOCK_OUTCOME_LABEL, labsForRole } from '../types';
import { supabase } from '../services/supabaseClient';
import LeadActionMenu from '../components/LeadActionMenu';
import { LeadStatus, STATUS_LABEL, STATUS_COLOR, isTerminal } from '../services/leadLifecycle';

const LABEL_ORDER: KnockOutcome[] = [
  'no_home', 'not_interested', 'no_soliciting', 'renter',
  'conversation', 'inspected', 'follow_up', 'lead', 'signed', 'scout',
];

// Gate-filtered label sets. "No" (door didn't open) → outcomes you can tell
// without engaging anyone. "Yes" (door opened) → outcomes that require talking.
const NOT_OPENED_LABELS: KnockOutcome[] = ['no_home', 'no_soliciting', 'scout'];
const OPENED_LABELS: KnockOutcome[] = [
  'not_interested', 'renter', 'conversation', 'inspected', 'follow_up', 'lead', 'signed',
];

export default function RealMapScreen({ navigation }: any) {
  const mapRef = useRef<NativeMapRef>(null);
  const suppressNextMapPress = useRef(false);

  // Map state
  const [knocks, setKnocks] = useState<Knock[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false); // locate button in-flight (slow GPS)
  const [hailReports, setHailReports] = useState<HailReport[]>([]);
  const [verifiedReports, setVerifiedReports] = useState<HailReport[]>([]);
  const [mapType, setMapType] = useState<'standard' | 'satellite' | 'hybrid'>('standard');


  // Storm panel
  const [activeStorms, setActiveStorms] = useState<any[]>([]);
  const [showStormPanel, setShowStormPanel] = useState(false);
  const [showNotificationLog, setShowNotificationLog] = useState(false);

  // Label picker state
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingKnock, setPendingKnock] = useState<Knock | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<KnockOutcome | null>(null);
  const [pickerNotes, setPickerNotes] = useState('');
  const [savingKnock, setSavingKnock] = useState(false);

  // Detail sheet state
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailKnock, setDetailKnock] = useState<Knock | null>(null);
  const [detailHistory, setDetailHistory] = useState<Knock['history']>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Contact state
  const [detailContacts, setDetailContacts] = useState<KnockContact[]>([]);
  const [contactFormVisible, setContactFormVisible] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactInsurance, setContactInsurance] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  // Ping Owner state
  const [pingOwnerLoading, setPingOwnerLoading] = useState(false);
  const [pingOwnerSent, setPingOwnerSent] = useState(false);

  // Property data state
  const [propertyFormVisible, setPropertyFormVisible] = useState(false);
  const [propertyYearBuilt, setPropertyYearBuilt] = useState('');
  const [propertySqft, setPropertySqft] = useState('');
  const [savingProperty, setSavingProperty] = useState(false);

  // Unified creation sheet — address resolved async on map tap
  const [pendingAddress, setPendingAddress] = useState<string | undefined>(undefined);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [pickerTab, setPickerTab] = useState<'knock' | 'contact'>('knock');

  // Knock session tracking (micro-cycle: open → close)
  const activeSessionIdRef = useRef<string | null>(null);       // server session id, used by /close
  const openInFlightRef = useRef<Promise<void> | null>(null);   // pending /open so /close can await its id
  const doorLockRef = useRef(false);                            // LOCAL synchronous lock — gates the map (Z₂)

  // "Opened?" gate — shown between map tap and label picker
  const [hardOpenVisible, setHardOpenVisible] = useState(false);
  const [gateOpened, setGateOpened] = useState<'yes' | 'no' | null>(null); // drives label filter + tab visibility

  // Current user's team role — drives role-scoped labels + lead action menu.
  const [role, setRole] = useState<'owner' | 'member' | null>(null);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    initializeApp();
    return () => { HailAlertService.stopMonitoring(); };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadKnocks();
      loadHailData();
      if ((global as any).openNotificationLog) {
        setShowNotificationLog(true);
        (global as any).openNotificationLog = false;
      }
      const pendingDate = (global as any).pendingSwathDate;
      if (pendingDate) {
        (global as any).pendingSwathDate = null;
        autoLoadSwathDate(pendingDate);
      }

      const pendingInspection = (global as any).pendingLiveInspectionLocation;
      if (pendingInspection) {
        (global as any).pendingLiveInspectionLocation = null;
        mapRef.current?.centerOnLocation(pendingInspection.lat, pendingInspection.lng, 0.005);
      }

      // Teleport from the Lead Log — center on the tapped lead's door.
      const pendingLead = (global as any).pendingLeadLocation;
      if (pendingLead) {
        (global as any).pendingLeadLocation = null;
        mapRef.current?.centerOnLocation(pendingLead.lat, pendingLead.lng, 0.005);
      }
    });
    return unsubscribe;
  }, [navigation]);

  const autoLoadSwathDate = async (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const reports = await IEMArchiveService.fetchHistoricalStorm(date);
      if (reports.length === 0) return;
      const storm = await MRMSService.groupIntoStormEvents(reports);
      storm.name = `OKC Metro - ${String(month).padStart(2,'0')}/${String(day).padStart(2,'0')}/${year}`;
      await MRMSService.saveStormEvent(storm);
      await loadHailData();
    } catch (err) {
      console.warn('[Map] autoLoadSwathDate failed:', err);
    }
  };

  const initializeApp = async () => {
    await SupabaseService.initialize();
    const hasPermission = await LocationService.requestPermissions();
    if (hasPermission) {
      await updateLocation();
    } else {
      setUserLocation({ lat: 35.4676, lng: -97.5164 });
    }
    await Promise.all([loadKnocks(), loadHailData(), initializeHailAlerts()]);
    SupabaseService.getRole().then(setRole);
  };

  const updateLocation = async () => {
    const loc = await LocationService.getCurrentLocation();
    if (loc) {
      setUserLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    }
  };

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadKnocks = async () => {
    try {
      const data = await SupabaseService.getKnocks();
      setKnocks(data);
      // Sync any offline queue in background
      SupabaseService.syncOfflineQueue();
    } catch (err) {
      console.error('[Map] loadKnocks error:', err);
    }
  };

  const loadHailData = async () => {
    try {
      const storms = await MRMSService.getActiveStorms();
      setActiveStorms(storms);
      const all: HailReport[] = [];
      const verified: HailReport[] = [];
      storms.forEach(storm => {
        if (storm.enabled) {
          all.push(...storm.reports);
          verified.push(...storm.reports.filter((r: HailReport) => r.groundTruth));
        }
      });
      setHailReports(all);
      setVerifiedReports(verified);
    } catch (err) {
      console.error('[Map] loadHailData error:', err);
    }
  };

  const initializeHailAlerts = async () => {
    try {
      await HailAlertService.initialize();
      await HailAlertService.startMonitoring(5);
    } catch (err) {
      console.error('[Map] HailAlert init error:', err);
    }
  };

  // ── Knock session helpers (micro-cycle) ───────────────────────────────────

  // Records the server-side session (audit trail + future cycle-time analytics).
  // The UI lock does NOT depend on this — see doorLockRef. `opened` is the
  // Yes/No answer from the gate, stored explicitly for later analytics.
  const openKnockSession = (lat: number, lng: number, opened: boolean) => {
    activeSessionIdRef.current = null;
    openInFlightRef.current = (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const res = await fetch('https://d2d-sales-tracker-tau.vercel.app/api/knocks/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, teamId: SupabaseService.getTeamId(), lat, lng, opened }),
        });
        if (res.ok) {
          const { sessionId } = await res.json();
          activeSessionIdRef.current = sessionId;
        }
      } catch (err) {
        console.warn('[Session] Failed to open knock session:', err);
      }
    })();
  };

  const closeKnockSession = async (knockId?: string, outcomeLabel?: string) => {
    // Wait for the in-flight /open so we have a session id to close.
    if (openInFlightRef.current) {
      try { await openInFlightRef.current; } catch {}
      openInFlightRef.current = null;
    }
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    activeSessionIdRef.current = null;
    try {
      await fetch('https://d2d-sales-tracker-tau.vercel.app/api/knocks/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, knockId, outcomeLabel }),
      });
    } catch (err) {
      console.warn('[Session] Failed to close knock session:', err);
    }
  };

  // ── Map interactions ──────────────────────────────────────────────────────

  const handleMapPress = (lat: number, lng: number) => {
    if (suppressNextMapPress.current) {
      suppressNextMapPress.current = false;
      return;
    }
    // A door is already open — the gate/picker modal is the lock; ignore stray taps.
    if (doorLockRef.current) return;
    doorLockRef.current = true; // engage lock SYNCHRONOUSLY, before any await or network call
    setPendingCoords({ lat, lng });
    setPendingKnock(null);
    setGateOpened(null);
    setPickerNotes('');
    setSelectedLabel(null);
    setContactName(''); setContactPhone(''); setContactInsurance('');
    setPropertyYearBuilt(''); setPropertySqft('');
    setPingOwnerSent(false);
    setPendingAddress(undefined);
    setPickerTab('knock');
    setHardOpenVisible(true);  // "Opened?" gate — session is created only on Yes/No
    // Geocode immediately so address is ready by the time the user picks a label
    setGeocodingAddress(true);
    LocationService.reverseGeocode(lat, lng)
      .then(addr => setPendingAddress(addr))
      .catch(() => {})
      .finally(() => setGeocodingAddress(false));
  };

  const handleKnockPress = async (knock: Knock) => {
    if (doorLockRef.current) return; // a door is open — finish labeling it first
    suppressNextMapPress.current = true;
    // Open detail sheet — lazy-load history + contacts in parallel
    setDetailKnock(knock);
    setDetailHistory([]);
    setDetailContacts([]);
    setContactFormVisible(false);
    setDetailVisible(true);
    setDetailLoading(true);
    const [history, contacts] = await Promise.all([
      SupabaseService.getKnockHistory(knock.id),
      SupabaseService.getContactsForKnock(knock.id),
    ]);
    setDetailHistory(history ?? []);
    setDetailContacts(contacts);
    // Pre-fill contact form
    const c = contacts[0];
    setContactName(c?.name ?? '');
    setContactPhone(c?.phone ?? '');
    setContactInsurance(c?.insurance_carrier ?? '');
    // Pre-fill property form
    setPropertyYearBuilt(knock.year_built ? String(knock.year_built) : '');
    setPropertySqft(knock.sqft ? String(knock.sqft) : '');
    setPropertyFormVisible(false);
    setDetailLoading(false);
  };

  // Ping starts the live-inspection lifecycle for a SAVED lead (status → pinged).
  // After this the setter is locked out of the lab until the lead is retted —
  // the server rejects further setter actions, so the detail sheet hides Re-label.
  const handlePingLead = async (knockId: string) => {
    setPingOwnerLoading(true);
    try {
      const res = await SupabaseService.transitionLead(knockId, 'ping');
      if (res.ok) {
        setPingOwnerSent(true);
        await loadKnocks();
      } else {
        Alert.alert('Ping failed', res.error || 'Could not start live inspection');
      }
    } catch {
      Alert.alert('Ping failed', 'Network error — try again');
    } finally {
      setPingOwnerLoading(false);
    }
  };

  // Create-flow ping: save the door as a lead (+ contact), then ping in one tap.
  const handleSaveAndPing = async () => {
    if (!pendingCoords) return;
    setPingOwnerLoading(true);
    try {
      const savedKnock = await SupabaseService.saveKnock({
        latitude: pendingCoords.lat,
        longitude: pendingCoords.lng,
        address: pendingAddress,
        label: 'lead',
        notes: pickerNotes || undefined,
        knocked_at: new Date(),
        user_id: SupabaseService.getUserId() ?? undefined,
      });
      if (contactName || contactPhone || contactInsurance) {
        await SupabaseService.upsertContact(savedKnock.id, {
          name: contactName || undefined,
          phone: contactPhone || undefined,
          insurance_carrier: contactInsurance || undefined,
        });
      }
      const res = await SupabaseService.transitionLead(savedKnock.id, 'ping');
      if (!res.ok) {
        Alert.alert('Ping failed', res.error || 'Could not start live inspection');
        return;
      }
      // Door is now a live lead — close the F1 session, release lock, reset sheet.
      closeKnockSession(savedKnock.id, 'lead');
      doorLockRef.current = false; // release the map lock so the setter can keep knocking
      setHardOpenVisible(false);
      setGateOpened(null);
      setPickerVisible(false);
      setSelectedLabel(null);
      setPickerNotes('');
      setContactName(''); setContactPhone(''); setContactInsurance('');
      setPropertyYearBuilt(''); setPropertySqft('');
      setPingOwnerSent(false);
      await loadKnocks();
    } catch (err) {
      Alert.alert('Ping failed', 'Could not save & ping. Check your connection.');
      console.error('[Map] saveAndPing error:', err);
    } finally {
      setPingOwnerLoading(false);
    }
  };

  const handleSaveContact = async () => {
    if (!detailKnock) return;
    setSavingContact(true);
    try {
      await SupabaseService.upsertContact(detailKnock.id, {
        name: contactName || undefined,
        phone: contactPhone || undefined,
        insurance_carrier: contactInsurance || undefined,
      });
      // Refresh contacts display
      const contacts = await SupabaseService.getContactsForKnock(detailKnock.id);
      setDetailContacts(contacts);
      setContactFormVisible(false);
    } catch (err) {
      Alert.alert('Error', 'Failed to save contact info.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleAddressPress = (address: string) => {
    const encoded = encodeURIComponent(address);
    Alert.alert(address, undefined, [
      { text: 'Share / Copy', onPress: () => Share.share({ message: address }) },
      { text: 'Open on Redfin', onPress: () => Linking.openURL(`https://www.redfin.com/search#query=${encoded}`) },
      { text: 'Open on Zillow', onPress: () => Linking.openURL(`https://www.zillow.com/homes/${encoded}_rb/`) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSaveProperty = async () => {
    if (!detailKnock) return;
    setSavingProperty(true);
    try {
      const year = propertyYearBuilt ? parseInt(propertyYearBuilt, 10) : undefined;
      const sq = propertySqft ? parseInt(propertySqft, 10) : undefined;
      await SupabaseService.updateKnockProperty(detailKnock.id, {
        year_built: year,
        sqft: sq,
      });
      // Reflect in local knocks list
      setKnocks(prev => prev.map(k =>
        k.id === detailKnock.id ? { ...k, year_built: year, sqft: sq } : k
      ));
      setPropertyFormVisible(false);
    } catch {
      Alert.alert('Error', 'Failed to save property details.');
    } finally {
      setSavingProperty(false);
    }
  };

  const handleDeleteKnock = () => {
    if (!detailKnock) return;
    Alert.alert(
      'Delete Knock',
      'This will permanently delete this knock and all its history. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await SupabaseService.deleteKnock(detailKnock.id);
              setKnocks(prev => prev.filter(k => k.id !== detailKnock.id));
              setDetailVisible(false);
            } catch {
              Alert.alert('Error', 'Failed to delete knock.');
            }
          },
        },
      ]
    );
  };

  const handleRelabel = () => {
    if (!detailKnock) return;
    setDetailVisible(false);
    setTimeout(() => {
      setPendingKnock(detailKnock);
      setPendingCoords({ lat: detailKnock.latitude, lng: detailKnock.longitude });
      setPickerNotes(detailKnock.notes ?? '');
      setSelectedLabel(detailKnock.label);
      // Pre-fill address — no need to re-geocode
      setPendingAddress(detailKnock.address);
      setGeocodingAddress(false);
      setPickerTab('knock');
      // Pre-fill contact fields from loaded contacts
      const c = detailContacts[0];
      setContactName(c?.name ?? '');
      setContactPhone(c?.phone ?? '');
      setContactInsurance(c?.insurance_carrier ?? '');
      // Pre-fill property fields
      setPropertyYearBuilt(detailKnock.year_built ? String(detailKnock.year_built) : '');
      setPropertySqft(detailKnock.sqft ? String(detailKnock.sqft) : '');
      setPickerVisible(true);
    }, 300);
  };

  // ── Label picker ──────────────────────────────────────────────────────────

  const handleLabelTap = (label: KnockOutcome) => {
    setSelectedLabel(label); // just highlights — does not save
  };

  const handleSaveKnock = async () => {
    if (!pendingCoords || !selectedLabel) return;
    setSavingKnock(true);

    try {
      let savedKnockId: string | undefined;

      if (pendingKnock) {
        // Re-label existing knock
        savedKnockId = pendingKnock.id;
        await SupabaseService.updateKnockLabel(
          pendingKnock.id, pendingKnock.label, selectedLabel, pickerNotes || undefined
        );
        if (contactName || contactPhone || contactInsurance) {
          await SupabaseService.upsertContact(pendingKnock.id, {
            name: contactName || undefined,
            phone: contactPhone || undefined,
            insurance_carrier: contactInsurance || undefined,
          });
        }
        if (propertyYearBuilt || propertySqft) {
          await SupabaseService.updateKnockProperty(pendingKnock.id, {
            year_built: propertyYearBuilt ? parseInt(propertyYearBuilt, 10) : undefined,
            sqft: propertySqft ? parseInt(propertySqft, 10) : undefined,
          });
        }
      } else {
        // New knock — address already resolved from handleMapPress
        const savedKnock = await SupabaseService.saveKnock({
          latitude: pendingCoords.lat,
          longitude: pendingCoords.lng,
          address: pendingAddress,
          label: selectedLabel,
          notes: pickerNotes || undefined,
          knocked_at: new Date(),
          user_id: SupabaseService.getUserId() ?? undefined,
        });
        savedKnockId = savedKnock.id;
        if (contactName || contactPhone || contactInsurance) {
          await SupabaseService.upsertContact(savedKnock.id, {
            name: contactName || undefined,
            phone: contactPhone || undefined,
            insurance_carrier: contactInsurance || undefined,
          });
        }
        if (propertyYearBuilt || propertySqft) {
          await SupabaseService.updateKnockProperty(savedKnock.id, {
            year_built: propertyYearBuilt ? parseInt(propertyYearBuilt, 10) : undefined,
            sqft: propertySqft ? parseInt(propertySqft, 10) : undefined,
          });
        }
      }

      // Close knock session (non-blocking) — only releases on a successful save,
      // so a failed save keeps the door open and the picker up for retry.
      closeKnockSession(savedKnockId, selectedLabel);

      doorLockRef.current = false; // release the map lock
      setGateOpened(null);
      setHardOpenVisible(false);
      setPickerVisible(false);
      setSelectedLabel(null);
      setPickerNotes('');
      setContactName(''); setContactPhone(''); setContactInsurance('');
      setPropertyYearBuilt(''); setPropertySqft('');
      setPingOwnerSent(false);
      await loadKnocks();
    } catch (err) {
      Alert.alert('Error', 'Failed to save knock. Check your connection.');
      console.error('[Map] saveKnock error:', err);
    } finally {
      setSavingKnock(false);
    }
  };

  // ── Storm handlers ────────────────────────────────────────────────────────

  const handleStormToggle = async (stormId: string, enabled: boolean) => {
    await MRMSService.toggleStorm(stormId, enabled);
    await loadHailData();
  };

  const handleStormDelete = async (stormId: string) => {
    await MRMSService.deleteStorm(stormId);
    await loadHailData();
  };

  const handleStormFocus = async (stormId: string) => {
    await loadHailData();
    const storms = await MRMSService.getActiveStorms();
    const storm = storms.find((s: any) => s.id === stormId && s.enabled);
    if (storm?.bounds) {
      mapRef.current?.fitToBounds(
        storm.bounds.north, storm.bounds.south,
        storm.bounds.east, storm.bounds.west
      );
    }
  };

  const handleAddressSelect = (_address: string, lat: number, lng: number) => {
    mapRef.current?.centerOnLocation(lat, lng, 0.005);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const signedCount = knocks.filter(k => k.label === 'signed').length;
  const leadCount = knocks.filter(k => k.label === 'lead').length;

  return (
    <View style={styles.container}>
      <NativeMap
        ref={mapRef}
        knocks={knocks}
        hailReports={hailReports}
        verifiedReports={verifiedReports}
        userLocation={userLocation}
        mapType={mapType}
        onMapPress={handleMapPress}
        onKnockPress={handleKnockPress}
      />

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{knocks.length}</Text>
          <Text style={styles.statLabel}>Total Knocks</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{signedCount}</Text>
          <Text style={styles.statLabel}>Signed</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{leadCount}</Text>
          <Text style={styles.statLabel}>Leads</Text>
        </View>
      </View>

      {/* Address search */}
      <AddressSearchBar onAddressSelect={handleAddressSelect} />

      {/* Right buttons */}
      <View style={styles.rightButtonStack}>
        <TouchableOpacity style={styles.actionButton} onPress={() => setShowNotificationLog(!showNotificationLog)}>
          <Ionicons name="notifications" size={24} color="#FF6B6B" />
        </TouchableOpacity>
        {hailReports.length > 0 && (
          <TouchableOpacity style={styles.actionButton} onPress={() => mapRef.current?.focusOnHail(hailReports.filter(r => !r.groundTruth))}>
            <Ionicons name="thunderstorm" size={24} color="#ef4444" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionButton} onPress={() => setShowStormPanel(!showStormPanel)}>
          <Ionicons name="cloud" size={24} color="#1e40af" />
          {activeStorms.filter((s: any) => s.enabled).length > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeStorms.filter((s: any) => s.enabled).length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('StormSearch')}>
          <Ionicons name="search" size={24} color="#1e40af" />
        </TouchableOpacity>
      </View>

      {/* Left buttons */}
      <View style={styles.leftButtonStack}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => setMapType(t => t === 'standard' ? 'hybrid' : 'standard')}
        >
          <Text style={{ fontSize: 24 }}>{mapType === 'standard' ? '🗺️' : '🛰️'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={loadKnocks}>
          <Ionicons name="refresh" size={24} color="#1e40af" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          disabled={locating}
          onPress={async () => {
            setLocating(true);
            try {
              // Center on the FRESHLY fetched coords — not the userLocation state,
              // which is the stale closure value from the last render (centered
              // one tap behind / no-op when null).
              const loc = await LocationService.getCurrentLocation();
              if (loc) {
                const lat = loc.coords.latitude;
                const lng = loc.coords.longitude;
                setUserLocation({ lat, lng });
                mapRef.current?.centerOnLocation(lat, lng, 0.01);
              }
            } finally {
              setLocating(false);
            }
          }}
        >
          {locating
            ? <ActivityIndicator size="small" color="#1e40af" />
            : <Ionicons name="locate" size={24} color="#1e40af" />}
        </TouchableOpacity>
      </View>

      {/* Storm panel */}
      {showStormPanel && (
        <HailOverlay
          onStormToggle={handleStormToggle}
          onStormDelete={handleStormDelete}
          onStormFocus={handleStormFocus}
          onClose={() => setShowStormPanel(false)}
          dataSource={activeStorms.length > 0 ? activeStorms[0].source : undefined}
        />
      )}

      <NotificationLogPanel
        visible={showNotificationLog}
        onClose={() => setShowNotificationLog(false)}
        onCreateOverlay={() => { loadHailData(); setShowNotificationLog(false); }}
      />

      {/* ── "Opened?" Gate ──────────────────────────────────────────────── */}
      <Modal
        visible={hardOpenVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { /* non-dismissable — must choose Yes / No / Wrong door */ }}
      >
        <View style={styles.modalBackdrop}>
          {/* Inert backdrop — no dismiss; the gate must be answered */}
          <View style={styles.modalDismiss} />
          <View style={styles.hardOpenSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.hardOpenAddress} numberOfLines={2}>
              📍 {pendingAddress ?? (pendingCoords ? `${pendingCoords.lat.toFixed(4)}, ${pendingCoords.lng.toFixed(4)}` : '...')}
            </Text>
            <Text style={styles.hardOpenQuestion}>Opened?</Text>
            <TouchableOpacity
              style={styles.hardOpenYes}
              onPress={() => {
                setGateOpened('yes');
                if (pendingCoords) openKnockSession(pendingCoords.lat, pendingCoords.lng, true);
                setPickerTab('knock');
                setHardOpenVisible(false);
                setPickerVisible(true);
              }}
            >
              <Text style={styles.hardOpenYesText}>Yes — door opened</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hardOpenMaybe}
              onPress={() => {
                setGateOpened('no');
                if (pendingCoords) openKnockSession(pendingCoords.lat, pendingCoords.lng, false);
                setPickerTab('knock');
                setHardOpenVisible(false);
                setPickerVisible(true);
              }}
            >
              <Text style={styles.hardOpenMaybeText}>No — didn't open</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hardOpenNo}
              onPress={() => {
                // Wrong door / mis-tap — release the lock, no session created.
                doorLockRef.current = false;
                setGateOpened(null);
                setPendingCoords(null);
                setHardOpenVisible(false);
              }}
            >
              <Text style={styles.hardOpenNoText}>Wrong door</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Knock Sheet (create + update) ───────────────────────────────── */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { if (pendingKnock) setPickerVisible(false); }} // gated new doors are non-dismissable
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* New (gated) doors: inert backdrop — must label to exit. Relabel: tap-away dismisses. */}
          {pendingKnock ? (
            <TouchableOpacity style={styles.modalDismiss} onPress={() => setPickerVisible(false)} />
          ) : (
            <View style={styles.modalDismiss} />
          )}

          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />

            {/* Address row — always visible above tabs */}
            {geocodingAddress ? (
              <Text style={styles.pickerAddressLoading}>Getting address…</Text>
            ) : pendingAddress ? (
              <TouchableOpacity onPress={() => handleAddressPress(pendingAddress)}>
                <Text style={styles.pickerAddressLink}>📍  {pendingAddress}</Text>
              </TouchableOpacity>
            ) : pendingCoords ? (
              <Text style={styles.pickerAddressLoading}>
                📍  {pendingCoords.lat.toFixed(5)}, {pendingCoords.lng.toFixed(5)}
              </Text>
            ) : null}

            {/* Segmented control — Contact tab hidden when the door didn't open (no one to capture) */}
            {gateOpened !== 'no' && (
              <View style={styles.pickerTabBar}>
                <TouchableOpacity
                  style={[styles.pickerTabBtn, pickerTab === 'knock' && styles.pickerTabBtnActive]}
                  onPress={() => setPickerTab('knock')}
                >
                  <Text style={[styles.pickerTabText, pickerTab === 'knock' && styles.pickerTabTextActive]}>
                    🏠  Knock
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pickerTabBtn, pickerTab === 'contact' && styles.pickerTabBtnActive]}
                  onPress={() => setPickerTab('contact')}
                >
                  <Text style={[styles.pickerTabText, pickerTab === 'contact' && styles.pickerTabTextActive]}>
                    👤  Contact
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Scrollable tab content */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.pickerTabContent}
            >
              {pickerTab === 'knock' ? (
                <>
                  {pendingKnock && (
                    <Text style={styles.pickerCurrent}>
                      Current: {KNOCK_OUTCOME_EMOJI[pendingKnock.label]} {KNOCK_OUTCOME_LABEL[pendingKnock.label]}
                    </Text>
                  )}

                  <View style={styles.labelGrid}>
                    {(pendingKnock
                      ? labsForRole(role)                        // relabel: role-scoped labels
                      : gateOpened === 'no'
                        ? NOT_OPENED_LABELS                      // didn't open (all setter-allowed)
                        : OPENED_LABELS.filter(l => labsForRole(role).includes(l)) // opened, role-scoped
                    ).map(label => (
                      <TouchableOpacity
                        key={label}
                        style={[
                          styles.labelButton,
                          selectedLabel === label && styles.labelButtonSelected,
                        ]}
                        onPress={() => handleLabelTap(label)}
                        disabled={savingKnock}
                      >
                        <Text style={styles.labelEmoji}>{KNOCK_OUTCOME_EMOJI[label]}</Text>
                        <Text style={[
                          styles.labelText,
                          selectedLabel === label && styles.labelTextSelected,
                        ]}>
                          {KNOCK_OUTCOME_LABEL[label]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TextInput
                    style={[styles.notesInput, { marginBottom: 8 }]}
                    placeholder="Add a note (optional)"
                    placeholderTextColor="#9ca3af"
                    value={pickerNotes}
                    onChangeText={setPickerNotes}
                    multiline
                    numberOfLines={2}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.pickerSectionTitle}>HOMEOWNER INFO</Text>
                  <TextInput
                    style={styles.contactInput}
                    placeholder="Name"
                    placeholderTextColor="#9ca3af"
                    value={contactName}
                    onChangeText={setContactName}
                    autoCapitalize="words"
                  />
                  <TextInput
                    style={styles.contactInput}
                    placeholder="Phone"
                    placeholderTextColor="#9ca3af"
                    value={contactPhone}
                    onChangeText={setContactPhone}
                    keyboardType="phone-pad"
                  />
                  <TouchableOpacity
                    style={[
                      styles.pingOwnerButton,
                      (!contactName.trim() || !contactPhone.trim() || pingOwnerSent) && styles.pingOwnerButtonDisabled,
                    ]}
                    onPress={handleSaveAndPing}
                    disabled={!contactName.trim() || !contactPhone.trim() || pingOwnerLoading || pingOwnerSent}
                  >
                    {pingOwnerLoading
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={styles.pingOwnerButtonText}>
                          {pingOwnerSent ? '✓ Owner Pinged' : '🔔 Ping Owner — Live Inspection'}
                        </Text>
                    }
                  </TouchableOpacity>
                  <TextInput
                    style={styles.contactInput}
                    placeholder="Insurance Carrier"
                    placeholderTextColor="#9ca3af"
                    value={contactInsurance}
                    onChangeText={setContactInsurance}
                    autoCapitalize="words"
                  />

                  <Text style={[styles.pickerSectionTitle, { marginTop: 8 }]}>PROPERTY DETAILS</Text>
                  <TextInput
                    style={styles.contactInput}
                    placeholder="Year Built (e.g. 1994)"
                    placeholderTextColor="#9ca3af"
                    value={propertyYearBuilt}
                    onChangeText={setPropertyYearBuilt}
                    keyboardType="number-pad"
                  />
                  <TextInput
                    style={[styles.contactInput, { marginBottom: 8 }]}
                    placeholder="Square Footage (e.g. 1840)"
                    placeholderTextColor="#9ca3af"
                    value={propertySqft}
                    onChangeText={setPropertySqft}
                    keyboardType="number-pad"
                  />
                </>
              )}
            </ScrollView>

            {/* Save + Cancel — pinned outside scroll, always visible */}
            <TouchableOpacity
              style={[
                styles.saveButton,
                (!selectedLabel || savingKnock) && styles.saveButtonDisabled,
              ]}
              onPress={handleSaveKnock}
              disabled={!selectedLabel || savingKnock}
            >
              {savingKnock
                ? <ActivityIndicator color="white" />
                : <Text style={styles.saveButtonText}>Save Knock</Text>
              }
            </TouchableOpacity>

            {/* Cancel only when relabeling. A gated new door must end in a label —
                the misfire escape is the gate's "Wrong door" (pre-commit). */}
            {pendingKnock && (
              <TouchableOpacity
                style={[styles.closeButton, { marginBottom: 8 }]}
                onPress={() => {
                  setPickerVisible(false);
                  setSelectedLabel(null);
                  setPickerNotes('');
                }}
              >
                <Text style={styles.closeButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Knock Detail Sheet ───────────────────────────────────────────── */}
      <Modal
        visible={detailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity style={styles.modalDismiss} onPress={() => setDetailVisible(false)} />

          <View style={styles.detailSheet}>
            <View style={styles.pickerHandle} />

            {detailKnock && (
              <>
                {/* Header: emoji + label + address */}
                <View style={styles.detailLabelRow}>
                  <Text style={styles.detailEmoji}>
                    {KNOCK_OUTCOME_EMOJI[detailKnock.label]}
                  </Text>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.detailLabelName}>
                      {KNOCK_OUTCOME_LABEL[detailKnock.label]}
                    </Text>
                    {detailKnock.address ? (
                    <TouchableOpacity onPress={() => handleAddressPress(detailKnock.address!)}>
                      <Text style={styles.detailAddressLink} numberOfLines={1}>
                        {detailKnock.address}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.detailAddress} numberOfLines={1}>
                      {`${detailKnock.latitude.toFixed(5)}, ${detailKnock.longitude.toFixed(5)}`}
                    </Text>
                  )}
                  </View>
                </View>

                {/* Meta: timestamp + storm date */}
                <View style={styles.detailMetaRow}>
                  <Text style={styles.detailMeta}>
                    {formatDate(detailKnock.knocked_at)}
                  </Text>
                  {detailKnock.storm_date && (
                    <Text style={styles.detailMetaBadge}>
                      Storm: {detailKnock.storm_date}
                    </Text>
                  )}
                </View>

                {/* Notes */}
                {detailKnock.notes ? (
                  <View style={styles.detailNotesBox}>
                    <Text style={styles.detailNotesText}>{detailKnock.notes}</Text>
                  </View>
                ) : null}

                {/* Homeowner Info */}
                <View style={styles.contactSection}>
                  <Text style={styles.historySectionTitle}>Homeowner Info</Text>

                  {!contactFormVisible ? (
                    // Display mode
                    detailContacts.length > 0 && (detailContacts[0].name || detailContacts[0].phone || detailContacts[0].insurance_carrier) ? (
                      <View style={styles.contactDisplay}>
                        {detailContacts[0].name ? (
                          <Text style={styles.contactDisplayRow}>👤  {detailContacts[0].name}</Text>
                        ) : null}
                        {detailContacts[0].phone ? (
                          <Text style={styles.contactDisplayRow}>📞  {detailContacts[0].phone}</Text>
                        ) : null}
                        {detailContacts[0].insurance_carrier ? (
                          <Text style={styles.contactDisplayRow}>🏢  {detailContacts[0].insurance_carrier}</Text>
                        ) : null}
                        <TouchableOpacity onPress={() => setContactFormVisible(true)}>
                          <Text style={styles.contactEditLink}>Edit</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.addContactButton} onPress={() => setContactFormVisible(true)}>
                        <Text style={styles.addContactButtonText}>+ Add Contact Info</Text>
                      </TouchableOpacity>
                    )
                  ) : (
                    // Edit mode
                    <View>
                      <TextInput
                        style={styles.contactInput}
                        placeholder="Homeowner Name"
                        placeholderTextColor="#9ca3af"
                        value={contactName}
                        onChangeText={setContactName}
                        autoCapitalize="words"
                      />
                      <TextInput
                        style={styles.contactInput}
                        placeholder="Phone Number"
                        placeholderTextColor="#9ca3af"
                        value={contactPhone}
                        onChangeText={setContactPhone}
                        keyboardType="phone-pad"
                      />
                      <TouchableOpacity
                        style={[
                          styles.pingOwnerButton,
                          (!contactPhone.trim() || pingOwnerSent) && styles.pingOwnerButtonDisabled,
                        ]}
                        onPress={() => { if (detailKnock) handlePingLead(detailKnock.id); }}
                        disabled={!contactName.trim() || !contactPhone.trim() || pingOwnerLoading || pingOwnerSent}
                      >
                        {pingOwnerLoading
                          ? <ActivityIndicator color="white" size="small" />
                          : <Text style={styles.pingOwnerButtonText}>
                              {pingOwnerSent ? '✓ Owner Pinged' : '🔔 Ping Owner — Live Inspection'}
                            </Text>
                        }
                      </TouchableOpacity>
                      <TextInput
                        style={styles.contactInput}
                        placeholder="Insurance Carrier"
                        placeholderTextColor="#9ca3af"
                        value={contactInsurance}
                        onChangeText={setContactInsurance}
                        autoCapitalize="words"
                      />
                      <View style={styles.contactFormActions}>
                        <TouchableOpacity
                          style={styles.contactSaveButton}
                          onPress={handleSaveContact}
                          disabled={savingContact}
                        >
                          {savingContact
                            ? <ActivityIndicator color="white" size="small" />
                            : <Text style={styles.contactSaveButtonText}>Save</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setContactFormVisible(false)}>
                          <Text style={styles.contactCancelText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                {/* History */}
                {detailLoading ? (
                  <ActivityIndicator style={{ marginVertical: 16 }} color="#1e40af" />
                ) : detailHistory && detailHistory.length > 0 ? (
                  <View style={styles.historySection}>
                    <Text style={styles.historySectionTitle}>Label History</Text>
                    <ScrollView style={{ maxHeight: 160 }}>
                      {detailHistory.map((entry, i) => (
                        <View key={i} style={styles.detailHistoryRow}>
                          <Text style={styles.detailHistoryChange}>
                            {KNOCK_OUTCOME_EMOJI[entry.previous_label]} {KNOCK_OUTCOME_LABEL[entry.previous_label]}
                            {'  →  '}
                            {KNOCK_OUTCOME_EMOJI[entry.new_label]} {KNOCK_OUTCOME_LABEL[entry.new_label]}
                          </Text>
                          <Text style={styles.detailHistoryDate}>
                            {formatDate(entry.changed_at)}
                          </Text>
                          {entry.notes ? (
                            <Text style={styles.detailHistoryNotes}>{entry.notes}</Text>
                          ) : null}
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* Property Details */}
                <View style={styles.contactSection}>
                  <Text style={styles.historySectionTitle}>Property Details</Text>
                  {!propertyFormVisible ? (
                    detailKnock.year_built || detailKnock.sqft ? (
                      <View style={styles.contactDisplay}>
                        <Text style={styles.contactDisplayRow}>
                          {[
                            detailKnock.year_built ? `📅 Built: ${detailKnock.year_built}` : null,
                            detailKnock.sqft ? `📐 ${detailKnock.sqft.toLocaleString()} sqft` : null,
                          ].filter(Boolean).join('   ·   ')}
                        </Text>
                        <TouchableOpacity onPress={() => setPropertyFormVisible(true)}>
                          <Text style={styles.contactEditLink}>Edit</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.addContactButton} onPress={() => setPropertyFormVisible(true)}>
                        <Text style={styles.addContactButtonText}>+ Add Property Details</Text>
                      </TouchableOpacity>
                    )
                  ) : (
                    <View>
                      <TextInput
                        style={styles.contactInput}
                        placeholder="Year Built (e.g. 1994)"
                        placeholderTextColor="#9ca3af"
                        value={propertyYearBuilt}
                        onChangeText={setPropertyYearBuilt}
                        keyboardType="number-pad"
                      />
                      <TextInput
                        style={styles.contactInput}
                        placeholder="Square Footage (e.g. 1840)"
                        placeholderTextColor="#9ca3af"
                        value={propertySqft}
                        onChangeText={setPropertySqft}
                        keyboardType="number-pad"
                      />
                      <View style={styles.contactFormActions}>
                        <TouchableOpacity
                          style={styles.contactSaveButton}
                          onPress={handleSaveProperty}
                          disabled={savingProperty}
                        >
                          {savingProperty
                            ? <ActivityIndicator color="white" size="small" />
                            : <Text style={styles.contactSaveButtonText}>Save</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setPropertyFormVisible(false)}>
                          <Text style={styles.contactCancelText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                {/* Lifecycle status + role-legal actions (in-flight leads) */}
                {detailKnock.status && (
                  <View style={styles.leadStatusBox}>
                    <View style={[styles.leadPill, { backgroundColor: STATUS_COLOR[detailKnock.status as LeadStatus] }]}>
                      <Text style={styles.leadPillText}>{STATUS_LABEL[detailKnock.status as LeadStatus]}</Text>
                    </View>
                    <LeadActionMenu
                      knockId={detailKnock.id}
                      status={detailKnock.status as LeadStatus}
                      role={role}
                      onTransitioned={async () => { setDetailVisible(false); await loadKnocks(); }}
                    />
                  </View>
                )}

                {/* Actions — Re-label only when NOT in an active lifecycle */}
                {!detailKnock.status && (
                  <TouchableOpacity style={styles.relabelButton} onPress={handleRelabel}>
                    <Text style={styles.relabelButtonText}>Re-label</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.followUpButton}
                  onPress={() => Alert.alert('Coming Soon', 'Appointment scheduling will be available in a future update.')}
                >
                  <Text style={styles.followUpButtonText}>📅  Schedule Follow-up</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeButton} onPress={() => setDetailVisible(false)}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteKnockButton} onPress={handleDeleteKnock}>
                  <Text style={styles.deleteKnockButtonText}>Delete Knock</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsBar: {
    position: 'absolute', top: 10, left: 16, right: 16,
    backgroundColor: 'white', borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 3.84, elevation: 5,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#1e40af' },
  statLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: '#e5e7eb' },
  rightButtonStack: { position: 'absolute', right: 16, bottom: 80 },
  leftButtonStack: { position: 'absolute', left: 16, bottom: 80 },
  actionButton: {
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 30,
    width: 60, height: 60, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 3.84, elevation: 5, marginBottom: 10,
  },
  badge: {
    position: 'absolute', top: -5, right: -5,
    backgroundColor: '#ef4444', borderRadius: 10,
    minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'white',
  },
  badgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalDismiss: { flex: 1 },
  pickerSheet: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '78%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 10,
  },
  pickerHandle: {
    alignSelf: 'center', width: 40, height: 4,
    backgroundColor: '#d1d5db', borderRadius: 2, marginBottom: 12,
  },
  pickerTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  pickerCurrent: { fontSize: 14, color: '#6b7280', marginBottom: 10 },
  pickerAddress: { fontSize: 13, color: '#374151', marginBottom: 10 },
  pickerAddressLoading: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginBottom: 10 },
  pickerAddressLink: { fontSize: 13, color: '#1e40af', textDecorationLine: 'underline', marginBottom: 10 },
  pickerTabBar: {
    flexDirection: 'row', backgroundColor: '#f3f4f6',
    borderRadius: 10, padding: 3, marginBottom: 14,
  },
  pickerTabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  pickerTabBtnActive: {
    backgroundColor: 'white',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  pickerTabText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  pickerTabTextActive: { color: '#111827' },
  pickerTabContent: { flexGrow: 0 },
  pickerSectionTitle: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  labelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  labelButton: {
    width: '30%', backgroundColor: '#f9fafb', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  labelEmoji: { fontSize: 26, marginBottom: 4 },
  labelText: { fontSize: 11, color: '#374151', textAlign: 'center', fontWeight: '500' },
  labelButtonSelected: {
    backgroundColor: '#dbeafe', borderColor: '#1e40af', borderWidth: 2,
  },
  labelTextSelected: { color: '#1e40af', fontWeight: '700' },
  notesInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    padding: 12, fontSize: 14, color: '#111827',
    minHeight: 60, textAlignVertical: 'top', marginBottom: 16,
  },
  saveButton: {
    backgroundColor: '#1e40af', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center',
  },
  saveButtonDisabled: { backgroundColor: '#93c5fd' },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '700' },

  // Detail sheet
  detailSheet: {
    backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 10,
  },
  detailLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  detailEmoji: { fontSize: 40 },
  detailLabelName: { fontSize: 18, fontWeight: '700', color: '#111827' },
  detailAddress: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  detailAddressLink: { fontSize: 13, color: '#1e40af', marginTop: 2, textDecorationLine: 'underline' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  detailMeta: { fontSize: 13, color: '#6b7280' },
  detailMetaBadge: {
    fontSize: 12, color: '#1e40af', backgroundColor: '#dbeafe',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontWeight: '600',
  },
  detailNotesBox: {
    backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginBottom: 12,
  },
  detailNotesText: { fontSize: 14, color: '#374151' },
  historySection: { marginBottom: 16 },
  historySectionTitle: { fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailHistoryRow: {
    borderLeftWidth: 2, borderLeftColor: '#dbeafe',
    paddingLeft: 10, marginBottom: 10,
  },
  detailHistoryChange: { fontSize: 13, color: '#111827', fontWeight: '500' },
  detailHistoryDate: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  detailHistoryNotes: { fontSize: 12, color: '#6b7280', marginTop: 2, fontStyle: 'italic' },
  leadStatusBox: { marginBottom: 12 },
  leadPill: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 },
  leadPillText: { color: 'white', fontSize: 12, fontWeight: '700' },
  relabelButton: {
    borderWidth: 2, borderColor: '#1e40af', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 10,
  },
  relabelButtonText: { color: '#1e40af', fontSize: 16, fontWeight: '700' },
  closeButton: { alignItems: 'center', paddingVertical: 8 },
  closeButtonText: { color: '#9ca3af', fontSize: 15 },

  // Contact section
  contactSection: { marginBottom: 16 },
  contactDisplay: {
    backgroundColor: '#f9fafb', borderRadius: 10, padding: 12, marginTop: 6,
  },
  contactDisplayRow: { fontSize: 14, color: '#111827', marginBottom: 4 },
  contactEditLink: { fontSize: 13, color: '#1e40af', fontWeight: '600', marginTop: 4 },
  addContactButton: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, borderStyle: 'dashed',
    paddingVertical: 10, alignItems: 'center', marginTop: 6,
  },
  addContactButtonText: { color: '#6b7280', fontSize: 14 },
  contactInput: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8,
    padding: 10, fontSize: 14, color: '#111827',
    backgroundColor: '#f9fafb', marginBottom: 8,
  },
  contactFormActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  contactSaveButton: {
    backgroundColor: '#1e40af', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  contactSaveButtonText: { color: 'white', fontSize: 14, fontWeight: '700' },
  contactCancelText: { color: '#9ca3af', fontSize: 14 },

  // Follow-up stub
  followUpButton: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginBottom: 10,
  },
  followUpButtonText: { color: '#6b7280', fontSize: 15 },
  deleteKnockButton: { alignItems: 'center', paddingVertical: 8, marginTop: 4 },
  deleteKnockButtonText: { color: '#ef4444', fontSize: 14 },
  // Hard open gate
  hardOpenSheet: {
    backgroundColor: 'white', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingBottom: 40, paddingTop: 12, alignItems: 'center',
  },
  hardOpenAddress: {
    fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 20, marginTop: 4,
  },
  hardOpenQuestion: {
    fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 28,
  },
  hardOpenYes: {
    backgroundColor: '#1e40af', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', width: '100%', marginBottom: 12,
  },
  hardOpenYesText: { color: 'white', fontSize: 17, fontWeight: '700' },
  hardOpenMaybe: {
    backgroundColor: '#eff6ff', borderWidth: 2, borderColor: '#1e40af', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', width: '100%', marginBottom: 12,
  },
  hardOpenMaybeText: { color: '#1e40af', fontSize: 17, fontWeight: '700' },
  hardOpenNo: {
    paddingVertical: 12, alignItems: 'center', width: '100%',
  },
  hardOpenNoText: { color: '#9ca3af', fontSize: 15 },

  pingOwnerButton: {
    backgroundColor: '#1e40af', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
    marginBottom: 8,
  },
  pingOwnerButtonDisabled: { backgroundColor: '#93c5fd' },
  pingOwnerButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
});

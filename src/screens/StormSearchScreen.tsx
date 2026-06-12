import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { WeatherHistoryService, HistoricalStormEvent } from '../services/weatherHistoryService';
import { MRMSService } from '../services/mrmsService';
import { SupabaseService } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';

interface AvailableStorm {
  date: string;            // YYYY-MM-DD (Postgres DATE comes back as a string)
  point_count: number;
  max_size_inches: number;
}

function formatStormDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

export default function StormSearchScreen({ navigation }: any) {
  const [searchLocation, setSearchLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchResults, setSearchResults] = useState<HistoricalStormEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState<'location' | 'date' | 'recent'>('recent');

  // Available storm maps (live from hail_grid_dates) + owner process-storm flow
  const [availableStorms, setAvailableStorms] = useState<AvailableStorm[] | null>(null);
  const [availableError, setAvailableError] = useState(false);
  const [ownerRole, setOwnerRole] = useState(false);
  const [processDate, setProcessDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // default: yesterday (the common "missed storm" case)
    return d;
  });
  const [showProcessPicker, setShowProcessPicker] = useState(false);
  const [processing, setProcessing] = useState(false);

  const loadAvailableStorms = async () => {
    setAvailableError(false);
    setAvailableStorms(null);
    const { data, error } = await supabase
      .from('hail_grid_dates')
      .select('date, point_count, max_size_inches')
      .order('date', { ascending: false });
    if (error) {
      console.error('[StormSearch] hail_grid_dates:', error);
      setAvailableError(true);
      return;
    }
    setAvailableStorms((data ?? []) as AvailableStorm[]);
  };

  useEffect(() => {
    loadAvailableStorms();
    SupabaseService.isOwner().then(setOwnerRole).catch(() => setOwnerRole(false));
  }, []);

  const handleProcessStorm = () => {
    // Local-date ISO (toISOString would shift evening dates to tomorrow UTC)
    const y = processDate.getFullYear();
    const m = String(processDate.getMonth() + 1).padStart(2, '0');
    const d = String(processDate.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    Alert.alert(
      'Process Storm Data',
      `Pull the hail map for ${m}/${d}/${y} onto the server? You'll get a push notification when the map is ready.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Process',
          onPress: async () => {
            setProcessing(true);
            const res = await SupabaseService.processStorm(iso);
            setProcessing(false);
            if (res.ok) {
              Alert.alert(
                'Processing Started',
                res.skipWait
                  ? `The ${m}/${d}/${y} hail map is processing (~7 min). You'll get a push when it's ready.`
                  : `Today's storm is still developing — processing starts after a ~90 min wait. You'll get a push when the map is ready.`
              );
            } else {
              Alert.alert('Error', res.error ?? 'Could not start processing.');
            }
          },
        },
      ]
    );
  };

  const handleSearch = async () => {
    if (searchType === 'location' && !searchLocation.trim()) {
      Alert.alert('Error', 'Please enter a location, address, or zip code');
      return;
    }

    setLoading(true);
    try {
      let results: HistoricalStormEvent[] = [];

      switch (searchType) {
        case 'recent':
          // Search last 7 days for current location or entered location
          results = await WeatherHistoryService.searchStorms({
            location: searchLocation || 'Oklahoma City',
            dateRange: {
              start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              end: new Date()
            }
          });
          break;

        case 'date':
          // Search specific date
          console.log('[StormSearch] Searching for date:', selectedDate.toISOString());
          results = await WeatherHistoryService.searchStorms({
            date: selectedDate,
            location: searchLocation || undefined
          });
          console.log('[StormSearch] Found', results.length, 'results');
          break;

        case 'location':
          // Search by zip code or address
          results = await WeatherHistoryService.searchStorms({
            location: searchLocation
          });
          break;
      }

      setSearchResults(results);
      
      if (results.length === 0) {
        Alert.alert(
          'No Storms Found',
          'No hail events found for the selected criteria. Try a different date or location.'
        );
      }
    } catch (error) {
      console.error('Search error:', error);
      Alert.alert('Error', 'Failed to search storm history. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadStormData = async (event: HistoricalStormEvent) => {
    try {
      console.log('[StormSearch] Loading storm data:', event.location.name, event.date);
      console.log('[StormSearch] Reports count:', event.reports.length);
      
      if (!event.reports || event.reports.length === 0) {
        Alert.alert('No Data', 'This storm event has no hail reports to display.');
        return;
      }
      
      // Create a storm event from historical data
      const storm = await MRMSService.groupIntoStormEvents(event.reports);
      
      // Use the event date directly to avoid timezone confusion
      // Create a proper local date to ensure correct display
      const eventDate = new Date(event.date);
      storm.startTime = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 12, 0, 0);
      
      // Format the date consistently (MM/DD/YYYY) to avoid timezone display issues
      const month = storm.startTime.getMonth() + 1;
      const day = storm.startTime.getDate();
      const year = storm.startTime.getFullYear();
      storm.name = `${event.location.name} - ${month}/${day}/${year}`;
      
      // Ensure source is properly set for historical data
      storm.source = 'IEM';
      
      // Log for debugging
      console.log('[StormSearch] Saving storm:', {
        name: storm.name,
        source: storm.source,
        startTime: storm.startTime,
        eventDate: event.date,
        reports: storm.reports.length
      });
      console.log('[StormSearch] Storm object reports array length:', storm.reports.length);
      console.log('[StormSearch] First few reports:', storm.reports.slice(0, 3));
      const groundTruthReports = storm.reports.filter(r => r.groundTruth);
      console.log('[StormSearch] Ground truth reports:', groundTruthReports.length);
      console.log('[StormSearch] Ground truth report details:', groundTruthReports);
      
      // Save the storm event
      await MRMSService.saveStormEvent(storm);
      console.log('[StormSearch] Storm saved successfully');

      // Owner can make this storm date the team's active campaign (date of loss).
      const isOwner = await SupabaseService.isOwner();
      const goToMap = () => { navigation.goBack(); navigation.navigate('Main', { screen: 'Map' }); };
      const dolIso = new Date(event.date).toISOString().slice(0, 10);

      const buttons: any[] = [{ text: 'View on Map', onPress: goToMap }];
      if (isOwner) {
        buttons.push({
          text: 'Set as Active Campaign',
          onPress: async () => {
            const res = await SupabaseService.setTeamDefaultDateOfLoss(dolIso);
            Alert.alert(
              res.ok ? 'Campaign Set' : 'Error',
              res.ok ? `New knocks will be stamped with ${dolIso} (date of loss).` : (res.error ?? 'Could not set'),
              [{ text: 'OK', onPress: goToMap }]
            );
          },
        });
      }
      buttons.push({ text: 'OK' });

      Alert.alert(
        'Storm Loaded',
        `Historical storm data from ${event.location.name} has been loaded to the map.${isOwner ? '\n\nSet this storm date as your active campaign?' : ''}`,
        buttons
      );
    } catch (error) {
      console.error('[StormSearch] Error loading storm:', error);
      Alert.alert('Error', `Failed to load storm data: ${(error as Error).message}`);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'extreme': return '#991b1b';
      case 'severe': return '#dc2626';
      case 'moderate': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#6b7280';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Storm History Search</Text>
        <Text style={styles.subtitle}>Find historical hail events by location or date</Text>
      </View>

      {/* Search Type Selector */}
      <View style={styles.searchTypeContainer}>
        <TouchableOpacity
          style={[styles.typeButton, searchType === 'recent' && styles.typeButtonActive]}
          onPress={() => setSearchType('recent')}
        >
          <Text style={[styles.typeButtonText, searchType === 'recent' && styles.typeButtonTextActive]}>
            Recent (7 days)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, searchType === 'date' && styles.typeButtonActive]}
          onPress={() => setSearchType('date')}
        >
          <Text style={[styles.typeButtonText, searchType === 'date' && styles.typeButtonTextActive]}>
            Specific Date
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, searchType === 'location' && styles.typeButtonActive]}
          onPress={() => setSearchType('location')}
        >
          <Text style={[styles.typeButtonText, searchType === 'location' && styles.typeButtonTextActive]}>
            By Location
          </Text>
        </TouchableOpacity>
      </View>

      {/* Location Input */}
      <View style={styles.inputContainer}>
        <Ionicons name="location" size={20} color="#6b7280" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Enter city, address, or zip code (optional)"
          value={searchLocation}
          onChangeText={setSearchLocation}
          placeholderTextColor="#9ca3af"
        />
      </View>

      {/* Date Picker for specific date search */}
      {searchType === 'date' && (
        <TouchableOpacity
          style={styles.dateButton}
          onPress={() => setShowDatePicker(true)}
        >
          <Ionicons name="calendar" size={20} color="#6b7280" />
          <Text style={styles.dateButtonText}>
            {selectedDate.toLocaleDateString()}
          </Text>
        </TouchableOpacity>
      )}

      {showDatePicker && Platform.OS === 'ios' && (
        <View style={styles.iosDatePickerContainer}>
          <DateTimePicker
            value={selectedDate}
            mode="date"
            display="spinner"
            onChange={(event, date) => {
              if (date) setSelectedDate(date);
            }}
            maximumDate={new Date()}
            minimumDate={new Date('2019-10-01')} // IEM Archives available from October 2019
          />
          <TouchableOpacity
            style={styles.iosDateDoneButton}
            onPress={() => setShowDatePicker(false)}
          >
            <Text style={styles.iosDateDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (date) setSelectedDate(date);
          }}
          maximumDate={new Date()}
          minimumDate={new Date('2019-10-01')} // IEM Archives available from October 2019
        />
      )}

      {/* Search Button */}
      <TouchableOpacity
        style={[styles.searchButton, loading && styles.searchButtonDisabled]}
        onPress={handleSearch}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <>
            <Ionicons name="search" size={20} color="white" />
            <Text style={styles.searchButtonText}>Search Storms</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsTitle}>
            Found {searchResults.length} storm{searchResults.length !== 1 ? 's' : ''}
          </Text>
          
          {searchResults.map((event, index) => (
            <TouchableOpacity
              key={index}
              style={styles.resultCard}
              onPress={() => loadStormData(event)}
            >
              <View style={styles.resultHeader}>
                <Text style={styles.resultLocation}>{event.location.name}</Text>
                <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(event.severity) }]}>
                  <Text style={styles.severityText}>{event.severity.toUpperCase()}</Text>
                </View>
              </View>
              
              <Text style={styles.resultDate}>
                {event.date.toLocaleDateString()} at {event.date.toLocaleTimeString()}
              </Text>
              
              <Text style={styles.resultDescription}>
                {event.reports.length} hail reports • {event.source}
              </Text>
              
              <View style={styles.resultStats}>
                <View style={styles.statItem}>
                  <Ionicons name="resize" size={16} color="#6b7280" />
                  <Text style={styles.statText}>
                    Max: {event.hailSize.toFixed(2)}"
                  </Text>
                </View>
                <View style={styles.statItem}>
                  <Ionicons name="location" size={16} color="#6b7280" />
                  <Text style={styles.statText}>
                    {event.reports.length} reports
                  </Text>
                </View>
              </View>
              
              <Text style={styles.loadText}>Tap to load on map →</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Available Storm Maps — live list of processed dates (hail_grid_dates) */}
      <View style={styles.significantDatesContainer}>
        <View style={styles.significantDatesHeader}>
          <Text style={styles.significantDatesTitle}>Available Storm Maps</Text>
          <TouchableOpacity
            style={styles.clearStormsButton}
            onPress={async () => {
              Alert.alert(
                'Clear All Storms',
                'This will remove all saved storm data from the map. Continue?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { 
                    text: 'Clear', 
                    style: 'destructive',
                    onPress: async () => {
                      await MRMSService.clearAllStorms();
                      Alert.alert('Success', 'All storm data has been cleared.');
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={16} color="#dc2626" />
            <Text style={styles.clearStormsText}>Clear All</Text>
          </TouchableOpacity>
        </View>
        {availableError ? (
          <View style={styles.availableStateRow}>
            <Text style={styles.availableErrorText}>Couldn't load the storm list</Text>
            <TouchableOpacity onPress={loadAvailableStorms}>
              <Text style={styles.availableRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : availableStorms === null ? (
          <ActivityIndicator size="small" color="#1e40af" style={styles.availableSpinner} />
        ) : availableStorms.length === 0 ? (
          <Text style={styles.availableEmptyText}>
            No processed storm maps yet — process one below, or wait for the next storm alert.
          </Text>
        ) : (
          availableStorms.map(storm => (
            <TouchableOpacity
              key={storm.date}
              style={styles.significantDateButton}
              onPress={() => {
                // Reuse the swath_ready auto-load path: RealMapScreen reads
                // pendingSwathDate on focus and loads the swath itself.
                (global as any).pendingSwathDate = storm.date;
                navigation.goBack();
                navigation.navigate('Main', { screen: 'Map' });
              }}
            >
              <Text style={styles.significantDateText}>
                🌩️ {formatStormDate(storm.date)}
              </Text>
              <Text style={styles.availableDetailText}>
                {storm.point_count} hail points · max {storm.max_size_inches.toFixed(2)}″ · tap to view
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Process Storm Data — owner only; triggers the server-side GRIB2 pipeline */}
      {ownerRole && (
        <View style={styles.significantDatesContainer}>
          <Text style={styles.significantDatesTitle}>Process Storm Data</Text>
          <Text style={styles.processHint}>
            Pull a date's hail map onto the server — no computer needed. The map and
            address lookups update automatically when it finishes.
          </Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => setShowProcessPicker(true)}>
            <Ionicons name="calendar" size={20} color="#6b7280" />
            <Text style={styles.dateButtonText}>{processDate.toLocaleDateString()}</Text>
          </TouchableOpacity>
          {showProcessPicker && Platform.OS === 'ios' && (
            <View style={styles.iosDatePickerContainer}>
              <DateTimePicker
                value={processDate}
                mode="date"
                display="spinner"
                onChange={(event, date) => {
                  if (date) setProcessDate(date);
                }}
                maximumDate={new Date()}
                minimumDate={new Date('2019-10-01')}
              />
              <TouchableOpacity
                style={styles.iosDateDoneButton}
                onPress={() => setShowProcessPicker(false)}
              >
                <Text style={styles.iosDateDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
          {showProcessPicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={processDate}
              mode="date"
              display="default"
              onChange={(event, date) => {
                setShowProcessPicker(false);
                if (date) setProcessDate(date);
              }}
              maximumDate={new Date()}
              minimumDate={new Date('2019-10-01')}
            />
          )}
          <TouchableOpacity
            style={[styles.searchButton, processing && styles.searchButtonDisabled]}
            disabled={processing}
            onPress={handleProcessStorm}
          >
            {processing ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="cloud-download" size={20} color="white" />
                <Text style={styles.searchButtonText}>Process Storm</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Note about capabilities */}
      <View style={styles.noteContainer}>
        <Ionicons name="information-circle" size={20} color="#6b7280" />
        <Text style={styles.noteText}>
          Search historical storms back to October 2019 using NOAA IEM Archives. 
          Data quality and availability may vary for older dates.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  searchTypeContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#1e40af',
    borderColor: '#1e40af',
  },
  typeButtonText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: 'white',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 8,
  },
  dateButtonText: {
    fontSize: 16,
    color: '#111827',
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e40af',
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 8,
    gap: 8,
  },
  searchButtonDisabled: {
    opacity: 0.5,
  },
  searchButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsContainer: {
    paddingHorizontal: 16,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  resultCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultLocation: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  severityText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  resultDate: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
  },
  resultDescription: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 12,
  },
  resultStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: '#6b7280',
  },
  loadText: {
    fontSize: 14,
    color: '#1e40af',
    fontWeight: '500',
    textAlign: 'right',
  },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    gap: 8,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },
  significantDatesContainer: {
    padding: 16,
    paddingTop: 8,
  },
  significantDatesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  significantDatesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  clearStormsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  clearStormsText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '500',
  },
  significantDateButton: {
    backgroundColor: '#f3f4f6',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  significantDateText: {
    fontSize: 14,
    color: '#1e40af',
    fontWeight: '500',
  },
  availableDetailText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  availableEmptyText: {
    fontSize: 13,
    color: '#6b7280',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  availableStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  availableErrorText: {
    flex: 1,
    fontSize: 14,
    color: '#ef4444',
  },
  availableRetryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e40af',
  },
  availableSpinner: {
    paddingVertical: 12,
  },
  processHint: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
    marginBottom: 10,
  },
  iosDatePickerContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    marginVertical: 12,
    overflow: 'hidden',
  },
  iosDateDoneButton: {
    backgroundColor: '#1e40af',
    padding: 12,
    alignItems: 'center',
  },
  iosDateDoneText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
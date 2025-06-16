import React, { useState } from 'react';
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

export default function StormSearchScreen({ navigation }: any) {
  const [searchLocation, setSearchLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchResults, setSearchResults] = useState<HistoricalStormEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchType, setSearchType] = useState<'location' | 'date' | 'recent'>('recent');

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
      // The event.date is already the correct local date from the search
      storm.startTime = new Date(event.date);
      
      // Format the date consistently (MM/DD/YYYY) to avoid timezone display issues
      const month = storm.startTime.getMonth() + 1;
      const day = storm.startTime.getDate();
      const year = storm.startTime.getFullYear();
      storm.name = `${event.location.name} - ${month}/${day}/${year}`;
      
      // Save the storm event
      await MRMSService.saveStormEvent(storm);
      
      Alert.alert(
        'Storm Loaded',
        `Historical storm data from ${event.location.name} has been loaded to the map.`,
        [
          { text: 'View on Map', onPress: () => navigation.navigate('Map') },
          { text: 'OK' }
        ]
      );
    } catch (error) {
      console.error('[StormSearch] Error loading storm:', error);
      Alert.alert('Error', `Failed to load storm data: ${error.message}`);
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

      {/* Significant Storm Dates */}
      <View style={styles.significantDatesContainer}>
        <Text style={styles.significantDatesTitle}>Known Storm Dates</Text>
        <TouchableOpacity
          style={styles.significantDateButton}
          onPress={async () => {
            setSelectedDate(new Date('2024-09-24'));
            setSearchType('date');
            // Automatically search for this date
            setLoading(true);
            try {
              console.log('[StormSearch] Quick searching for Sept 24, 2024');
              const results = await WeatherHistoryService.searchStorms({
                date: new Date('2024-09-24')
              });
              console.log('[StormSearch] Search complete. Results:', results);
              console.log('[StormSearch] Found', results.length, 'storm events for Sept 24');
              
              if (results.length > 0) {
                console.log('[StormSearch] First result has', results[0].reports.length, 'reports');
              }
              
              setSearchResults(results);
              if (results.length === 0) {
                Alert.alert('No Storms Found', 'No data available for September 24, 2024.\n\nThis may be due to data source unavailability.');
              }
            } catch (error) {
              console.error('[StormSearch] Error:', error);
              Alert.alert('Error', `Failed to search storm history: ${error.message}`);
            } finally {
              setLoading(false);
            }
          }}
        >
          <Text style={styles.significantDateText}>Sept 24, 2024 - Major OKC Metro Event</Text>
        </TouchableOpacity>
      </View>

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
  significantDatesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
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
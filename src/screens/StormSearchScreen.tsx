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
          results = await WeatherHistoryService.getStormsByDate(
            selectedDate,
            searchLocation || 'Oklahoma'
          );
          break;

        case 'location':
          // Search by zip code or address
          results = await WeatherHistoryService.searchRecentStorms(searchLocation);
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
      // Create a storm event from historical data
      const storm = await MRMSService.groupIntoStormEvents(event.reports);
      storm.name = `${event.location.name} - ${event.date.toLocaleDateString()}`;
      
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
      console.error('Error loading storm:', error);
      Alert.alert('Error', 'Failed to load storm data');
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'extreme': return '#991b1b';
      case 'severe': return '#dc2626';
      case 'moderate': return '#f59e0b';
      case 'minor': return '#10b981';
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

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            setShowDatePicker(Platform.OS === 'android');
            if (date) setSelectedDate(date);
          }}
          maximumDate={new Date()}
          minimumDate={new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)} // 7 days ago
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
              
              <Text style={styles.resultDescription}>{event.description}</Text>
              
              <View style={styles.resultStats}>
                <View style={styles.statItem}>
                  <Ionicons name="resize" size={16} color="#6b7280" />
                  <Text style={styles.statText}>
                    Max: {event.maxHailSize.toFixed(2)}"
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

      {/* Note about limitations */}
      <View style={styles.noteContainer}>
        <Ionicons name="information-circle" size={20} color="#6b7280" />
        <Text style={styles.noteText}>
          Free tier allows searching up to 7 days of history. For extended history, upgrade to a paid plan.
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
});
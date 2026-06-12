import React, { useState, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PlacesService, PlacePrediction } from '../services/placesService';

interface AddressSearchBarProps {
  onAddressSelect: (address: string, lat: number, lng: number) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 300; // Uber-feel; each debounced keystroke = 1 autocomplete request
const MIN_CHARS = 3;

export default function AddressSearchBar({ onAddressSelect, placeholder = "Search address..." }: AddressSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchTimeout = useRef<NodeJS.Timeout | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const requestSeq = useRef(0); // drop out-of-order responses

  const fetchPredictions = async (query: string) => {
    if (query.length < MIN_CHARS) {
      setPredictions([]);
      setShowResults(false);
      return;
    }
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = PlacesService.newSessionToken();
    }
    const seq = ++requestSeq.current;
    setIsSearching(true);
    try {
      const results = await PlacesService.getPredictions(query, sessionTokenRef.current);
      if (seq !== requestSeq.current) return; // stale response
      setSearchError(false);
      setPredictions(results);
      setShowResults(true);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      console.error('[AddressSearch] prediction error:', error);
      setSearchError(true);
      setPredictions([]);
      setShowResults(true); // show the explicit error row — never fail silently
    } finally {
      if (seq === requestSeq.current) setIsSearching(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchPredictions(text), DEBOUNCE_MS);
  };

  const handleSelectPrediction = async (prediction: PlacePrediction) => {
    const token = sessionTokenRef.current ?? PlacesService.newSessionToken();
    sessionTokenRef.current = null; // selection ends the billing session
    setShowResults(false);
    Keyboard.dismiss();
    setIsSearching(true);
    try {
      const { address, lat, lng } = await PlacesService.getPlaceLocation(prediction.placeId, token);
      setSearchQuery(address || `${prediction.mainText}, ${prediction.secondaryText}`);
      onAddressSelect(address || prediction.mainText, lat, lng);
    } catch (error) {
      console.error('[AddressSearch] place details error:', error);
      setSearchError(true);
      setShowResults(true);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setPredictions([]);
    setShowResults(false);
    setSearchError(false);
    sessionTokenRef.current = null;
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={handleSearchChange}
          onFocus={() => setShowResults(predictions.length > 0 || searchError)}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {isSearching && (
          <ActivityIndicator size="small" color="#1e40af" style={styles.loadingIcon} />
        )}
        {searchQuery.length > 0 && !isSearching && (
          <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#6b7280" />
          </TouchableOpacity>
        )}
      </View>

      {showResults && (
        <View style={styles.resultsContainer}>
          {searchError ? (
            <View style={styles.errorRow}>
              <Ionicons name="cloud-offline" size={16} color="#ef4444" style={styles.resultIcon} />
              <Text style={styles.errorText}>
                {PlacesService.hasKey()
                  ? 'Search unavailable — check connection'
                  : 'Search unavailable — API key missing'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={predictions}
              keyExtractor={item => item.placeId}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectPrediction(item)}
                >
                  <Ionicons name="location" size={16} color="#6b7280" style={styles.resultIcon} />
                  <View style={styles.resultTextBox}>
                    <Text style={styles.resultMain} numberOfLines={1}>{item.mainText}</Text>
                    <Text style={styles.resultSecondary} numberOfLines={1}>{item.secondaryText}</Text>
                  </View>
                </TouchableOpacity>
              )}
              style={styles.resultsList}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 80, // Below the stats bar
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 0,
  },
  loadingIcon: {
    marginLeft: 8,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  resultsContainer: {
    marginTop: 8,
    backgroundColor: 'white',
    borderRadius: 12,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  resultsList: {
    borderRadius: 12,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  resultIcon: {
    marginRight: 12,
  },
  resultTextBox: {
    flex: 1,
  },
  resultMain: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  resultSecondary: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#ef4444',
  },
});

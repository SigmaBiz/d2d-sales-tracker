import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCATION_TASK_NAME = 'background-location-task';
const KNOCK_LOCATION_KEY = '@knock_locations';

export class LocationService {
  static async requestPermissions(): Promise<boolean> {
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      return false;
    }

    const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
    return backgroundStatus === 'granted';
  }

  static async getCurrentLocation(): Promise<Location.LocationObject | null> {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      return location;
    } catch (error) {
      console.error('Error getting current location:', error);
      return null;
    }
  }

  static async startBackgroundLocationTracking(): Promise<void> {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000, // 5 seconds
      distanceInterval: 10, // 10 meters
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'D2D Sales Tracker',
        notificationBody: 'Tracking your territory',
      },
    });
  }

  static async stopBackgroundLocationTracking(): Promise<void> {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }

  static async getStoredKnockLocations(): Promise<any[]> {
    try {
      const locations = await AsyncStorage.getItem(KNOCK_LOCATION_KEY);
      return locations ? JSON.parse(locations) : [];
    } catch (error) {
      console.error('Error getting stored locations:', error);
      return [];
    }
  }

  static async reverseGeocode(latitude: number, longitude: number): Promise<string> {
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (address) {
        return `${address.streetNumber || ''} ${address.street || ''}, ${address.city || ''}, ${address.region || ''}`.trim();
      }
      return '';
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      return '';
    }
  }
}

// Background location task
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }
  if (data) {
    const { locations } = data as any;
    try {
      const storedLocations = await LocationService.getStoredKnockLocations();
      const newLocations = [...storedLocations, ...locations];
      await AsyncStorage.setItem(KNOCK_LOCATION_KEY, JSON.stringify(newLocations));
    } catch (error) {
      console.error('Error storing background location:', error);
    }
  }
});
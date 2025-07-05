import { NativeModules, NativeEventEmitter, Platform, requireNativeComponent, ViewProps, findNodeHandle } from 'react-native';
import { Knock } from '../types';

// Native module interfaces
const { D2DNativeMap } = NativeModules;
const nativeMapEmitter = new NativeEventEmitter(D2DNativeMap);

// Native view component
interface NativeMapViewProps extends ViewProps {
  onMapReady?: () => void;
  onKnockPress?: (event: { nativeEvent: { knock: Knock } }) => void;
  onMapPress?: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void;
  onRegionChange?: (event: { nativeEvent: { region: Region } }) => void;
  onRegionChangeComplete?: (event: { nativeEvent: { region: Region } }) => void;
}

const NativeMapView = Platform.OS === 'ios' 
  ? requireNativeComponent<NativeMapViewProps>('D2DNativeMapView')
  : null;

// Types
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapConfig {
  initialRegion?: Region;
  showsUserLocation?: boolean;
  showsCompass?: boolean;
  showsScale?: boolean;
  followsUserLocation?: boolean;
}

export interface Territory {
  id: string;
  name: string;
  coordinates: Array<{ latitude: number; longitude: number }>;
  fillColor?: string;
  strokeColor?: string;
}

// Native Map Manager
class NativeMapManager {
  private viewTag: number | null = null;
  private eventSubscriptions: Array<{ remove: () => void }> = [];
  private isEnabled: boolean = Platform.OS === 'ios';

  setViewTag(viewTag: number | null) {
    this.viewTag = viewTag;
  }

  async createMap(viewRef: any, config: MapConfig): Promise<void> {
    if (!this.isEnabled || !D2DNativeMap) {
      throw new Error('Native map not available');
    }

    const viewTag = findNodeHandle(viewRef);
    if (!viewTag) {
      throw new Error('Could not find view tag');
    }

    this.viewTag = viewTag;
    await D2DNativeMap.createMap(viewTag, config);
  }

  destroyMap() {
    if (this.viewTag && D2DNativeMap) {
      D2DNativeMap.destroyMap(this.viewTag);
      this.viewTag = null;
    }
    this.removeAllListeners();
  }

  // Knock management
  async addKnocks(knocks: Knock[]) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.addKnocks(this.viewTag, knocks);
  }

  async removeKnock(knockId: string) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.removeKnock(this.viewTag, knockId);
  }

  async updateKnock(knock: Knock) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.updateKnock(this.viewTag, knock);
  }

  // Territory management
  async setTerritories(territories: Territory[]) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.setTerritories(this.viewTag, territories);
  }

  async highlightTerritory(territoryId: string, highlight: boolean) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.highlightTerritory(this.viewTag, territoryId, highlight);
  }

  // Camera controls
  async setCamera(region: Region, animated: boolean = true) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.setCamera(this.viewTag, region, animated);
  }

  async fitToKnocks(padding?: { top?: number; right?: number; bottom?: number; left?: number }, animated: boolean = true) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.fitToKnocks(this.viewTag, padding || {}, animated);
  }

  // User location
  async setShowsUserLocation(show: boolean) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.setShowsUserLocation(this.viewTag, show);
  }

  async setFollowsUserLocation(follow: boolean) {
    if (!this.viewTag || !D2DNativeMap) return;
    await D2DNativeMap.setFollowsUserLocation(this.viewTag, follow);
  }

  // Utilities
  async takeSnapshot(): Promise<{ base64: string; width: number; height: number }> {
    if (!this.viewTag || !D2DNativeMap) {
      throw new Error('Map not initialized');
    }
    return await D2DNativeMap.takeSnapshot(this.viewTag);
  }

  // Event handling
  addEventListener(event: string, handler: (data: any) => void) {
    const subscription = nativeMapEmitter.addListener(event, (data) => {
      // Only handle events for this viewTag
      if (data.viewTag === this.viewTag) {
        handler(data);
      }
    });
    this.eventSubscriptions.push(subscription);
    return subscription;
  }

  removeAllListeners() {
    this.eventSubscriptions.forEach(sub => sub.remove());
    this.eventSubscriptions = [];
  }

  // Kill switch
  setEnabled(enabled: boolean) {
    this.isEnabled = enabled && Platform.OS === 'ios';
  }

  isNativeMapAvailable(): boolean {
    return this.isEnabled && !!D2DNativeMap;
  }
}

export { NativeMapView, NativeMapManager };
export const nativeMapManager = new NativeMapManager();
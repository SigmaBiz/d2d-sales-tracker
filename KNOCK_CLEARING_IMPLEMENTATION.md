# Knock Clearing Implementation Plan

## Overview
Implement a knock clearing feature that allows users to hide individual knocks from the map without deleting them from cloud storage. This preserves data integrity while improving map readability.

## Design Principles
1. **Soft Delete**: Knocks are hidden, not permanently deleted
2. **Local Only**: Clearing only affects local display
3. **Reversible**: Users can restore cleared knocks
4. **Cloud Preserved**: All data remains in cloud for analytics
5. **Auto-Sync**: Regular sync intervals following industry standards

## Auto-Sync Intervals (Industry Standards)

### Recommended Sync Schedule
```typescript
const SYNC_INTERVALS = {
  // Active use: sync frequently
  ACTIVE_USE: 30 * 1000,        // 30 seconds during active use
  
  // Background: sync periodically  
  BACKGROUND: 5 * 60 * 1000,    // 5 minutes in background
  
  // On events
  ON_APP_FOREGROUND: 0,         // Immediate sync when app returns
  ON_NETWORK_RECONNECT: 0,      // Immediate sync when network returns
  ON_SIGNIFICANT_CHANGE: 0,     // Immediate sync after 10+ knocks
  
  // Battery optimization
  LOW_BATTERY: 30 * 60 * 1000,  // 30 minutes when battery < 20%
  
  // Retry logic
  RETRY_BACKOFF: [1, 2, 5, 10, 30] // Minutes for retry attempts
};
```

## Implementation Details

### 1. Storage Service Updates
```typescript
// src/services/storageService.ts

// Add new storage key for cleared knocks
const KEYS = {
  // ... existing keys
  CLEARED_KNOCKS: '@cleared_knocks', // Array of knock IDs
  LAST_SYNC: '@last_sync',           // Timestamp of last sync
};

// New methods
static async clearKnock(knockId: string): Promise<void> {
  const clearedIds = await this.getClearedKnockIds();
  if (!clearedIds.includes(knockId)) {
    clearedIds.push(knockId);
    await AsyncStorage.setItem(KEYS.CLEARED_KNOCKS, JSON.stringify(clearedIds));
  }
}

static async getClearedKnockIds(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(KEYS.CLEARED_KNOCKS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

static async restoreKnock(knockId: string): Promise<void> {
  const clearedIds = await this.getClearedKnockIds();
  const filtered = clearedIds.filter(id => id !== knockId);
  await AsyncStorage.setItem(KEYS.CLEARED_KNOCKS, JSON.stringify(filtered));
}

static async restoreAllKnocks(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.CLEARED_KNOCKS);
}

// Modified getKnocks to filter cleared ones
static async getVisibleKnocks(): Promise<Knock[]> {
  const allKnocks = await this.getKnocks();
  const clearedIds = await this.getClearedKnockIds();
  return allKnocks.filter(knock => !clearedIds.includes(knock.id));
}
```

### 2. Auto-Sync Service
```typescript
// src/services/autoSyncService.ts

export class AutoSyncService {
  private static syncInterval: NodeJS.Timeout | null = null;
  private static lastSyncTime: Date | null = null;
  private static pendingChanges: number = 0;
  private static isActive: boolean = true;
  private static batteryLevel: number = 100;

  static async initialize() {
    // Set up app state listener
    AppState.addEventListener('change', this.handleAppStateChange);
    
    // Set up network listener
    NetInfo.addEventListener(this.handleNetworkChange);
    
    // Start sync interval
    this.startSyncInterval();
    
    // Load last sync time
    const lastSync = await AsyncStorage.getItem('@last_sync');
    this.lastSyncTime = lastSync ? new Date(lastSync) : null;
  }

  private static startSyncInterval() {
    const interval = this.isActive 
      ? SYNC_INTERVALS.ACTIVE_USE 
      : SYNC_INTERVALS.BACKGROUND;

    this.syncInterval = setInterval(() => {
      this.performSync();
    }, interval);
  }

  private static async performSync() {
    try {
      // Check if sync is needed
      if (!this.shouldSync()) return;

      // Get all data to sync
      const knocks = await StorageService.getKnocks();
      const clearedIds = await StorageService.getClearedKnockIds();
      
      // Sync with cloud (only non-cleared knocks)
      const knocksToSync = knocks.filter(k => !clearedIds.includes(k.id));
      await SupabaseService.syncKnocks(knocksToSync);
      
      // Update last sync time
      this.lastSyncTime = new Date();
      await AsyncStorage.setItem('@last_sync', this.lastSyncTime.toISOString());
      
      // Reset pending changes
      this.pendingChanges = 0;
      
      console.log('[AutoSync] Sync completed:', knocksToSync.length, 'knocks');
    } catch (error) {
      console.error('[AutoSync] Sync failed:', error);
      this.handleSyncError();
    }
  }

  private static shouldSync(): boolean {
    // Don't sync if no network
    if (!NetInfo.isConnected) return false;
    
    // Don't sync if battery is low and not charging
    if (this.batteryLevel < 20) {
      const timeSinceLastSync = Date.now() - (this.lastSyncTime?.getTime() || 0);
      if (timeSinceLastSync < SYNC_INTERVALS.LOW_BATTERY) return false;
    }
    
    // Always sync if significant changes
    if (this.pendingChanges >= 10) return true;
    
    return true;
  }
}
```

### 3. UI Implementation

#### Map Popup Update
```typescript
// In WebMap component, update the popup content:

const popupContent = `
  <div>
    <strong>${knock.address}</strong><br>
    Status: ${emoji} ${outcome}<br>
    ${knock.notes ? `Notes: ${knock.notes}<br>` : ''}
    <div style="margin-top: 10px;">
      <button onclick="editKnock('${knock.id}')" 
        style="background: #3b82f6; color: white; ...">
        Edit
      </button>
      <button onclick="clearKnock('${knock.id}')" 
        style="background: #ef4444; color: white; ...">
        Clear
      </button>
    </div>
  </div>
`;
```

#### Long Press to Show Cleared
```typescript
// In RealMapScreen.tsx, add long press handler on refresh button:

<TouchableOpacity 
  style={styles.actionButton} 
  onPress={loadKnocks}
  onLongPress={async () => {
    // Toggle showing cleared knocks
    setShowCleared(!showCleared);
    Alert.alert(
      showCleared ? 'Hiding Cleared Knocks' : 'Showing All Knocks',
      showCleared 
        ? 'Map will now hide cleared knocks' 
        : 'Map will show all knocks including cleared ones',
      [{ text: 'OK' }]
    );
    loadKnocks();
  }}
>
  <Ionicons 
    name="refresh" 
    size={24} 
    color={showCleared ? "#ef4444" : "#1e40af"} 
  />
</TouchableOpacity>
```

### 4. Settings Screen Addition
```typescript
// Add to SettingsScreen.tsx:

<View style={styles.section}>
  <Text style={styles.sectionTitle}>Sync Settings</Text>
  
  <View style={styles.setting}>
    <Text style={styles.settingLabel}>Auto-Sync</Text>
    <Switch
      value={autoSyncEnabled}
      onValueChange={handleAutoSyncToggle}
    />
  </View>
  
  <View style={styles.setting}>
    <Text style={styles.settingLabel}>Last Synced</Text>
    <Text style={styles.settingValue}>
      {lastSyncTime ? formatRelativeTime(lastSyncTime) : 'Never'}
    </Text>
  </View>
  
  <TouchableOpacity 
    style={styles.button}
    onPress={handleManualSync}
  >
    <Text style={styles.buttonText}>Sync Now</Text>
  </TouchableOpacity>
  
  <TouchableOpacity 
    style={[styles.button, styles.secondaryButton]}
    onPress={handleRestoreCleared}
  >
    <Text style={styles.buttonText}>
      Restore Cleared Knocks ({clearedCount})
    </Text>
  </TouchableOpacity>
</View>
```

## Benefits of This Approach

1. **Data Integrity**: Never lose data, just hide it locally
2. **Performance**: Cleaner map with fewer markers
3. **Flexibility**: Easy to undo clearing
4. **Analytics**: Cloud keeps all data for reports
5. **Battery Efficient**: Smart sync intervals
6. **Network Aware**: Syncs when connected
7. **User Control**: Manual sync option

## Migration Path

1. **Phase 1**: Implement clearing without breaking existing functionality
2. **Phase 2**: Add auto-sync service
3. **Phase 3**: Add UI controls
4. **Phase 4**: Add settings and manual controls

## Testing Checklist

- [ ] Clear knock removes from map
- [ ] Cleared knocks persist across app restarts
- [ ] Long press shows/hides cleared knocks
- [ ] Auto-sync runs at correct intervals
- [ ] Manual sync works from settings
- [ ] Restore cleared knocks works
- [ ] No data loss in cloud
- [ ] Performance remains good with many cleared knocks

This implementation provides a professional, user-friendly way to manage knock visibility while preserving all data for analytics and compliance.
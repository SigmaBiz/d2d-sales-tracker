# D2D Sales Tracker - Comprehensive Architectural Analysis

## Executive Summary

The D2D Sales Tracker is a React Native application designed for door-to-door sales teams specializing in storm damage restoration. The app integrates a sophisticated 3-tier hail intelligence system with comprehensive canvassing features, providing real-time storm tracking, historical data validation, and sales performance analytics.

## Core Architecture Overview

### Technology Stack
- **Frontend**: React Native (Expo)
- **Local Storage**: AsyncStorage
- **Cloud Sync**: Supabase
- **Map Rendering**: Leaflet (WebView) + react-native-maps
- **Weather Data**: NOAA MRMS, IEM Archives, Storm Events DB
- **State Management**: React hooks + context
- **Background Processing**: expo-location, expo-task-manager

## 1. 3-Tier Hail Intelligence System

### Architecture Overview
```
┌─────────────────────────────────────────────────────────────┐
│                   Integrated Hail Intelligence               │
│                 (integratedHailIntelligence.ts)             │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┬─────────────────────┐
        │                             │                      │
┌───────▼────────┐          ┌────────▼────────┐    ┌───────▼────────┐
│    TIER 1      │          │     TIER 2      │    │    TIER 3      │
│  Real-Time     │          │   Historical    │    │  Validation    │
│   (2 min)      │          │   (24-48hr)     │    │   (Weekly)     │
└────────────────┘          └─────────────────┘    └────────────────┘
```

### Tier 1: Real-Time MRMS (2-minute updates)

**Service**: `tier1NCEPService.ts`

**Data Flow**:
1. **Fetch**: NCEP MRMS API → GRIB2 data
2. **Process**: GRIB2 → JSON conversion via proxy server
3. **Store**: AsyncStorage → `@tier1_latest_data`
4. **Alert**: Push notifications via `hailAlertService.ts`

**Key Features**:
- Storm progression tracking with timeline
- Confidence scoring (60-70% base)
- Service area bounds checking
- Quick deploy mode for rapid response

**Performance Considerations**:
- 2-minute polling interval during active weather
- GRIB2 processing offloaded to proxy server
- Caches latest 10 storm progressions in memory

### Tier 2: Historical GRIB2 (24-48 hour data)

**Service**: `tier2IEMService.ts`

**Data Flow**:
1. **Archive Access**: IEM MRMS Archives → ZIP files
2. **Extract**: GRIB2 files from daily archives
3. **Process**: Server-side preprocessing → JSON
4. **Cache**: Preprocessed data on proxy server
5. **Deliver**: JSON data to app

**Key Features**:
- Date range: October 2019 - Present
- Confidence scoring (70-85% base)
- Territory heat map generation
- Address-specific hail history

**Performance Optimizations**:
- Server-side preprocessing of common dates
- Chunked data transfer for large datasets
- Local caching of frequently accessed dates

### Tier 3: Storm Events Validation

**Service**: `tier3StormEventsService.ts`

**Data Flow**:
1. **Fetch**: NOAA Storm Events Database
2. **Compare**: Predictions vs ground truth
3. **Calculate**: Accuracy metrics (precision, recall, F1)
4. **Adjust**: Algorithm weight tuning
5. **Store**: Performance history

**Key Features**:
- Weekly validation runs
- Territory reliability scoring
- ML-based weight adjustments
- Performance trending

**Metrics Tracked**:
- True/False Positives
- False Negatives  
- Size accuracy
- Location accuracy
- F1 Score

### Data Flow Integration

**Service**: `hailDataFlowService.ts`

**Pipeline**:
```
Real-Time Detection → Immediate Alerts → Canvassing
        ↓
Historical Archive → Territory Planning → Route Optimization
        ↓
Ground Truth → Algorithm Tuning → Improved Accuracy
```

**Stage Processing**:
1. **Real-time**: Every 5 minutes
2. **Historical**: Daily at 2 AM
3. **Validation**: Weekly on Sundays at 3 AM

## 2. Canvassing Features

### Knock Management System

**Core Service**: `storageService.ts`

**Data Model**:
```typescript
interface Knock {
  id: string;
  latitude: number;
  longitude: number;
  address?: string;
  outcome: KnockOutcome;
  notes?: string;
  timestamp: Date;
  repId: string;
  syncStatus: 'pending' | 'synced';
  history?: Array<{
    outcome: KnockOutcome;
    timestamp: Date;
    notes?: string;
  }>;
}
```

### 15 Knock Outcome Types

1. **Primary Outcomes**:
   - `not_home` (👻): Nobody answered
   - `convo` (💬): Had conversation
   - `inspected` (🪜): Roof inspected
   - `no_soliciting` (🚫): No soliciting sign
   - `lead` (✅): Interested prospect
   - `sale` (📝): Contract signed
   - `callback` (🔄): Follow up needed

2. **Property Status**:
   - `new_roof` (👼): Recently replaced roof
   - `competitor` (🏗️): Another company working
   - `renter` (🧟): Tenant, not owner
   - `poor_condition` (🏚️): House in bad shape

3. **Action Taken**:
   - `proposal_left` (📋): Left estimate/proposal
   - `stay_away` (👹): Dangerous or problematic
   - `revisit` (👀): Worth coming back
   - `not_interested` (❌): Legacy outcome

### Local Storage Architecture

**AsyncStorage Keys**:
- `@knocks`: All knock records
- `@cleared_knocks`: IDs of hidden knocks
- `@territories`: Territory definitions
- `@daily_stats`: Performance metrics
- `@contact_forms`: Lead information
- `@notification_log`: Alert history
- `@last_sync`: Sync timestamp

**Storage Operations**:
1. **Save**: Checks for existing knock at location
2. **Update**: Maintains history of outcome changes
3. **Clear**: Soft delete (hide from view)
4. **Restore**: Unhide cleared knocks

### Cloud Sync Architecture

**Service**: `supabaseService.ts` + `autoSyncService.ts`

**Sync Strategy**:
- **Active Use**: 30-second intervals
- **Background**: 5-minute intervals
- **Event-Driven**: On app foreground, network reconnect
- **Batch Sync**: After 10+ changes

**Sync Flow**:
```
Local Changes → Batch Upload → Supabase
       ↓                           ↓
  Retry Queue               Real-time Updates
       ↓                           ↓
  Exponential              WebSocket Subscription
    Backoff
```

**Conflict Resolution**:
- Last-write-wins strategy
- Local ID + User ID composite key
- History preservation on updates

### One Tag Per Location System

**Implementation**:
1. **Location Matching**:
   - Address-based (exact match)
   - Coordinate-based (< 0.0001° threshold)
   
2. **History Tracking**:
   - Previous outcomes stored in array
   - Timestamp for each change
   - Notes preserved

3. **UI Representation**:
   - Latest outcome shown on map
   - History accessible via tap
   - Color-coded by outcome type

## 3. Data Flow Analysis

### Complete Knock Journey

```
1. User Action (MapScreen)
      ↓
2. Create Knock (KnockScreen)
      ↓
3. Save Locally (StorageService)
      ↓
4. Update Stats (Daily/Territory)
      ↓
5. Queue for Sync (AutoSyncService)
      ↓
6. Upload to Cloud (SupabaseService)
      ↓
7. Real-time Update (WebSocket)
      ↓
8. Analytics Processing (StatsScreen)
```

### Storage Points

1. **Local Storage**:
   - Primary data store
   - Immediate availability
   - Offline capability

2. **Memory Cache**:
   - Active knocks for map
   - Recent notifications
   - Storm progressions

3. **Cloud Storage**:
   - Backup and sync
   - Cross-device access
   - Team collaboration

### Sync Mechanisms

1. **Auto-Sync Service**:
   - Network state monitoring
   - App state monitoring
   - Battery optimization
   - Retry with backoff

2. **Manual Sync**:
   - User-triggered
   - Settings screen
   - Pull-to-refresh

3. **Real-time Sync**:
   - WebSocket subscription
   - Instant updates
   - Conflict detection

## 4. Integration Points

### Service Communication

```
┌─────────────────┐     ┌──────────────────┐
│   Map Screen    │────▶│  Location Service │
└────────┬────────┘     └──────────────────┘
         │
         │              ┌──────────────────┐
         ├─────────────▶│ Storage Service  │
         │              └──────────────────┘
         │
         │              ┌──────────────────┐
         └─────────────▶│  WebView Bridge  │
                        └──────────────────┘
```

### Event Handling

1. **Location Updates**:
   - Background tracking
   - Geofencing triggers
   - Battery optimization

2. **Hail Alerts**:
   - Push notifications
   - In-app alerts
   - Team broadcasts

3. **Sync Events**:
   - Progress updates
   - Error handling
   - Conflict resolution

### State Management

1. **React Hooks**:
   - Component-level state
   - Effect management
   - Memoization

2. **AsyncStorage**:
   - Persistent state
   - App settings
   - User preferences

3. **Context Providers**:
   - Global app state
   - Theme management
   - Auth state

### WebView Bridge

**Map Integration**:
```javascript
// React Native → WebView
webViewRef.postMessage(JSON.stringify({
  type: 'updateKnocks',
  data: knocks
}));

// WebView → React Native
window.ReactNativeWebView.postMessage(JSON.stringify({
  type: 'knockClick',
  knockId: id
}));
```

**Supported Messages**:
- `updateKnocks`: Refresh markers
- `updateLocation`: User position
- `updateHailContours`: Storm overlays
- `knockClick`: Marker interaction
- `knockClear`: Hide knock
- `mapReady`: Initialization complete

## 5. Performance Bottlenecks

### Identified Issues

1. **Redundant Operations**:
   - Multiple calls to `getKnocks()` per render
   - Unnecessary re-renders on location updates
   - Duplicate sync attempts

2. **Inefficient Algorithms**:
   - O(n²) knock matching by location
   - Linear search through all knocks
   - No indexing for address lookup

3. **Unnecessary Re-renders**:
   - WebView recreating on prop changes
   - Map markers redrawing on any update
   - Stats recalculation on navigation

4. **Blocking Operations**:
   - Synchronous storage reads
   - GRIB2 processing on main thread
   - Large data transfers

### Optimization Opportunities

1. **Data Structure Improvements**:
   - Spatial indexing for knocks (R-tree)
   - Address-to-knock mapping
   - LRU cache for recent data

2. **Render Optimizations**:
   - React.memo for expensive components
   - useMemo for derived data
   - Virtualized lists for large datasets

3. **Async Improvements**:
   - Batch storage operations
   - Parallel data fetching
   - Progressive data loading

4. **Network Optimizations**:
   - Request debouncing
   - Response caching
   - Delta sync for updates

## 6. Critical Integration Points to Preserve

### Must Maintain

1. **Knock Data Structure**:
   - ID generation scheme
   - Location precision
   - History tracking
   - Sync status

2. **Storage Keys**:
   - AsyncStorage key names
   - Data format compatibility
   - Migration support

3. **API Contracts**:
   - Supabase schema
   - WebView message format
   - Proxy server endpoints

4. **User Experience**:
   - Offline functionality
   - Real-time updates
   - Map interaction patterns
   - Notification behavior

### Enhancement Areas

1. **Performance**:
   - Lazy loading
   - Incremental sync
   - Background processing
   - Memory management

2. **Scalability**:
   - Data pagination
   - Archive management
   - Team features
   - Multi-territory support

3. **Reliability**:
   - Error recovery
   - Data validation
   - Backup strategies
   - Monitoring

## Conclusion

The D2D Sales Tracker demonstrates a well-architected system with clear separation of concerns and comprehensive feature implementation. The 3-tier hail intelligence system provides industry-leading storm tracking capabilities, while the canvassing features offer a complete solution for field sales teams.

Key strengths include the offline-first design, real-time synchronization, and sophisticated data validation pipeline. Performance optimizations should focus on reducing redundant operations, implementing efficient data structures, and optimizing render cycles while maintaining the existing integration points and user experience.
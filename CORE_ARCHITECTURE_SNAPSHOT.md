# Core Architecture Snapshot - D2D Sales Tracker

## Executive Summary
This document serves as the definitive architectural reference for the D2D Sales Tracker app's core features. These specifications MUST be preserved during all optimization efforts.

## Core Features to Preserve

### 1. 3-Tier Hail Intelligence System

#### Tier 1: Real-Time MRMS (Multi-Radar Multi-Sensor)
```typescript
// Core Flow (PRESERVE EXACTLY)
MRMSService.fetchLatestData() 
  → ProcessHailData() 
  → GenerateContours() 
  → SendAlerts() 
  → UpdateMap()
```

**Critical Components**:
- 2-minute update interval
- Real-time storm progression tracking
- Auto-alerts for 1"+ hail
- Visual contour overlays
- WebSocket connections for live updates

#### Tier 2: Historical GRIB2 Archives
```typescript
// Processing Pipeline (PRESERVE)
GRIB2Service.downloadArchive()
  → ParseBinaryData()
  → ExtractHailParameters()
  → IndexByTerritory()
  → GenerateHeatMaps()
```

**Critical Components**:
- 24-48 hour processing window
- 12 months preprocessed data
- 4,995 hail reports indexed
- Territory-based analysis
- Customer presentation mode

#### Tier 3: Storm Events Validation
```typescript
// Validation Flow (PRESERVE)
StormEventsService.fetchWeeklyData()
  → MatchWithMRMSData()
  → CalculateAccuracy()
  → UpdateMLModel()
  → ImproveAlgorithms()
```

**Critical Components**:
- Weekly NOAA data pull
- Ground truth validation
- F1 score tracking
- Algorithm tuning feedback loop

### 2. Door-to-Door Canvassing System

#### Knock Recording (PRESERVE ALL 15 TYPES)
```typescript
const KNOCK_OUTCOMES = {
  // Sales Pipeline (4)
  lead: { emoji: '✅', color: '#10b981', category: 'pipeline' },
  inspected: { emoji: '🪜', color: '#3b82f6', category: 'pipeline' },
  callback: { emoji: '🔄', color: '#f59e0b', category: 'pipeline' },
  sale: { emoji: '📝', color: '#22c55e', category: 'pipeline' },
  
  // Primary Outcomes (4)
  not_home: { emoji: '👻', color: '#6b7280', category: 'primary' },
  convo: { emoji: '💬', color: '#3b82f6', category: 'primary' },
  no_soliciting: { emoji: '🚫', color: '#ef4444', category: 'primary' },
  not_interested: { emoji: '❌', color: '#991b1b', category: 'primary' },
  
  // Property Status (5)
  new_roof: { emoji: '👼', color: '#8b5cf6', category: 'property' },
  competitor: { emoji: '🏗️', color: '#dc2626', category: 'property' },
  renter: { emoji: '🧟', color: '#6366f1', category: 'property' },
  poor_condition: { emoji: '🏚️', color: '#78716c', category: 'property' },
  proposal_left: { emoji: '📋', color: '#0891b2', category: 'property' },
  
  // Actions (2)
  stay_away: { emoji: '👹', color: '#991b1b', category: 'action' },
  revisit: { emoji: '👀', color: '#3b82f6', category: 'action' }
};
```

#### Data Structure (IMMUTABLE)
```typescript
interface Knock {
  id: string;                    // UUID v4
  latitude: number;              // Decimal degrees
  longitude: number;             // Decimal degrees
  address?: string;              // Geocoded address
  outcome: KnockOutcome;         // One of 15 types
  notes?: string;                // Free text
  timestamp: Date;               // ISO 8601
  repId?: string;                // Sales rep ID
  syncStatus: 'pending' | 'synced' | 'failed';
  history?: KnockHistory[];      // Previous outcomes at location
}
```

#### Storage Architecture (PRESERVE)
```typescript
// Local Storage Keys
const STORAGE_KEYS = {
  KNOCKS: '@knocks',
  CLEARED_KNOCKS: '@cleared_knocks',
  LAST_SYNC: '@last_sync',
  DAILY_STATS: '@daily_stats_',
  SETTINGS: '@settings',
  DEVICE_ID: '@device_id'
};

// Cloud Schema (Supabase)
table knocks {
  id: uuid
  user_id: uuid
  local_id: string
  latitude: decimal
  longitude: decimal
  address: text
  outcome: enum
  notes: text
  created_at: timestamp
  updated_at: timestamp
}
```

### 3. Analytics System (PRESERVE ALL METRICS)

#### Real-Time Performance Metrics
```typescript
interface DailyStats {
  date: string;           // YYYY-MM-DD
  knocks: number;         // Total doors knocked
  contacts: number;       // Conversations had
  leads: number;          // Qualified leads
  sales: number;          // Closed sales
  revenue: number;        // Total revenue
  contactRate: number;    // contacts/knocks
  conversionRate: number; // sales/contacts
}
```

#### Visual Components
- 7-day trend charts (Chart.js)
- Outcome distribution pie chart
- Territory heat maps
- Performance KPI cards
- Stats bar overlay

### 4. Sync Architecture (CRITICAL)

#### Auto-Sync Service
```typescript
const SYNC_INTERVALS = {
  ACTIVE_USE: 30 * 1000,        // 30 seconds
  BACKGROUND: 5 * 60 * 1000,    // 5 minutes
  ON_APP_FOREGROUND: 0,         // Immediate
  ON_NETWORK_RECONNECT: 0,      // Immediate
  LOW_BATTERY: 30 * 60 * 1000,  // 30 minutes
};
```

#### Sync Flow (PRESERVE)
1. Local changes tracked in AsyncStorage
2. AutoSyncService monitors changes
3. Batch upload to Supabase
4. Conflict resolution (last-write-wins)
5. Mark local records as synced
6. Update sync timestamp

### 5. Map Integration (CORE INTERFACE)

#### WebView Bridge Messages
```typescript
// Outbound (React Native → WebView)
type OutboundMessage = 
  | { type: 'updateKnocks', knocks: Knock[] }
  | { type: 'updateUserLocation', lat: number, lng: number }
  | { type: 'updateHailContours', contourData: GeoJSON }
  | { type: 'updateVerifiedReports', reports: HailReport[] }
  | { type: 'centerOnUser' }
  | { type: 'toggleMapType' }
  | { type: 'focusOnHail' };

// Inbound (WebView → React Native)
type InboundMessage =
  | { type: 'mapReady' }
  | { type: 'mapClick', lat: number, lng: number }
  | { type: 'editKnock', knockId: string }
  | { type: 'clearKnock', knockId: string }
  | { type: 'console', message: string };
```

## Critical Integration Points

### 1. Service Dependencies
```
IntegratedHailIntelligence
  ├── MRMSService (Tier 1)
  ├── GRIB2Service (Tier 2)
  ├── StormEventsService (Tier 3)
  └── HailAlertService
  
StorageService
  ├── AsyncStorage (Local)
  ├── SupabaseService (Cloud)
  └── AutoSyncService
  
LocationService
  ├── expo-location
  └── Geocoding API
```

### 2. State Management Flow
```
User Action → Screen Component → Service Layer → Storage Layer
     ↑                                                    ↓
     └──────────── State Update ←─────────────────────────┘
```

### 3. Event System
- Location updates: 5-second interval
- Hail monitoring: 5-minute interval
- Sync triggers: Network/app state changes
- Map interactions: Touch events via WebView

## Performance Optimization Principles

### What CAN Be Optimized
1. **Algorithm Efficiency**
   - Replace O(n²) operations with O(n log n)
   - Implement spatial indexing for location queries
   - Use memoization for expensive calculations

2. **Rendering Performance**
   - Implement React.memo for pure components
   - Use FlatList for large lists
   - Virtualize map markers

3. **Data Management**
   - Implement caching strategies
   - Batch API calls
   - Use pagination for large datasets

4. **Async Operations**
   - Move heavy processing off main thread
   - Implement request debouncing
   - Use lazy loading

### What MUST NOT Change
1. **Data Structures** - All interfaces remain identical
2. **Storage Keys** - No changes to AsyncStorage keys
3. **API Contracts** - Supabase schema unchanged
4. **User Experience** - All 15 knock types available
5. **Business Logic** - Sync intervals, alert thresholds
6. **Visual Design** - Emojis, colors, layouts

## Testing Protocol

### Before Any Optimization
1. Create performance baseline metrics
2. Document current user flows
3. Record API response times
4. Measure render performance

### After Each Optimization
1. Verify all 15 knock types work
2. Test offline/online sync
3. Validate hail data accuracy
4. Check analytics calculations
5. Ensure map interactions unchanged

### Regression Tests Required
- [ ] All knock outcomes create correctly
- [ ] History preserved at each location
- [ ] Sync works in all network conditions
- [ ] Hail alerts fire at correct thresholds
- [ ] Analytics match expected values
- [ ] Map markers display with correct emojis
- [ ] Clear function preserves cloud data

## Migration Strategy

### Phase 1: Performance Profiling
- Identify bottlenecks without changing code
- Document baseline metrics
- Create optimization priority list

### Phase 2: Non-Breaking Optimizations
- Algorithm improvements
- Caching implementation
- Render optimizations

### Phase 3: Architecture Refactoring
- Implement provider patterns
- Create abstraction layers
- Maintain backward compatibility

### Phase 4: Validation
- Complete regression testing
- Performance comparison
- User acceptance testing

---

**This document is the source of truth for all optimization efforts. Any changes to core functionality must be explicitly approved and documented.**
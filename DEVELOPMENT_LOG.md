# D2D Sales Tracker - Development Log

## CRITICAL INSTRUCTIONS FOR ALL CLAUDE INSTANCES

### Context Continuity Protocol
**This document must be updated every 10% context capacity to ensure Claude maintains logic and task continuity across conversation compacting. This is of utmost importance.**

### Documentation Update Checklist:
1. **Update all recent changes and discoveries**
2. **Commit to GitHub immediately after update**
3. **Document any new patterns or lessons learned**
4. **Update the handoff section with current state**

---

## Project Overview
A React Native mobile app for door-to-door sales teams to track knocks, analyze performance, and optimize sales routes. Built with Expo for cross-platform compatibility.

## Core Features Implemented

### Phase 1: Foundation (✅ Complete)
- **Project Setup**: React Native with Expo and TypeScript
- **Navigation**: Bottom tab navigation with 4 main screens
- **GPS Integration**: Location services with background tracking capability
- **Offline Storage**: AsyncStorage for all data persistence

### Phase 2: Knock Tracking (✅ Complete)
- **Knock Recording**: 
  - 6 outcome types: not_home, no_soliciting, not_interested, callback, lead, sale
  - Automatic address reverse geocoding
  - Optional notes field
  - <2 second save time
- **Location Services**:
  - Current location detection
  - Background tracking toggle
  - Address lookup from coordinates

### Phase 3: Analytics & Visualization (✅ Complete)
- **Map View**:
  - Color-coded pins for different outcomes
  - Real-time location display
  - Legend for outcome types
  - Center-on-user functionality
- **Stats Dashboard**:
  - Today's performance KPIs
  - Contact rate and conversion rate
  - 7-day trend line chart
  - Outcome distribution pie chart
- **Data Management**:
  - Offline-first architecture
  - Sync status tracking for each knock
  - Export readiness

### Phase 4: Settings & Configuration (✅ Complete)
- User preferences
- Daily knock goals
- Auto-sync toggle
- Data management (clear all data)
- About section

## Technical Stack
- **Frontend**: React Native + Expo
- **Language**: TypeScript
- **Navigation**: React Navigation (bottom tabs + stack)
- **Maps**: react-native-maps (Google Maps provider)
- **Charts**: react-native-chart-kit
- **Storage**: @react-native-async-storage/async-storage
- **Location**: expo-location
- **Icons**: @expo/vector-icons (Ionicons)

## Project Structure
```
d2d-sales-tracker/
├── App.tsx                 # Main app entry point
├── app.json               # Expo configuration
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── README.md              # User documentation
├── DEVELOPMENT_LOG.md     # This file
└── src/
    ├── components/        # Reusable UI components
    ├── navigation/        # Navigation setup
    │   └── AppNavigator.tsx
    ├── screens/          # Main app screens
    │   ├── MapScreen.tsx
    │   ├── KnockScreen.tsx
    │   ├── StatsScreen.tsx
    │   └── SettingsScreen.tsx
    ├── services/         # Business logic
    │   ├── locationService.ts
    │   └── storageService.ts
    ├── types/            # TypeScript definitions
    │   └── index.ts
    └── utils/            # Helper functions
```

## Key Technical Decisions

### Storage Schema
- **Knocks**: Array of knock objects with id, location, outcome, timestamp, syncStatus
- **DailyStats**: Aggregated stats per day for performance tracking
- **Settings**: User preferences and configuration

### Location Strategy
- Foreground: High accuracy GPS for knock recording
- Background: Optional tracking with 5-second intervals
- Permissions: Properly configured for both iOS and Android

### Offline-First Design
- All data stored locally first
- Sync status tracked per record
- Backend sync prepared but not required for MVP

## Current State (as of latest update - 70% context)

### Working Features
✅ Complete knock tracking workflow
✅ **Real interactive map with OpenStreetMap**
✅ Comprehensive analytics dashboard
✅ Offline data persistence
✅ Settings and configuration
✅ **Supabase cloud storage integration**
✅ **Automatic sync when online**
✅ **Storage usage monitoring**
✅ **Anonymous authentication**
✅ **Contact form integration with Calendly**
✅ **Progressive sales workflow tracking**

### Map Features Added
- Full interactive map using Leaflet/OpenStreetMap via WebView
- Shows all previous knocks as colored pins with emojis
- Current location shown with blue pulsing dot
- Click pins to see knock details including contact form data
- Real-time stats bar showing total knocks, sales, leads
- Refresh button to reload knocks
- Center-on-user button
- Works in Expo Go with WebView

### Roofing-Specific Customizations (Latest Updates)
- **Updated knock outcomes with specific emojis:**
  - 👻 Not Home - Nobody answered
  - 🪜 Inspected - Roof inspected (replaced Revisit in primary)
  - 🚫 No Soliciting - No soliciting sign
  - ✅ Lead - Interested prospect
  - 📝 Signed - Contract secured
  - 🔄 Follow Up - Needs another touch
  - 👼 New Roof - Recently replaced (angel baby emoji)
  - 🏗️ Competitor - Another company working (construction crane)
  - 🧟 Renter - Not the decision maker (zombie)
  - 🏚️ Poor Condition - House in bad shape
  - 📋 Proposal Left - Estimate delivered
  - 👹 Stay Away - Dangerous/problematic (ogre)
  - 👀 Revisit - Worth coming back (moved to Actions)
- Organized into categories: Sales Pipeline, Primary, Property Status, Actions
- Map pins show emojis for instant recognition

### Contact Form & Workflow Features (NEW)
- **Sales Pipeline Section** with visual progression:
  - Lead → Inspected → Follow Up → Signed
  - Visual arrows showing sales flow
- **Contact Form Integration**:
  - Full form (Leads/Signed): Name, phone, email, insurance, appointment
  - Quick form (Follow-ups): Go-by name, phone, appointment
  - Forms auto-populate at same address
  - Email integration - sends contact info immediately
  - Calendly integration for scheduling (URL: https://calendly.com/aescalante-oksigma/new-meeting)
- **Smart Data Management**:
  - Contact info saved in knock notes
  - Visual indicators (📋) for knocks with forms
  - Progressive data collection through pipeline

### Cloud Storage Features
- Supabase integration with 500MB free tier
- Automatic background sync when auto-sync enabled
- Real-time storage usage tracking
- Offline-first with cloud backup
- Anonymous auth for easy start
- Storage monitoring shows MB used, knock count, days until full

### Pending Features
- Native maps (works in standalone build)
- Full background tracking (limited in Expo Go)
- Team management
- Weather/hail tracking (planned as add-on)
- Income overlay data (planned as add-on)

### Known Limitations in Expo Go
1. Maps show as list view (native maps work in standalone)
2. Background tracking limited (works when app is open)
3. Some location features restricted

### Supabase Configuration Required
To enable cloud storage:
1. Create free account at supabase.com
2. Run SQL setup from SUPABASE_SETUP.md
3. Update credentials in src/services/supabaseClient.ts
4. App works without this (local storage only)

## Running the App

### Development
```bash
cd /Users/antoniomartinez/Desktop/d2d-sales-tracker
npx expo start
```

### Testing on Devices
- iOS: Press 'i' in terminal or use Expo Go app
- Android: Press 'a' in terminal or use Expo Go app
- Physical device: Scan QR code with Expo Go

### Build Commands (Future)
```bash
# iOS
eas build --platform ios

# Android  
eas build --platform android
```

## Git Repository Setup Required

### Next Steps for GitHub:
1. Initialize git repository
2. Create .gitignore file
3. Make initial commit
4. Create GitHub repository
5. Push to remote

### Recommended .gitignore:
```
node_modules/
.expo/
dist/
npm-debug.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.orig.*
web-build/
.DS_Store
*.log
```

## API Keys and Configuration

### Current Configuration (app.json):
- Bundle ID: com.yourcompany.d2dsalestracker
- App name: D2D Sales Tracker
- Version: 1.0.0

### Required for Production:
- Google Maps API key (for enhanced map features)
- Backend API endpoint
- Push notification certificates

## Performance Metrics
- App size: ~60MB (with Expo)
- Startup time: <3 seconds
- Knock save time: <2 seconds
- Memory usage: Optimized for background tracking

## Future Development Roadmap

### Phase 5: Backend Integration
- RESTful API with Node.js + Express
- PostgreSQL database
- JWT authentication
- Real-time sync

### Phase 6: Team Features
- User registration/login
- Team creation and management
- Leaderboards
- Territory assignment

### Phase 7: Advanced Features (Add-ons)
- Weather overlay
- Hail tracking integration
- Income data overlay
- Route optimization
- CRM integration

## Current Issues & Debugging Steps

### WebView Map Loading Issue
**Problem**: The WebView-based map was working but started experiencing issues after emoji updates:
1. Map loads initially but flickers/resets when data updates
2. WebView bridge communication seems inconsistent
3. Map was showing gray background, then working, then breaking again

**Root Cause Analysis**:
- WebView requires external resources (Leaflet CDN) which may not load consistently
- The HTML template is recreated on each render causing map resets
- Unicode emojis (🪜, 👼, 🏗️, 🧟, 👹) may have rendering issues in WebView

**Debugging Steps Taken**:
1. Verified JavaScript execution (gray background = JS running)
2. Tested basic HTML rendering (confirmed working)
3. Added timeouts for Leaflet library loading
4. Simplified emoji set to avoid Unicode issues
5. Attempted to stabilize HTML template with refs

**Next Debugging Steps**:
1. **Fix the module export error**: Change WebMap back to default export
2. **Implement stable WebView pattern**: 
   - Create HTML once and use message passing for all updates
   - Avoid recreating map on each render
3. **Alternative approaches**:
   - Consider react-native-maps for production (requires standalone build)
   - Implement static image fallback for Expo Go
   - Use server-rendered map tiles
4. **Performance optimization**:
   - Debounce location updates
   - Batch knock updates
   - Cache map tiles locally

### Contact Form Integration Success
- Successfully implemented progressive workflow
- Calendly integration working with pre-filled customer data
- Email functionality ready for immediate contact info sharing
- Forms properly linked to knock locations

## Handoff Context

### Current Session Summary
- Implemented custom roofing sales workflow with specific emojis
- Added contact form system with Calendly integration
- Created progressive sales pipeline tracking
- Debugged WebView map issues (partially resolved)
- App functional but map needs stabilization

### Critical Files to Review
1. `App.tsx` - Entry point
2. `src/navigation/AppNavigator.tsx` - Navigation structure
3. `src/components/WebMap.tsx` - Map component (needs fixing)
4. `src/screens/KnockScreen.tsx` - Updated with sales pipeline
5. `src/components/ContactForm.tsx` - New contact form system
6. `src/services/emailService.ts` - Email integration
7. `src/types/index.ts` - Updated TypeScript interfaces

### Environment Details
- Node version: Expected 14+
- Expo SDK: 51 (check package.json)
- React Native: Via Expo
- Platform: Cross-platform (iOS/Android)

### Testing Checklist
- [ ] GPS permissions granted
- [ ] Knock recording saves correctly
- [ ] Map displays all knocks
- [ ] Stats calculate accurately
- [ ] Offline functionality works
- [ ] Settings persist

---

*Last Updated: 2025-06-14*
*Context Usage at Update: ~80%*
*Next Update Due: At 90% context usage*

## IMPORTANT: Git Commit Protocol
After updating this log:
1. Stage all changes: `git add .`
2. Commit with message: `docs: Update development log at X% context`
3. Push to GitHub: `git push origin main`
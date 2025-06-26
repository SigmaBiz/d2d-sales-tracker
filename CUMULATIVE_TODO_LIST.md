# Cumulative TODO List - D2D Sales Tracker

## Prioritized Tasks by Impact/Time Ratio
*Last Updated: June 26, 2025*

### Ranking Methodology
- Impact weighted higher than time investment
- Score = (Impact × 0.7) + ((10 - Time) × 0.3)
- Focus on user-visible improvements and performance gains

---

## Complete Ranked List

### 🥇 **1. Remove console.logs for production**
- **Impact**: 7/10 (Immediate performance boost, cleaner logs)
- **Time**: 1/10 (30 minutes - simple find/replace)
- **Score**: 8.5/10
- **Why**: 
  - Each console.log call has overhead, especially in tight loops or frequent renders
  - Reduces JavaScript bundle size (string literals take space)
  - Prevents sensitive data from appearing in production logs
  - Can use environment variables to conditionally include logs: `__DEV__ && console.log(...)`
  - Mobile devices have limited resources - every optimization counts

### 🥈 **2. Real-time WebView updates** ⭐ SELECTED
- **Impact**: 8/10 (Major UX improvement - no refresh needed)
- **Time**: 3/10 (2-3 hours - modify update logic)
- **Score**: 7.5/10
- **Why**:
  - Current behavior: User updates a knock → navigates back → marker shows old emoji until refresh
  - Solution: When knock updates, immediately send message to WebView to update that specific marker
  - Improves user confidence - they see changes instantly
  - Reduces support issues ("my changes aren't saving!")
  - Implementation: Add a `updateSingleKnock` WebView method that updates just one marker without full reload

### 🥉 **3. Minimize WebView HTML/CSS** ⭐ SELECTED
- **Impact**: 6/10 (Faster initial load)
- **Time**: 2/10 (1-2 hours - minify, remove unused styles)
- **Score**: 7/10
- **Why**:
  - Current HTML includes full Leaflet CSS, custom styles, and inline JavaScript
  - Can reduce by 30-50% through minification and removing comments/whitespace
  - Faster parsing = faster time to interactive map
  - Mobile networks are often slow - smaller payload helps
  - Consider: Inline critical CSS, lazy load non-essential features

### 4. **Production error boundaries**
- **Impact**: 7/10 (Prevents app crashes, better user experience)
- **Time**: 3/10 (2-3 hours - wrap components)
- **Score**: 6.5/10
- **Why**:
  - Currently, a JavaScript error in WebView could crash the entire map
  - Error boundaries catch errors and show fallback UI ("Map unavailable, tap to retry")
  - Prevents bad data from one knock from breaking all knocks
  - Can log errors to crash reporting service (Sentry, Bugsnag)
  - Critical for field reps who can't afford app crashes during sales

### 5. **Measure actual load times**
- **Impact**: 5/10 (Provides metrics but no direct improvement)
- **Time**: 2/10 (1-2 hours - add timing code)
- **Score**: 6/10
- **Why**:
  - Can't improve what you don't measure
  - Add performance marks: map init, first render, all markers loaded, interactive
  - Compare against <1 second goal
  - Identify which phase is slowest (WebView init? Marker rendering? Data loading?)
  - Use React Native's Performance API or custom timing

### 6. **Viewport culling** ⭐ SELECTED
- **Impact**: 9/10 (Huge performance gain with many markers)
- **Time**: 6/10 (1-2 days - complex implementation)
- **Score**: 5.5/10
- **Why**:
  - Currently renders ALL markers even if zoomed into small area
  - With 1000+ knocks, this causes lag and memory issues
  - Solution: Only render markers within current map bounds + buffer
  - Update markers when map pans/zooms
  - Can handle 10x more data with same performance
  - Critical for scaling to larger sales teams/territories

### 7. **Create IMapProvider interface**
- **Impact**: 8/10 (Enables Google Maps swap)
- **Time**: 6/10 (1-2 days - architecture change)
- **Score**: 5/10
- **Why**:
  ```typescript
  interface IMapProvider {
    addMarker(knock: Knock): void;
    updateMarker(knock: Knock): void;
    removeMarker(id: string): void;
    setView(lat: number, lng: number, zoom: number): void;
    // ... other methods
  }
  ```
  - Abstracts map implementation from business logic
  - Swap OSM ↔ Google Maps by changing one line
  - Enables A/B testing different map providers
  - Future-proofs against map provider changes
  - Makes testing easier (can mock map provider)

### 8. **Differential updates** ⭐ SELECTED
- **Impact**: 7/10 (Smoother updates, less data transfer)
- **Time**: 5/10 (1 day - modify update logic)
- **Score**: 5/10
- **Why**:
  - Currently sends ALL knocks to WebView on every update
  - With 1000 knocks × 500 bytes each = 500KB per update
  - Differential: Send only changed/new/deleted knocks
  - Reduces WebView message parsing overhead
  - Smoother animations (markers don't flicker)
  - Enables real-time collaboration features

### 9. **Tile caching**
- **Impact**: 6/10 (Offline support, faster loads)
- **Time**: 5/10 (1 day - implement caching layer)
- **Score**: 4.5/10
- **Why**:
  - Field reps often work in areas with poor cell coverage
  - Cache map tiles for visited areas
  - Use React Native's AsyncStorage or file system
  - Implement cache expiration (7-30 days)
  - Reduces data usage (important for field reps)
  - Faster map loads in frequently visited areas

### 10. **Performance monitoring setup**
- **Impact**: 4/10 (Insights but no direct improvement)
- **Time**: 3/10 (Few hours - integrate service)
- **Score**: 4.5/10
- **Why**:
  - Track real-world performance across different devices
  - Monitor: Map load time, memory usage, crash rate
  - Set up alerts for performance regressions
  - Identify patterns (certain Android versions slower?)
  - Use tools like Firebase Performance or custom analytics
  - Data drives optimization decisions

### 11. **Comprehensive tests**
- **Impact**: 5/10 (Code quality, regression prevention)
- **Time**: 7/10 (2-3 days - write test suite)
- **Score**: 3/10
- **Why**:
  - Prevent regressions when adding new features
  - Test critical paths: knock creation, updates, sync
  - Unit tests for data transformations
  - Integration tests for map provider interface
  - E2E tests for complete user flows
  - Enables confident refactoring
  - Required for enterprise customers

---

## Current Implementation Plan

### Selected Tasks (In Order of Implementation)
1. **Minimize WebView HTML/CSS** (1-2 hours)
2. **Real-time WebView updates** (2-3 hours)
3. **Differential updates** (1 day)
4. **Viewport culling** (1-2 days)

### Completed Tasks ✅
- Phase 1: Performance Baseline
- Phase 2: Quick Wins (Clustering, Loading States)
- Invisible Knocks Bug (Fixed via data cleanup)
- Cloud Sync & Deletion
- Knock Update Timestamp Preservation
- WebView Marker Visual Updates

### Original Sprint Groupings

#### 🚀 **Quick Wins Sprint** (1 day)
1. Remove console.logs for production
2. Minimize WebView HTML/CSS  
3. Measure actual load times

#### 🎯 **UX Enhancement Sprint** (2-3 days)
4. Real-time WebView updates
5. Production error boundaries
6. Performance monitoring setup

#### 🏗️ **Architecture Sprint** (1 week)
7. Create IMapProvider interface
8. Viewport culling
9. Differential updates

#### 📦 **Polish Sprint** (as time permits)
10. Tile caching
11. Comprehensive tests

---

*This document serves as the master TODO list for the D2D Sales Tracker OpenStreetMap optimization project.*
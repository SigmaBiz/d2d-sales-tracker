# Location Matching Update - 15 Feet Implementation

## What Changed
We've updated the location matching precision from 36 feet to 15 feet based on research and practical considerations.

### Research Findings:
- Typical suburban houses have 5-10 foot side yard setbacks
- Houses are typically 10-20 feet apart (side to side)
- 15 feet is the optimal middle ground
- GPS accuracy is ~10-15 feet anyway

### Technical Changes:
1. **StorageServiceOptimized** now uses:
   - `0.00004 degrees` (≈15 feet) instead of `0.0001 degrees` (≈36 feet)
   - Configurable precision for different scenarios

2. **Files Updated**:
   - Created `StorageServiceOptimized.ts` with new precision
   - Created `storageServiceWrapper.ts` for easy toggling
   - Updated imports in optimized components

## How It Works Now

### When Optimization is ON (current setting):
- Houses must be within 15 feet to be considered "same location"
- Adjacent houses in typical neighborhoods can now be tagged separately
- GPS drift won't create duplicate entries

### When Optimization is OFF:
- Original 36-foot radius applies
- Some adjacent houses might be considered same location

## Testing the Change

1. Find a street with houses close together
2. Try to knock on two adjacent houses
3. You should now be able to tag both separately
4. Verify that knocking the same house updates the existing record

## Benefits

✅ **Works in Dense Neighborhoods** - Can now tag row houses, townhomes
✅ **GPS Accuracy Aligned** - 15 feet matches typical GPS precision
✅ **Prevents Duplicates** - Same house still tracked as one location
✅ **Configurable** - Can adjust for different area types if needed

## Core Functionality Preserved

- ✅ One tag per location system intact
- ✅ History tracking unchanged
- ✅ All 15 knock types work
- ✅ Analytics remain accurate
- ✅ Cloud sync unaffected

## Future Enhancement

We discussed adding unit/apartment support for multi-unit buildings:
```typescript
interface Knock {
  // ... existing fields
  unit?: string;  // "Apt 2B", "Suite 100"
  propertyType?: 'single' | 'multi' | 'commercial';
}
```

This would allow multiple knocks at the same GPS coordinates when units differ.
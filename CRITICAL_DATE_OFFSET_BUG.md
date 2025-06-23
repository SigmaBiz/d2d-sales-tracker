# 🚨 CRITICAL: Off-by-One Date Bug in MRMS Preprocessing 🚨

**Date Discovered**: 2025-06-23  
**Feature**: Tier 2 Historical Storm Data (MRMS Preprocessing)  
**Severity**: HIGH - All historical data is mislabeled by one day  
**Status**: CONFIRMED - Needs immediate fix  

## The Problem

All preprocessed MRMS data has dates that are off by one day. When users search for storms on May 17th, they get May 18th's data. When they search for May 18th, they get May 19th's data, and so on.

## Evidence

### Manual Verification Results:
```bash
# Checking MRMS archive files directly:
May 18 file (20250518-000000.grib2): 58 reports
May 19 file (20250519-000000.grib2): 725 reports  
May 20 file (20250520-000000.grib2): 93 reports
```

### What We Currently Have Saved:
```bash
# Our preprocessed JSON files show:
May 17: 0 reports     ❌ WRONG (should be 58)
May 18: 58 reports    ❌ WRONG (should be 725)
May 19: 725 reports   ❌ WRONG (should be 93)
May 20: 93 reports    ❌ WRONG (should be next day's data)
```

## How MRMS Files Work (CRITICAL TO UNDERSTAND)

1. **File Naming**: `MESH_Max_1440min_00.50_20250518-000000.grib2.gz`
   - This file is dated May 18, 2025 at 00:00:00

2. **Data Coverage**: 
   - Contains 24-hour maximum values ENDING at the file's timestamp
   - May 18 00:00 file covers: May 17 00:00 to May 18 00:00
   - **Therefore: May 18 file = May 17's storms**

3. **Current Bug**:
   - We fetch May 18's file (correct)
   - It contains May 17's storms (correct)
   - But we save it as May 18 data (WRONG!)

## The Fix Required

### Option 1: Fix at Preprocessing (Recommended)
```javascript
// When user requests May 17:
// 1. Fetch May 18 file (current behavior - correct)
// 2. Save data as May 17 (needs fix - currently saves as May 18)
```

### Option 2: Fix at API Level
```javascript
// When user requests May 17:
// Return data from May 18 JSON file
// (Not recommended - confusing)
```

## Implementation Steps

1. **Fix the preprocessing script**:
   - The script correctly fetches `date+1` file
   - But it needs to save the data with the original requested date
   - NOT with the file's date

2. **Re-run preprocessing for all 372 dates**

3. **Test verification**:
   ```bash
   # May 17 should have 58 reports (from May 18 file)
   # May 18 should have 725 reports (from May 19 file)
   # May 19 should have 93 reports (from May 20 file)
   ```

## Critical Code Section to Fix

In `preprocess-background.js` and `preprocess-all.js`:

```javascript
// CURRENT BEHAVIOR (WRONG):
const nextDate = new Date(dateStr);
nextDate.setDate(nextDate.getDate() + 1);
// Fetches next day's file (correct)
// But saves with nextDate label (wrong!)

// CORRECT BEHAVIOR:
const dataDate = dateStr; // The date we want data for
const fileDate = new Date(dateStr);
fileDate.setDate(fileDate.getDate() + 1); // The file to fetch
// Fetch fileDate's file
// Save data with dataDate label
```

## DO NOT GET CONFUSED

- **File Date**: The date in the filename (e.g., May 18)
- **Data Date**: The date the storms occurred (e.g., May 17)
- **Rule**: File Date = Data Date + 1

## Verification Command

After fixing, verify with:
```bash
# Check that May 17 has the 58 reports from May 18's file
jq '.reports | length' preprocessed/2025-05-17.json
# Should output: 58 (not 0)
```

## Impact

- All 372 preprocessed files have wrong dates
- Every user search returns data from the wrong day
- TestFlight launch blocked until fixed

---

**REMEMBER**: The MRMS 24-hour maximum file contains data from the PREVIOUS day. Always fetch tomorrow's file for today's storms!
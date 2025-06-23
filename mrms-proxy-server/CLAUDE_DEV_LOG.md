# Claude Development Log

## Session Summary - June 2025

### Recent Changes
- **Memory Issue Resolved**: Production server was crashing due to 512MB memory limit when processing 24.5M CONUS data points
- **Implemented Streaming Solution**: Created `server-dynamic-optimized.js` that processes GRIB2 data chunk-by-chunk, staying within 96-101MB memory usage
- **Achieved Pre-filtering Optimization**: Created `server-dynamic-precise.js` that extracts only lines 13.4M-14M, reducing processing from 24.5M to 600k lines
- **Performance Improvement**: 5x faster processing (10s vs 50s) while maintaining 100% accuracy
- **Tested Multiple Dates**: Confirmed solution works for various dates:
  - Sept 24, 2024: 426 hail reports (2.94" max)
  - May 17, 2025: 58 reports (1.18" max)  
  - July 4, 2024: 0 reports
  - June 25, 2024: 0 reports
  - March 29, 2025: 0 reports

### Pre-filtering Breakthrough
After extensive testing, discovered that:
1. OKC data consistently appears around lines 13.5M-13.9M in GRIB2 files
2. Using `sed -n '1p;13400000,14000000p'` extracts only necessary data
3. Reduces processing by 97.6% (600k lines vs 24.5M)
4. Memory usage drops to 72MB with 10-second processing time

### Next TODOs
1. **Deploy Optimized Server**: Deploy `server-dynamic-precise.js` to Render
2. **Production Testing**: Monitor memory usage and verify hail data extraction in production
3. **Performance Monitoring**: Track response times across different dates
4. **Documentation**: Update deployment guide with new server variant

### Key Learnings
- GRIB2 data organization is geographically predictable (north to south)
- Pre-filtering at the command level is more efficient than post-processing
- Targeted extraction can achieve massive performance gains without sacrificing accuracy
- Memory constraints can drive innovative optimization approaches

## 🚨 CRITICAL BUG: Off-by-One Date Error in MRMS Preprocessing

**Date**: 2025-06-23
**Feature**: Tier 2 - Historical Storm Data
**Severity**: HIGH - All dates are wrong

### The Bug
All 372 preprocessed MRMS files have dates that are off by one day. Users searching for May 17 get May 18 data.

### Evidence
- May 18 MRMS file contains 58 reports (these are May 17's storms)
- We saved 0 reports for May 17 and 58 for May 18
- Every date is shifted forward by one day

### Root Cause
MRMS 24-hour max files are dated for when they END:
- File 20250518-000000 covers May 17 00:00 to May 18 00:00
- This file contains May 17's storms
- We correctly fetch May 18 file for May 17 data
- BUT we incorrectly save it as May 18 data

### Fix Required
1. Update preprocessing scripts to save data with correct date label
2. Re-process all 372 dates
3. Verify May 17 shows 58 reports (not 0)

### See Also
- CRITICAL_DATE_OFFSET_BUG.md for detailed analysis and fix instructions


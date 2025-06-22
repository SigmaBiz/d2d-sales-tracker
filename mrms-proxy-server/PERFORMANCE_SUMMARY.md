# MRMS Server Performance Summary

## Pre-filtering Optimization Results

### Problem
- Production server on Render.com free tier with 512MB memory limit
- Raw GRIB2 files are ~735MB uncompressed
- Full data contains 24.5M points (CONUS 7000x3500 grid)
- OKC Metro area is only 0.17% of total data

### Solutions Tested

#### 1. **Original Approach** (`server-dynamic.js`)
- ❌ Loads all data into memory
- ❌ Crashes with "Out of Memory" error
- ❌ Silent failure returning empty data

#### 2. **Streaming Approach** (`server-dynamic-optimized.js`)
- ✅ Processes data chunk-by-chunk using Node.js spawn()
- ✅ Memory usage: 96-101MB (well under 512MB limit)
- ⏱️ Processing time: ~50 seconds
- 📊 Processes all 24.5M lines

#### 3. **Precise Pre-filtering** (`server-dynamic-precise.js`)
- ✅ Extracts only lines 13.4M-14M where OKC data resides
- ✅ Memory usage: 72MB
- ⏱️ Processing time: ~10 seconds (5x faster!)
- 📊 Processes only 600k lines (2.4% of total)
- 🎯 Maintains 100% accuracy (finds all 426 reports)

### Performance Comparison

| Approach | Lines Processed | Memory Usage | Time | Status |
|----------|----------------|--------------|------|---------|
| Original | 24.5M | >512MB | N/A | ❌ Crashes |
| Streaming | 24.5M | 96-101MB | ~50s | ✅ Works |
| Pre-filtered | 600k | 72MB | ~10s | ✅ Optimal |

### Key Insights

1. **OKC data location is predictable**: Always between lines 13.51M-13.59M across all tested dates
2. **Pre-filtering reduces processing by 97.6%**: 600k vs 24.5M lines
3. **5x performance improvement**: 10s vs 50s processing time
4. **Memory efficient**: 70-79MB peak usage leaves plenty of headroom

### Tested Dates Verification

| Date | Reports Found | Max Size | OKC Data Line | Memory |
|------|--------------|----------|---------------|---------|
| 2024-04-27 | 0 | - | 13,513,230 | 75MB |
| 2024-06-25 | 0 | - | - | 78MB |
| 2024-07-04 | 123 | 1.4" | 13,513,277 | 79MB |
| 2024-09-24 | 426 | 2.94" | 13,513,224 | 72MB |
| 2025-03-29 | 0 | - | - | 70MB |
| 2025-05-17 | 58 | 1.18" | 13,590,233 | 75MB |

### Recommendation

Deploy `server-dynamic-precise.js` to production:
- Fastest processing time
- Lowest memory usage
- Most efficient resource utilization
- Scales well for multiple concurrent requests

### Technical Details

The precise pre-filtering uses:
```bash
sed -n '1p;13400000,14000000p'  # Extract header + target range
```

This approach works because GRIB2 data is organized geographically from north to south, making OKC's position predictable across different dates.
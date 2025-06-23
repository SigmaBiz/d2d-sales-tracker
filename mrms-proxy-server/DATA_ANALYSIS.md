# MRMS GRIB2 Data Analysis for OKC Metro

## Data Structure

### File Characteristics
- **Grid**: 7000 x 3500 = 24.5 million data points
- **Coverage**: Entire CONUS (Continental US)
- **File Size**: ~500KB compressed, ~500KB uncompressed (highly compressed due to many zeros)
- **Format**: GRIB2 with PNG packing
- **Parameter**: MESH (Maximum Expected Size of Hail) in millimeters

### Geographic Layout
```
Grid corners (from grib_ls):
- First point: 54.995°N, 230.005°E (Northwest corner)
- Last point: 20.005°N, 299.995°E (Southeast corner)
- Grid spacing: ~0.01° (approximately 1km)
```

### OKC Metro Location in Grid
- **OKC Bounds**: 35.1-35.7°N, 262.2-262.9°E (in GRIB 0-360 format)
- **Approximate position**: Lines 13.4M to 14M (determined empirically)
- **Data points for OKC**: ~4,200 out of 24.5M (0.17%)

## Data Patterns

### Line Distribution
```
Lines 1-13.4M: Northern US states (mostly zeros for hail)
Lines 13.4M-14M: Oklahoma latitude band (contains OKC data)
Lines 14M-24.5M: Southern states and ocean (mostly zeros)
```

### Why So Many Zeros?
- Hail is a rare event - most grid points have 0mm hail
- Ocean areas have no hail data
- This explains the high compression ratio

## Processing Approaches Tested

### 1. Full Dataset Processing
- **Command**: `grib_get_data file.grib2`
- **Result**: Loads all 24.5M points into memory
- **Memory**: >512MB
- **Status**: FAILS on Render

### 2. Post-filtering with AWK
- **Command**: `grib_get_data file.grib2 | awk 'filter'`
- **Result**: Still loads full dataset before filtering
- **Memory**: >512MB initially
- **Status**: FAILS on Render

### 3. Line-based Extraction (Skip)
- **Command**: `grib_get_data file.grib2 | tail -n +13400000 | head -n 600000`
- **Local Result**: Works! 70MB memory, 10 seconds
- **Render Result**: Process killed
- **Issue**: Even tail/head consume too much memory in container

### 4. ecCodes Constraints
- **Command**: `grib_get_data -w "latitude>=35.1" file.grib2`
- **Result**: Constraint not supported for this file format
- **Status**: Not viable

### 5. Geographic Filtering
- **Command**: `grib_filter` with rules
- **Result**: Returns 0 data
- **Status**: Implementation issue or format incompatibility

## Key Insights

1. **The data is highly structured** - OKC is always in the same line range
2. **Most of the file is zeros** - We're extracting signal from noise
3. **Memory spike happens during initial load** - Before any filtering
4. **Container kills processes proactively** - Not just at 512MB limit

## What We Need

A way to extract lines 13.4M-14M without:
- Loading the entire file into memory
- Using commands that buffer large amounts of data
- Triggering container memory protection

## Potential Solutions

### A. Direct Binary Reading
- Skip ecCodes entirely
- Read GRIB2 binary structure
- Seek directly to byte offset for OKC data

### B. Pre-processed Index
- Create an index file with byte offsets
- Use the index to seek directly to OKC data

### C. Streaming with Constraints
- Process in very small chunks
- Never hold more than a few MB in memory

### D. Different Data Source
- Find if NOAA provides regional subsets
- Use a different data product with less coverage

## Questions for Render

1. What is the actual memory limit enforcement?
2. Is there a way to stream process large files?
3. Are there CPU/time limits in addition to memory?
4. What tools are optimized for their container environment?
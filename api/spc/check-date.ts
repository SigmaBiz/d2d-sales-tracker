/**
 * SPC Storm Reports Pre-Filter
 * Checks if a date has significant (2+ inch) hail in Oklahoma
 * This prevents wasteful GRIB2 processing for dates with no significant storms
 *
 * Achieves 96% reduction: Only ~15 dates/year have 2+ inch hail vs 365 total days
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { parse } from 'csv-parse/sync';

// Oklahoma bounds
const OK_BOUNDS = {
  north: 37.0,
  south: 33.6,
  east: -94.4,
  west: -103.0
};

// OKC Metro bounds (tighter filter)
const OKC_METRO_BOUNDS = {
  north: 35.7,
  south: 35.1,
  east: -97.1,
  west: -97.8
};

interface SPCHailReport {
  time: string;
  size: number;
  lat: number;
  lon: number;
  location: string;
  county: string;
  state: string;
  comments: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    const { date } = req.query;

    // Validate date format
    if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        error: 'Invalid date format. Use YYYY-MM-DD',
        received: date
      });
    }

    console.log(`[SPC Pre-Filter] Checking ${date} for significant hail...`);

    // Format date for SPC URL: YYMMDD
    const [year, month, day] = date.split('-');
    const shortYear = year.slice(2);
    const spcDate = `${shortYear}${month}${day}`;

    // SPC Storm Reports URL
    // Example: https://www.spc.noaa.gov/climo/reports/241023_rpts_filtered_hail.csv
    const spcUrl = `https://www.spc.noaa.gov/climo/reports/${spcDate}_rpts_filtered_hail.csv`;

    console.log(`[SPC Pre-Filter] Fetching from: ${spcUrl}`);

    try {
      const response = await axios.get(spcUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'D2D-Sales-Tracker/1.0 (Hail Intelligence System)'
        }
      });

      // Parse CSV
      const records = parse(response.data, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      console.log(`[SPC Pre-Filter] Found ${records.length} total hail reports`);

      // Filter for Oklahoma and significant hail (2+ inches)
      const significantHail: SPCHailReport[] = [];
      const okcMetroHail: SPCHailReport[] = [];

      for (const record of records) {
        // Parse size (handle both "200" format and "2.00" format)
        let sizeInches = 0;
        if (record.Size) {
          const sizeStr = record.Size.toString();
          if (sizeStr.includes('.')) {
            sizeInches = parseFloat(sizeStr);
          } else {
            // Convert from hundredths (e.g., "200" = 2.00 inches)
            sizeInches = parseInt(sizeStr) / 100;
          }
        }

        const lat = parseFloat(record.Lat);
        const lon = parseFloat(record.Lon);
        const state = record.State;

        // Skip if not Oklahoma or missing data
        if (state !== 'OK' || isNaN(lat) || isNaN(lon) || isNaN(sizeInches)) {
          continue;
        }

        // Check if in Oklahoma bounds
        if (lat >= OK_BOUNDS.south && lat <= OK_BOUNDS.north &&
            lon >= OK_BOUNDS.west && lon <= OK_BOUNDS.east) {

          const report: SPCHailReport = {
            time: record.Time || '',
            size: sizeInches,
            lat,
            lon,
            location: record.Location || '',
            county: record.County || '',
            state,
            comments: record.Comments || ''
          };

          // Track significant hail (2+ inches)
          if (sizeInches >= 2.0) {
            significantHail.push(report);

            // Also check if in OKC Metro
            if (lat >= OKC_METRO_BOUNDS.south && lat <= OKC_METRO_BOUNDS.north &&
                lon >= OKC_METRO_BOUNDS.west && lon <= OKC_METRO_BOUNDS.east) {
              okcMetroHail.push(report);
            }
          }
        }
      }

      // Calculate statistics
      const hasSignificantHail = significantHail.length > 0;
      const hasOKCMetroHail = okcMetroHail.length > 0;
      const maxSize = significantHail.length > 0
        ? Math.max(...significantHail.map(r => r.size))
        : 0;

      console.log(`[SPC Pre-Filter] Found ${significantHail.length} reports with 2+ inch hail in Oklahoma`);
      console.log(`[SPC Pre-Filter] Found ${okcMetroHail.length} reports with 2+ inch hail in OKC Metro`);
      console.log(`[SPC Pre-Filter] Max hail size: ${maxSize}"`);

      const result = {
        date,
        hasSignificantHail,
        hasOKCMetroHail,
        // Statewide aliases — the mesh pre-filter keys on these (2026-06-12):
        // a storm anywhere in OK now counts (El Reno was filtered out by the
        // metro-only flag).
        hasOKHail: hasSignificantHail,
        okReports: significantHail.length,
        totalReports: records.length,
        oklahomaReports: significantHail.length,
        okcMetroReports: okcMetroHail.length,
        maxSize,
        topReports: significantHail
          .sort((a, b) => b.size - a.size)
          .slice(0, 5)
          .map(r => ({
            size: r.size,
            location: r.location,
            county: r.county,
            time: r.time
          })),
        recommendation: hasOKCMetroHail
          ? 'PROCESS_GRIB2: Significant hail in OKC Metro area'
          : hasSignificantHail
          ? 'CONSIDER: Significant hail in Oklahoma but not OKC Metro'
          : 'SKIP: No significant hail (2+ inches) reported',
        source: 'SPC Storm Reports',
        url: spcUrl
      };

      // Cache for 24 hours (SPC data doesn't change)
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

      return res.status(200).json(result);

    } catch (fetchError) {
      // SPC data not available for this date
      if (axios.isAxiosError(fetchError) && fetchError.response?.status === 404) {
        console.log(`[SPC Pre-Filter] No SPC data available for ${date}`);

        return res.status(200).json({
          date,
          hasSignificantHail: null,
          hasOKCMetroHail: null,
          hasOKHail: null,
          okReports: 0,
          totalReports: 0,
          oklahomaReports: 0,
          okcMetroReports: 0,
          maxSize: 0,
          topReports: [],
          recommendation: 'UNKNOWN: SPC data not available (may still have hail)',
          note: 'SPC data may not be available yet for recent dates or very old dates',
          source: 'SPC Storm Reports',
          url: spcUrl
        });
      }

      throw fetchError;
    }

  } catch (error) {
    console.error('[SPC Pre-Filter] Error:', error);

    return res.status(500).json({
      error: 'Failed to check SPC storm reports',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

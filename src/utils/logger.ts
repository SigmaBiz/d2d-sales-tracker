/**
 * Simple logger utility to control console output
 * Set VERBOSE to false to reduce console spam in production
 */

const VERBOSE = false; // Set to true for debugging

export const logger = {
  log: (...args: any[]) => {
    if (VERBOSE) {
      console.log(...args);
    }
  },
  error: (...args: any[]) => {
    // Always show errors
    console.error(...args);
  },
  warn: (...args: any[]) => {
    if (VERBOSE) {
      console.warn(...args);
    }
  },
  info: (...args: any[]) => {
    if (VERBOSE) {
      console.info(...args);
    }
  }
};
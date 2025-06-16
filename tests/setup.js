/**
 * Jest setup file for all tests
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set test timeout globally (only if jest is available)
if (typeof jest !== 'undefined') {
  jest.setTimeout(30000);
}

// Global test helpers
global.delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Mock console methods to reduce test noise (optional)
// Uncomment if you want quieter test output
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: console.error, // Keep errors visible
// };
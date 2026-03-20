import type { Candle } from "../../src/domain/market/candle.js";

const BASE_TIME = Date.now() - 30 * 24 * 60 * 60 * 1000;
const INTERVAL_4H = 4 * 60 * 60 * 1000;

export const mockCandles4h: Candle[] = Array.from({ length: 20 }, (_, i) => ({
  timestamp: BASE_TIME + i * INTERVAL_4H,
  open: 60000 + i * 100,
  high: 60500 + i * 100,
  low: 59500 + i * 100,
  close: 60200 + i * 100,
  volume: 1000 + i * 10,
}));

export const mockFundingRates = Array.from({ length: 20 }, (_, i) => ({
  timestamp: BASE_TIME + i * INTERVAL_4H,
  fundingRate: 0.0001 + i * 0.00001,
}));

export const mockOpenInterest = Array.from({ length: 20 }, (_, i) => ({
  timestamp: BASE_TIME + i * INTERVAL_4H,
  openInterest: 50000 + i * 100,
}));

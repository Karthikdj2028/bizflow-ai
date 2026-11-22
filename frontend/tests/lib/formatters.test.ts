import { describe, it, expect } from 'vitest';
import {
  formatCurrencyAmount,
  formatDisplayDate,
  getUtcTodayDateString,
  isDateInFutureUtc,
  isValidCalendarDate,
  isValidMonetaryAmount,
  safeFormatCurrencyAmount,
} from '../../src/lib/formatters';

describe('Financial Monetary Formatter (Absolute Float Ban)', () => {
  describe('isValidMonetaryAmount', () => {
    it('accepts valid integer and 2-decimal string amounts', () => {
      expect(isValidMonetaryAmount('0')).toBe(true);
      expect(isValidMonetaryAmount('0.00')).toBe(true);
      expect(isValidMonetaryAmount('100')).toBe(true);
      expect(isValidMonetaryAmount('100.5')).toBe(true);
      expect(isValidMonetaryAmount('100.50')).toBe(true);
      expect(isValidMonetaryAmount('15000.75')).toBe(true);
    });

    it('accepts maximum PostgreSQL NUMERIC(15,2) limit (13 integer digits)', () => {
      expect(isValidMonetaryAmount('9999999999999.99')).toBe(true);
      expect(isValidMonetaryAmount('9999999999999')).toBe(true);
    });

    it('rejects numbers exceeding 13 integer digits', () => {
      expect(isValidMonetaryAmount('10000000000000.00')).toBe(false);
      expect(isValidMonetaryAmount('12345678901234')).toBe(false);
    });

    it('rejects malformed monetary strings, negative numbers, and extra decimals', () => {
      expect(isValidMonetaryAmount('')).toBe(false);
      expect(isValidMonetaryAmount(' ')).toBe(false);
      expect(isValidMonetaryAmount('-50.00')).toBe(false);
      expect(isValidMonetaryAmount('100.555')).toBe(false);
      expect(isValidMonetaryAmount('007.50')).toBe(false); // leading zeroes
      expect(isValidMonetaryAmount('$100.00')).toBe(false);
      expect(isValidMonetaryAmount('1e5')).toBe(false);
      expect(isValidMonetaryAmount(null)).toBe(false);
      expect(isValidMonetaryAmount(undefined)).toBe(false);
      expect(isValidMonetaryAmount(100.5)).toBe(false); // non-string rejected
    });
  });

  describe('formatCurrencyAmount', () => {
    it('formats amounts using BigInt without float precision loss', () => {
      expect(formatCurrencyAmount('100', 'INR', 'en-IN')).toBe('INR 100.00');
      expect(formatCurrencyAmount('100.5', 'INR', 'en-IN')).toBe('INR 100.50');
      expect(formatCurrencyAmount('100.50', 'INR', 'en-IN')).toBe('INR 100.50');
      expect(formatCurrencyAmount('0.01', 'INR', 'en-IN')).toBe('INR 0.01');
      expect(formatCurrencyAmount('0.00', 'INR', 'en-IN')).toBe('INR 0.00');
      expect(formatCurrencyAmount('0', 'INR', 'en-IN')).toBe('INR 0.00');
    });

    it('formats maximum 13-digit amount with exact precision', () => {
      // 9,999,999,999,999.99
      const formatted = formatCurrencyAmount('9999999999999.99', 'USD', 'en-US');
      expect(formatted).toBe('USD 9,999,999,999,999.99');
    });

    it('applies localized grouping correctly', () => {
      // Indian numbering system: 12,34,567.89
      expect(formatCurrencyAmount('1234567.89', 'INR', 'en-IN')).toBe('INR 12,34,567.89');
      // Western numbering system: 1,234,567.89
      expect(formatCurrencyAmount('1234567.89', 'USD', 'en-US')).toBe('USD 1,234,567.89');
    });

    it('throws Error on malformed amounts to prevent silent data corruption', () => {
      expect(() => formatCurrencyAmount('invalid')).toThrowError('Invalid monetary amount');
      expect(() => formatCurrencyAmount('-100.00')).toThrowError('Invalid monetary amount');
      expect(() => formatCurrencyAmount('10.999')).toThrowError('Invalid monetary amount');
    });
  });

  describe('safeFormatCurrencyAmount', () => {
    it('returns formatted string for valid amount and fallback for invalid', () => {
      expect(safeFormatCurrencyAmount('1500.00', 'INR')).toBe('INR 1,500.00');
      expect(safeFormatCurrencyAmount(null, 'INR', 'N/A')).toBe('N/A');
      expect(safeFormatCurrencyAmount('corrupt', 'INR', '—')).toBe('—');
    });
  });
});

describe('Date Utilities (UTC Alignment & Display Formatting)', () => {
  describe('isValidCalendarDate', () => {
    it('accepts genuine calendar dates across modern years', () => {
      expect(isValidCalendarDate('2026-11-20')).toBe(true);
      expect(isValidCalendarDate('2024-02-29')).toBe(true); // 2024 is leap year
      expect(isValidCalendarDate('2026-01-31')).toBe(true);
      expect(isValidCalendarDate('2026-12-31')).toBe(true);
    });

    it('correctly validates 4-digit years including 0001-0099 without 1900-offset quirk', () => {
      expect(isValidCalendarDate('0001-01-01')).toBe(true);
      expect(isValidCalendarDate('0004-02-29')).toBe(true); // year 4 is leap year
      expect(isValidCalendarDate('0001-02-29')).toBe(false); // year 1 is not leap year
      expect(isValidCalendarDate('0099-12-31')).toBe(true);
    });

    it('strictly rejects year 0000', () => {
      expect(isValidCalendarDate('0000-01-01')).toBe(false);
      expect(isValidCalendarDate('0000-12-31')).toBe(false);
    });

    it('strictly rejects surrounding whitespace without silent trimming', () => {
      expect(isValidCalendarDate(' 2026-11-20')).toBe(false);
      expect(isValidCalendarDate('2026-11-20 ')).toBe(false);
      expect(isValidCalendarDate(' 2026-11-20 ')).toBe(false);
      expect(isValidCalendarDate('\t2026-11-20')).toBe(false);
    });

    it('rejects impossible calendar dates and non-leap year Feb 29', () => {
      expect(isValidCalendarDate('2026-02-31')).toBe(false); // Feb has <= 29 days
      expect(isValidCalendarDate('2026-02-29')).toBe(false); // 2026 not leap year
      expect(isValidCalendarDate('2026-04-31')).toBe(false); // April has 30 days
      expect(isValidCalendarDate('2026-06-31')).toBe(false); // June has 30 days
      expect(isValidCalendarDate('2026-13-01')).toBe(false); // Month 13 invalid
      expect(isValidCalendarDate('2026-00-15')).toBe(false); // Month 00 invalid
      expect(isValidCalendarDate('2026-11-00')).toBe(false); // Day 00 invalid
      expect(isValidCalendarDate('2026-11-32')).toBe(false); // Day 32 invalid
      expect(isValidCalendarDate('')).toBe(false);
      expect(isValidCalendarDate('invalid')).toBe(false);
      expect(isValidCalendarDate(null)).toBe(false);
      expect(isValidCalendarDate(undefined)).toBe(false);
    });
  });

  describe('getUtcTodayDateString', () => {
    it('returns a valid YYYY-MM-DD date matching current UTC date', () => {
      const today = getUtcTodayDateString();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const now = new Date();
      const expectedUtc = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
      expect(today).toBe(expectedUtc);
    });
  });

  describe('isDateInFutureUtc', () => {
    it('accurately identifies future UTC calendar dates', () => {
      const today = getUtcTodayDateString();
      expect(isDateInFutureUtc(today)).toBe(false);
      expect(isDateInFutureUtc('1999-01-01')).toBe(false);
      expect(isDateInFutureUtc('0001-01-01')).toBe(false);
      expect(isDateInFutureUtc('2099-12-31')).toBe(true);
    });

    it('returns false for invalid, whitespace-padded, or impossible calendar dates', () => {
      expect(isDateInFutureUtc('2026-02-31')).toBe(false);
      expect(isDateInFutureUtc('2026-04-31')).toBe(false);
      expect(isDateInFutureUtc('2099-13-01')).toBe(false);
      expect(isDateInFutureUtc(' 2099-12-31 ')).toBe(false); // Whitespace rejected
      expect(isDateInFutureUtc('0000-01-01')).toBe(false);
      expect(isDateInFutureUtc('invalid')).toBe(false);
      expect(isDateInFutureUtc('')).toBe(false);
    });
  });

  describe('formatDisplayDate', () => {
    it('formats valid YYYY-MM-DD strings for localized display', () => {
      expect(formatDisplayDate('2026-11-20', 'en-US')).toBe('Nov 20, 2026');
      expect(formatDisplayDate('2026-01-05', 'en-US')).toBe('Jan 5, 2026');
    });

    it('formats ancient 4-digit dates correctly without 1900-offset quirk', () => {
      const formatted = formatDisplayDate('0001-01-01', 'en-US');
      expect(formatted).toContain('1');
    });

    it('rejects impossible calendar dates without normalizing them', () => {
      // 2026-02-31 must not normalize to Mar 3, 2026
      expect(formatDisplayDate('2026-02-31')).toBe('2026-02-31');
      expect(formatDisplayDate('2026-04-31')).toBe('2026-04-31');
    });

    it('returns empty string or original string for invalid inputs', () => {
      expect(formatDisplayDate('')).toBe('');
      expect(formatDisplayDate('invalid')).toBe('invalid');
      expect(formatDisplayDate(' 2026-11-20 ')).toBe(' 2026-11-20 ');
    });
  });
});

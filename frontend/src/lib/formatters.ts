/**
 * Safe monetary formatting, UTC date boundaries, and display date utilities.
 *
 * GUARANTEES:
 * 1. Absolute Float Ban: Never uses `Number()` or `parseFloat()` for currency figures.
 * 2. BigInt Grouping: Integer portions use `BigInt` with `Intl.NumberFormat` for arbitrary-length grouping.
 * 3. Strict Validation: Rejects malformed values immediately rather than masking errors as zero.
 * 4. UTC Date Alignment: Synchronized with backend's `datetime.now(timezone.utc).date()` checks.
 */

const MONETARY_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_INTEGER_DIGITS = 13;
// Strict 4-digit year (0001-9999), 2-digit month (01-12), 2-digit day (01-31).
// Rejects year 0000 and requires exact string boundary without surrounding whitespace.
const ISO_DATE_REGEX = /^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

/**
 * Validate that a string is a strict YYYY-MM-DD calendar date that actually exists.
 * Rejects year 0000, surrounding whitespace, and nonexistent dates like 2026-02-31 or 2026-02-29 (non-leap year).
 * Correctly validates 4-digit years including 0001-0099 without JavaScript's 2-digit year normalization quirk.
 */
export function isValidCalendarDate(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== 'string') return false;
  // Enforce exact YYYY-MM-DD without accepting surrounding whitespace
  if (!ISO_DATE_REGEX.test(dateStr)) return false;

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (year < 1) return false;

  // UTC-based date check. When year < 100, setUTCFullYear prevents JavaScript's 1900-offset quirk.
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (year < 100) {
    utcDate.setUTCFullYear(year);
  }

  return (
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === month - 1 &&
    utcDate.getUTCDate() === day
  );
}

/**
 * Validate whether a string is a valid non-negative monetary amount with at most 2 decimals
 * and up to 13 integer digits (PostgreSQL NUMERIC(15,2) limit: 9999999999999.99).
 */
export function isValidMonetaryAmount(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const clean = value.trim();
  if (!clean) return false;
  if (!MONETARY_REGEX.test(clean)) return false;

  const [intPart] = clean.split('.');
  if (intPart.length > MAX_INTEGER_DIGITS) return false;

  return true;
}

/**
 * Format a validated monetary amount string with currency code and locale grouping.
 * Throws an Error if the input is malformed, preventing silent conversion of corrupt data.
 */
export function formatCurrencyAmount(
  amountStr: string,
  currencyCode: string = 'INR',
  locale: string = 'en-IN'
): string {
  if (!isValidMonetaryAmount(amountStr)) {
    throw new Error(
      `Invalid monetary amount: "${amountStr}". Expected non-negative string with at most 2 decimal places and <= 13 integer digits.`
    );
  }

  const clean = amountStr.trim();
  const [rawInt, rawFrac = ''] = clean.split('.');

  // Parse integer portion via BigInt to eliminate float precision loss
  const bigIntVal = BigInt(rawInt);
  const formattedInt = new Intl.NumberFormat(locale, { useGrouping: true }).format(bigIntVal);

  // Normalize fractional portion strictly to 2 decimal places
  const formattedFrac = (rawFrac + '00').slice(0, 2);

  return `${currencyCode} ${formattedInt}.${formattedFrac}`;
}

/**
 * Safe formatter for presentation contexts where malformed data should fall back to a placeholder.
 */
export function safeFormatCurrencyAmount(
  amountStr: string | null | undefined,
  currencyCode: string = 'INR',
  fallback: string = '—'
): string {
  if (!amountStr || !isValidMonetaryAmount(amountStr)) {
    return fallback;
  }
  return formatCurrencyAmount(amountStr, currencyCode);
}

/**
 * Return current UTC calendar date formatted as YYYY-MM-DD.
 * Aligns strictly with backend's `datetime.now(timezone.utc).date()` boundary validation.
 */
export function getUtcTodayDateString(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a YYYY-MM-DD date string is in the future relative to the current UTC calendar date.
 * Validates strict YYYY-MM-DD syntax and calendar validity first.
 * Returns false if the date string is syntactically or calendar-invalid.
 */
export function isDateInFutureUtc(dateStr: string): boolean {
  if (!isValidCalendarDate(dateStr)) return false;
  return dateStr > getUtcTodayDateString();
}

/**
 * Format YYYY-MM-DD date string to a localized readable display string.
 * Strictly rejects impossible calendar dates rather than letting JavaScript normalize them.
 */
export function formatDisplayDate(dateStr: string, locale: string = 'en-US'): string {
  if (!dateStr || typeof dateStr !== 'string') return '';
  if (!isValidCalendarDate(dateStr)) {
    return dateStr;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 100) {
    date.setUTCFullYear(year);
  }
  return date.toLocaleDateString(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Human-readable display label for payment methods.
 */
export function formatPaymentMethod(method: string | null | undefined): string {
  switch (method) {
    case 'BANK_TRANSFER':
      return 'Bank Transfer';
    case 'CREDIT_CARD':
      return 'Credit Card';
    case 'DEBIT_CARD':
      return 'Debit Card';
    case 'CASH':
      return 'Cash';
    case 'UPI':
      return 'UPI';
    case 'OTHER':
    default:
      return method || 'Other';
  }
}

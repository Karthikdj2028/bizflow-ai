/**
 * Strict BigInt-based financial arithmetic for invoice calculations and previews.
 * Operates strictly on decimal strings. Rejects silent truncation, floats, and overflow.
 */

export class DecimalValidationError extends Error {
  public code: string;
  constructor(message: string, code: string = 'DECIMAL_VALIDATION_ERROR') {
    super(message);
    this.name = 'DecimalValidationError';
    this.code = code;
  }
}

// Global monetary ceiling matching backend MAX_NUMERIC_15_2 = Decimal("999999999999.99")
export const MAX_NUMERIC_15_2_CENTS = 99999999999999n; // $999,999,999,999.99 in cents
export const MAX_QUANTITY_SCALED = 1000000000n;        // 10,000,000.00 in scale 2
export const MAX_UNIT_PRICE_SCALED = 10000000000n;     // 100,000,000.00 in scale 2

/**
 * Strictly parses a decimal string into a BigInt with an exact scale factor.
 * Throws DecimalValidationError on malformed strings, signs where forbidden, or excess precision.
 * NEVER silently truncates decimal places.
 */
export function parseStrictDecimalStringToBigInt(
  val: string,
  maxScale: number,
  fieldName: string,
  allowNegative: boolean = false
): bigint {
  if (typeof val !== 'string') {
    throw new DecimalValidationError(
      `${fieldName} must be a string representation. Floating-point numbers are strictly forbidden.`,
      'INVALID_TYPE'
    );
  }

  const str = val.trim();
  if (!str) {
    throw new DecimalValidationError(`${fieldName} cannot be empty.`, 'EMPTY_INPUT');
  }

  // Exact decimal regex
  const regex = allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!regex.test(str)) {
    throw new DecimalValidationError(
      `Invalid decimal format for ${fieldName}: '${str}'.`,
      'INVALID_DECIMAL_FORMAT'
    );
  }

  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;
  const [intPart, decPart = ''] = cleanStr.split('.');

  // Strict scale verification: Never truncate
  if (decPart.length > maxScale) {
    throw new DecimalValidationError(
      `MAX_SCALE_EXCEEDED: ${fieldName} may have at most ${maxScale} decimal places. Received ${decPart.length}.`,
      'MAX_SCALE_EXCEEDED'
    );
  }

  // Pad decimal part with trailing zeros up to maxScale
  const paddedDec = decPart.padEnd(maxScale, '0');
  const combined = BigInt(intPart) * (10n ** BigInt(maxScale)) + BigInt(paddedDec);

  return isNegative ? -combined : combined;
}

/**
 * Formats a scaled BigInt back to a strict decimal string with fixed decimal places.
 */
export function formatScaledBigInt(scaled: bigint, scale: number): string {
  const isNegative = scaled < 0n;
  const abs = isNegative ? -scaled : scaled;
  const divisor = 10n ** BigInt(scale);

  const intPart = abs / divisor;
  const decPart = abs % divisor;

  const formattedDec = decPart.toString().padStart(scale, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${formattedDec}`;
}

/**
 * Line Total calculation:
 * quantity (scale 2) * unit_price (scale 2) = raw (scale 4)
 * Round-Half-Up division to cents (scale 2): (raw + 50n) / 100n
 */
export function computeLineTotalCents(quantityStr: string, unitPriceStr: string): bigint {
  const qtyScaled = parseStrictDecimalStringToBigInt(quantityStr, 2, 'quantity', false);
  const priceScaled = parseStrictDecimalStringToBigInt(unitPriceStr, 2, 'unit_price', false);

  if (qtyScaled <= 0n) {
    throw new DecimalValidationError('quantity must be strictly positive (> 0).', 'INVALID_QUANTITY');
  }
  if (qtyScaled > MAX_QUANTITY_SCALED) {
    throw new DecimalValidationError(
      'quantity exceeds maximum allowed limit (10,000,000.00).',
      'QUANTITY_LIMIT_EXCEEDED'
    );
  }
  if (priceScaled > MAX_UNIT_PRICE_SCALED) {
    throw new DecimalValidationError(
      'unit_price exceeds maximum allowed limit (100,000,000.00).',
      'PRICE_LIMIT_EXCEEDED'
    );
  }

  const rawProduct = qtyScaled * priceScaled; // Scale 4
  const lineTotalCents = (rawProduct + 50n) / 100n; // Scale 2 (cents)

  if (lineTotalCents > MAX_NUMERIC_15_2_CENTS) {
    throw new DecimalValidationError(
      'Calculated line total exceeds maximum monetary limit.',
      'NUMERICAL_OVERFLOW_LIMIT'
    );
  }

  return lineTotalCents;
}

/**
 * Converts UI percentage string (e.g. "8.25") to backend fractional decimal string (e.g. "0.0825").
 * Tax percentage allowed range: [0.00, 100.00] with at most 2 decimal places.
 */
export function percentStringToFractionalString(percentStr: string): string {
  const trimmed = percentStr.trim();
  if (!trimmed) return '0.0000';

  const percentScaled = parseStrictDecimalStringToBigInt(trimmed, 2, 'tax_rate_percent', false);
  if (percentScaled > 10000n) { // 100.00%
    throw new DecimalValidationError('tax_rate cannot exceed 100.00%.', 'TAX_RATE_EXCEEDS_100');
  }

  // percentScaled (scale 2) represents P * 100. Fractional is (P / 100), scaled by 10^4 = percentScaled.
  return formatScaledBigInt(percentScaled, 4);
}

/**
 * Converts backend fractional decimal string (e.g. "0.0825") to UI percentage string (e.g. "8.25").
 */
export function fractionalStringToPercentString(fractionalStr: string): string {
  const trimmed = fractionalStr.trim();
  if (!trimmed) return '0';

  const fractionalScaled = parseStrictDecimalStringToBigInt(trimmed, 4, 'tax_rate_fractional', false);
  const percentScaled = fractionalScaled; // In basis points (scale 2 for percent)
  const formatted = formatScaledBigInt(percentScaled, 2);
  return formatted.replace(/\.00$/, '').replace(/(\.[0-9])0$/, '$1');
}

export interface ComputedInvoiceTotals {
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string | null;
  isDiscountExceeded: boolean;
  errorMessage?: string;
}

/**
 * Computes subtotal, tax amount, and total amount without silent clamping.
 * Preserves user-entered discount. Flags error if discount exceeds subtotal + tax.
 * If discount exceeds subtotal + tax, totalAmount is returned as null.
 */
export function computeInvoiceTotals(
  items: Array<{ description?: string; quantity: string; unitPrice: string }>,
  taxPercentStr: string,
  discountAmountStr: string
): ComputedInvoiceTotals {
  // 1. Subtotal
  let subtotalCents = 0n;
  for (const item of items) {
    if (item.quantity && item.quantity.trim() && item.unitPrice && item.unitPrice.trim()) {
      subtotalCents += computeLineTotalCents(item.quantity, item.unitPrice);
      if (subtotalCents > MAX_NUMERIC_15_2_CENTS) {
        throw new DecimalValidationError(
          'Calculated subtotal exceeds maximum monetary limit.',
          'NUMERICAL_OVERFLOW_LIMIT'
        );
      }
    }
  }

  // 2. Tax Amount
  let taxCents = 0n;
  if (taxPercentStr && taxPercentStr.trim()) {
    const fractionalStr = percentStringToFractionalString(taxPercentStr);
    const taxRateUnits = parseStrictDecimalStringToBigInt(fractionalStr, 4, 'tax_rate', false); // [0n, 10000n]
    const rawTax = subtotalCents * taxRateUnits;
    taxCents = (rawTax + 5000n) / 10000n;
    if (taxCents > MAX_NUMERIC_15_2_CENTS) {
      throw new DecimalValidationError(
        'Calculated tax amount exceeds maximum monetary limit.',
        'NUMERICAL_OVERFLOW_LIMIT'
      );
    }
  }

  // 3. Discount Amount (No silent clamping!)
  let discountCents = 0n;
  let isDiscountExceeded = false;
  let errorMessage: string | undefined;

  if (discountAmountStr && discountAmountStr.trim()) {
    discountCents = parseStrictDecimalStringToBigInt(discountAmountStr, 2, 'discount_amount', false);
    const maxDiscount = subtotalCents + taxCents;
    if (discountCents > maxDiscount) {
      isDiscountExceeded = true;
      errorMessage = 'Discount amount cannot exceed subtotal + tax amount.';
    }
  }

  // 4. Total Amount (null when invalid discount)
  let totalAmount: string | null = null;
  if (!isDiscountExceeded) {
    const totalCents = subtotalCents + taxCents - discountCents;
    if (totalCents > MAX_NUMERIC_15_2_CENTS) {
      throw new DecimalValidationError(
        'Calculated total amount exceeds maximum monetary limit.',
        'NUMERICAL_OVERFLOW_LIMIT'
      );
    }
    totalAmount = formatScaledBigInt(totalCents, 2);
  }

  return {
    subtotal: formatScaledBigInt(subtotalCents, 2),
    taxAmount: formatScaledBigInt(taxCents, 2),
    discountAmount: formatScaledBigInt(discountCents, 2),
    totalAmount,
    isDiscountExceeded,
    errorMessage,
  };
}

/**
 * Calendar date string arithmetic (YYYY-MM-DD) avoiding timezone shifts.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function getTodayDateString(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

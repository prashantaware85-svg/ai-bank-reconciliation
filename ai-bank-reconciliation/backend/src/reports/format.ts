import { Decimal } from 'decimal.js';

/**
 * Indian currency formatting: ₹1,25,000.00 (en-IN grouping).
 * Decimal input only — never floating-point arithmetic for accounting.
 */
export function formatINR(value: string | Decimal | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try {
    const d = value instanceof Decimal ? value : new Decimal(value);
    if (!d.isFinite()) return '—';
    const fixed = d.toFixed(2);
    const [intPart, frac] = fixed.split('.') as [string, string];
    const sign = intPart.startsWith('-') ? '-' : '';
    const digits = intPart.replace(/^-/, '');
    let grouped: string;
    if (digits.length <= 3) {
      grouped = digits;
    } else {
      const last3 = digits.slice(-3);
      const rest = digits.slice(0, -3);
      grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
    }
    return `${sign}₹${grouped}.${frac}`;
  } catch {
    return '—';
  }
}

/** Percent from actual counts (0 decimals, e.g. 92.4%). */
export function percent(part: number, total: number): string {
  if (!total) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 10);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

/** Excel numFmt for Indian currency grouping. */
export const XLSX_INR_FMT =
  '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"#,##0.00';

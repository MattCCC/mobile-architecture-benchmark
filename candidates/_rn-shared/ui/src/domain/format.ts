// Display formatting without locale APIs (design §7.7).
import { OPTION_KEYS } from './types.ts';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Fixed-point value with scale 100: 1234 -> "12.34". Integer sums use the same rule. */
export function fmt(v: number): string {
  const whole = Math.floor(v / 100);
  const frac = v - whole * 100;
  return `${whole}.${pad2(frac)}`;
}

/** Zero-pad width for item labels: max(3, digits(N - 1)). */
export function labelWidth(itemCount: number): number {
  const digits = String(Math.max(0, itemCount - 1)).length;
  return Math.max(3, digits);
}

/** Row label `Item 042` (width from the profile's item count). */
export function itemLabel(index: number, width: number): string {
  let s = String(index);
  while (s.length < width) {
    s = `0${s}`;
  }
  return `Item ${s}`;
}

/** Option button text `A 12.34`. */
export function optionText(option: number, value: number): string {
  return `${OPTION_KEYS[option]} ${fmt(value)}`;
}

/** Summary bar text parts: `Selected 50` and `Total 1913.27`. */
export function summaryCountText(count: number): string {
  return `Selected ${count}`;
}

export function summaryTotalText(total: number): string {
  return `Total ${fmt(total)}`;
}

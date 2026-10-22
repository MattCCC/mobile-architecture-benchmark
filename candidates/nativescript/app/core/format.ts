// Display formatting without locale APIs (design §7.7). Values are integers, fixed-point scale 100.

export const OPTION_KEYS: readonly string[] = ['A', 'B', 'C'];
export const VALUE_SCALE = 100;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** fmt(v) = floor(v / 100) + "." + pad2(v mod 100); used for option values and totals. */
export function fmt(v: number): string {
  const whole = Math.floor(v / VALUE_SCALE);
  return `${whole}.${pad2(v % VALUE_SCALE)}`;
}

/** Label width w = max(3, digits(N - 1)), e.g. "Item 042" for N = 300. */
export function labelWidth(itemCount: number): number {
  return Math.max(3, `${Math.max(0, itemCount - 1)}`.length);
}

export function itemLabel(index: number, width: number): string {
  let digits = `${index}`;
  while (digits.length < width) {
    digits = `0${digits}`;
  }
  return `Item ${digits}`;
}

export function groupText(group: number): string {
  return `Group ${group}`;
}

/** Option button text, e.g. "A 12.34". */
export function optionText(option: number, value: number): string {
  return `${OPTION_KEYS[option]} ${fmt(value)}`;
}

export function summaryCountText(count: number): string {
  return `Selected ${count}`;
}

export function summaryTotalText(total: number): string {
  return `Total ${fmt(total)}`;
}

export function selectionButtonText(count: number): string {
  return `Selection (${count})`;
}

/** Selection screen entry, e.g. "Item 042 · Option B — 12.34". */
export function selectionEntryText(label: string, option: number, value: number): string {
  return `${label} \u00b7 Option ${OPTION_KEYS[option]} \u2014 ${fmt(value)}`;
}

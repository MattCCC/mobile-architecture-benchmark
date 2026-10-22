// Canonical state and Insights texts and their SHA-256 digests (design §7.6, fixtures/README.md).

import { OPTIONS } from './fixture';
import { OPTION_KEYS } from './format';
import { sha256Hex } from './sha256';
import { Store } from './store';

export function stateText(store: Store): string {
  const parts: string[] = new Array(store.itemCount * OPTIONS);
  for (let k = 0; k < parts.length; k += 1) {
    parts[k] = `${store.values[k]}`;
  }
  const sel = store
    .selectionList()
    .map(([i, o]) => `${i}:${OPTION_KEYS[o]}`)
    .join(',');
  return `mb-state-v1\nprofile=${store.fixture.profile}\nseq=${store.lastSeq}\nvalues=${parts.join(',')}\nselection=${sel}\n`;
}

export function stateDigest(store: Store): string {
  return sha256Hex(stateText(store));
}

export interface Insights {
  /** Top 5 items by option A value (descending, ties by lower index). */
  readonly top: ReadonlyArray<{ readonly i: number; readonly a: number }>;
  /** Counts of option B values in 5 equal buckets over [100, 9999]. */
  readonly buckets: readonly number[];
}

export function computeInsights(store: Store): Insights {
  const top: Array<{ i: number; a: number }> = [];
  const buckets = [0, 0, 0, 0, 0];
  for (let i = 0; i < store.itemCount; i += 1) {
    const a = store.values[i * OPTIONS];
    const b = store.values[i * OPTIONS + 1];
    buckets[Math.min(4, Math.floor(((b - 100) * 5) / 9900))] += 1;
    // Insertion into a 5-element list ordered by (a desc, i asc); i ascends, so ties keep the earlier item.
    if (top.length < 5 || a > top[top.length - 1].a) {
      let at = top.length;
      while (at > 0 && top[at - 1].a < a) {
        at -= 1;
      }
      top.splice(at, 0, { i, a });
      if (top.length > 5) {
        top.pop();
      }
    }
  }
  return { top, buckets };
}

export function insightsText(seq: number, insights: Insights): string {
  const top = insights.top.map((e) => `${e.i}:${e.a}`).join(',');
  return `mb-insights-v1\nseq=${seq}\ntop=${top}\nbuckets=${insights.buckets.join(',')}\n`;
}

export function insightsDigest(seq: number, insights: Insights): string {
  return sha256Hex(insightsText(seq, insights));
}

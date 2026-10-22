// Application state: item values, groups, selection, last applied seq, implementation-quality counters.
// Fine-grained subscriptions (design §8.6): one listener set per item, one for the selection aggregate,
// so an update re-renders only the target row and, if that item is selected, the aggregates.
// Snapshots are immutable objects replaced on change, as `useSyncExternalStore` requires.
// Pure TypeScript (no React imports).

import { OPTION_KEYS, VALUE_MIN, VALUE_SPAN } from './types.ts';
import type { FixtureFile, ProfileName } from './types.ts';

export interface ItemSnapshot {
  /** Current values of options A, B, C (fixed-point, scale 100). */
  readonly v: readonly number[];
  /** Selected option index (0..2) or -1. */
  readonly sel: number;
}

export interface SelectionSnapshot {
  /** Selection revision; increments on every selection change (`rev:<n>` probe token). */
  readonly rev: number;
  readonly count: number;
  /** Integer sum of the selected option values. */
  readonly total: number;
}

export interface InsightsSnapshot {
  readonly seq: number;
  /** Top 5 items by option A value (desc, ties by index asc): [itemIndex, valueA]. */
  readonly top: readonly (readonly number[])[];
  /** Counts of option B values in 5 equal buckets over [100, 9999]. */
  readonly buckets: readonly number[];
}

type Listener = () => void;

export class Store {
  readonly profile: ProfileName;
  readonly itemCount: number;
  private readonly values: Int32Array;
  private readonly groups: Int8Array;
  private readonly selected: Int8Array;
  private itemSnaps: ItemSnapshot[];
  private readonly itemListeners: (Set<Listener> | undefined)[];
  private readonly selectionListeners = new Set<Listener>();
  private readonly valueListeners = new Set<Listener>();
  private selectionSnap: SelectionSnapshot;
  private selectedCache: { rev: number; items: number[] } | null = null;
  private lastSeqValue = 0;
  private valuesVersion = 0;
  private insightsCache: { version: number; snap: InsightsSnapshot } | null = null;
  /** Row renders since process start (implementation-quality probe, reported in `ctr`). */
  rowRenders = 0;

  constructor(profile: ProfileName, fixture: FixtureFile) {
    this.profile = profile;
    this.itemCount = fixture.items.length;
    this.values = new Int32Array(this.itemCount * 3);
    this.groups = new Int8Array(this.itemCount);
    this.selected = new Int8Array(this.itemCount).fill(-1);
    this.itemListeners = new Array<Set<Listener> | undefined>(this.itemCount);
    this.itemSnaps = new Array<ItemSnapshot>(this.itemCount);
    this.selectionSnap = { rev: 0, count: 0, total: 0 };
    this.resetToFixture(fixture);
  }

  /** Loads the fixture state at seq 0 (startup and activity-warm reset). */
  resetToFixture(fixture: FixtureFile): void {
    for (let i = 0; i < this.itemCount; i += 1) {
      const item = fixture.items[i];
      this.groups[i] = item.g;
      this.values[i * 3] = item.v[0];
      this.values[i * 3 + 1] = item.v[1];
      this.values[i * 3 + 2] = item.v[2];
      this.selected[i] = -1;
    }
    for (const s of fixture.selection) {
      this.selected[s.i] = s.o;
    }
    this.lastSeqValue = 0;
    this.rebuildSnapshots(0);
  }

  /** Applies a restored state (values at `lastSeq` and the selection) from a restoration record. */
  restoreState(values: readonly (readonly number[])[], selection: readonly (readonly number[])[], lastSeq: number): void {
    for (let i = 0; i < this.itemCount; i += 1) {
      this.values[i * 3] = values[i][0];
      this.values[i * 3 + 1] = values[i][1];
      this.values[i * 3 + 2] = values[i][2];
      this.selected[i] = -1;
    }
    for (const [i, o] of selection) {
      this.selected[i] = o;
    }
    this.lastSeqValue = lastSeq;
    this.rebuildSnapshots(this.selectionSnap.rev);
  }

  private rebuildSnapshots(rev: number): void {
    let count = 0;
    let total = 0;
    for (let i = 0; i < this.itemCount; i += 1) {
      const sel = this.selected[i];
      this.itemSnaps[i] = { v: [this.values[i * 3], this.values[i * 3 + 1], this.values[i * 3 + 2]], sel };
      if (sel >= 0) {
        count += 1;
        total += this.values[i * 3 + sel];
      }
    }
    this.selectionSnap = { rev, count, total };
    this.selectedCache = null;
    this.valuesVersion += 1;
    for (let i = 0; i < this.itemCount; i += 1) {
      this.notifyItem(i);
    }
    this.notifySet(this.selectionListeners);
    this.notifySet(this.valueListeners);
  }

  /** Increments on every value change (snapshot for value-wide subscribers such as Insights). */
  getValuesVersion(): number {
    return this.valuesVersion;
  }

  get lastSeq(): number {
    return this.lastSeqValue;
  }

  group(i: number): number {
    return this.groups[i];
  }

  value(i: number, o: number): number {
    return this.values[i * 3 + o];
  }

  getItem(i: number): ItemSnapshot {
    return this.itemSnaps[i];
  }

  getSelection(): SelectionSnapshot {
    return this.selectionSnap;
  }

  /** Selected item indices in ascending order (cached per selection revision). */
  selectedItems(): number[] {
    const rev = this.selectionSnap.rev;
    if (this.selectedCache && this.selectedCache.rev === rev) {
      return this.selectedCache.items;
    }
    const items: number[] = [];
    for (let i = 0; i < this.itemCount; i += 1) {
      if (this.selected[i] >= 0) {
        items.push(i);
      }
    }
    this.selectedCache = { rev, items };
    return items;
  }

  selectedOption(i: number): number {
    return this.selected[i];
  }

  subscribeItem(i: number, cb: Listener): () => void {
    let set = this.itemListeners[i];
    if (!set) {
      set = new Set<Listener>();
      this.itemListeners[i] = set;
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  subscribeSelection(cb: Listener): () => void {
    this.selectionListeners.add(cb);
    return () => {
      this.selectionListeners.delete(cb);
    };
  }

  /** Any value change (used only by the Insights screen while it is shown). */
  subscribeValues(cb: Listener): () => void {
    this.valueListeners.add(cb);
    return () => {
      this.valueListeners.delete(cb);
    };
  }

  /**
   * Applies one in-order update (the stream client has already checked the seq).
   * Replaces all three values of item `i` immediately (no batching, throttling or dropping).
   */
  applyUpdate(seq: number, i: number, v: readonly number[]): void {
    const base = i * 3;
    const sel = this.selected[i];
    const before = sel >= 0 ? this.values[base + sel] : 0;
    this.values[base] = v[0];
    this.values[base + 1] = v[1];
    this.values[base + 2] = v[2];
    this.lastSeqValue = seq;
    this.itemSnaps[i] = { v: [v[0], v[1], v[2]], sel };
    this.notifyItem(i);
    if (sel >= 0) {
      const prev = this.selectionSnap;
      this.selectionSnap = { rev: prev.rev, count: prev.count, total: prev.total + v[sel] - before };
      this.notifySet(this.selectionListeners);
    }
    this.valuesVersion += 1;
    if (this.valueListeners.size > 0) {
      this.notifySet(this.valueListeners);
    }
  }

  /**
   * Tap on option `o` of item `i` (design §8.5): deselect if selected, else select it and replace any
   * other option of the item. Returns the new selection snapshot (its `rev` is the probe token source).
   */
  toggle(i: number, o: number): SelectionSnapshot {
    const base = i * 3;
    const current = this.selected[i];
    const prev = this.selectionSnap;
    let count = prev.count;
    let total = prev.total;
    if (current === o) {
      this.selected[i] = -1;
      count -= 1;
      total -= this.values[base + o];
    } else {
      if (current >= 0) {
        total -= this.values[base + current];
      } else {
        count += 1;
      }
      this.selected[i] = o;
      total += this.values[base + o];
    }
    this.selectionSnap = { rev: prev.rev + 1, count, total };
    this.selectedCache = null;
    this.itemSnaps[i] = { v: this.itemSnaps[i].v, sel: this.selected[i] };
    this.notifyItem(i);
    this.notifySet(this.selectionListeners);
    return this.selectionSnap;
  }

  /** Canonical state text `mb-state-v1` (design §7.6). */
  stateText(): string {
    const parts: string[] = new Array<string>(this.itemCount * 3);
    for (let k = 0; k < this.itemCount * 3; k += 1) {
      parts[k] = String(this.values[k]);
    }
    const sel: string[] = [];
    for (let i = 0; i < this.itemCount; i += 1) {
      const o = this.selected[i];
      if (o >= 0) {
        sel.push(`${i}:${OPTION_KEYS[o]}`);
      }
    }
    return `mb-state-v1\nprofile=${this.profile}\nseq=${this.lastSeqValue}\nvalues=${parts.join(',')}\nselection=${sel.join(',')}\n`;
  }

  /** Insights (design §7.1): top 5 by option A (desc, ties by index asc) and option B buckets. */
  /** Insights snapshot cached per values version (stable reference for `useSyncExternalStore`). */
  insightsSnapshot(): InsightsSnapshot {
    if (this.insightsCache === null || this.insightsCache.version !== this.valuesVersion) {
      this.insightsCache = { version: this.valuesVersion, snap: this.insights() };
    }
    return this.insightsCache.snap;
  }

  insights(): InsightsSnapshot {
    const top: number[][] = [];
    const buckets = [0, 0, 0, 0, 0];
    for (let i = 0; i < this.itemCount; i += 1) {
      const a = this.values[i * 3];
      const b = this.values[i * 3 + 1];
      buckets[Math.min(4, Math.floor(((b - VALUE_MIN) * 5) / VALUE_SPAN))] += 1;
      // Insert into the top list if it beats the weakest entry (strictly greater keeps ties by lower index).
      if (top.length < 5 || a > top[top.length - 1][1]) {
        let pos = top.length;
        while (pos > 0 && a > top[pos - 1][1]) {
          pos -= 1;
        }
        top.splice(pos, 0, [i, a]);
        if (top.length > 5) {
          top.pop();
        }
      }
    }
    return { seq: this.lastSeqValue, top, buckets };
  }

  private notifyItem(i: number): void {
    const set = this.itemListeners[i];
    if (set) {
      this.notifySet(set);
    }
  }

  private notifySet(set: Set<Listener>): void {
    for (const cb of set) {
      cb();
    }
  }

  /** All values in index order, as [a, b, c] triples (restoration record). */
  valueTriples(): number[][] {
    const out = new Array<number[]>(this.itemCount);
    for (let i = 0; i < this.itemCount; i += 1) {
      out[i] = [this.values[i * 3], this.values[i * 3 + 1], this.values[i * 3 + 2]];
    }
    return out;
  }

  /** Selection as sorted [itemIndex, optionIndex] pairs (restoration record). */
  selectionPairs(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.itemCount; i += 1) {
      if (this.selected[i] >= 0) {
        out.push([i, this.selected[i]]);
      }
    }
    return out;
  }
}

/** Canonical Insights text `mb-insights-v1` (design §7.6). */
export function insightsText(s: InsightsSnapshot): string {
  const top = s.top.map((e) => `${e[0]}:${e[1]}`).join(',');
  return `mb-insights-v1\nseq=${s.seq}\ntop=${top}\nbuckets=${s.buckets.join(',')}\n`;
}

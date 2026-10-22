// Application state (design §7.1, §8.5, §8.6): live values, selection, revision and stream counters.
// Platform-independent; the UI layer subscribes through the listener interface.

import { Fixture, OPTIONS } from './fixture';

export type ApplyResult = 'applied' | 'dup' | 'gap';

export interface StoreListener {
  /** Values of item i changed (one update message). */
  itemValues(i: number): void;
  /** Selection of item i changed (toggle or restore). */
  itemSelection(i: number): void;
  /** Selection count or total changed. */
  summary(): void;
}

export interface Counters {
  received: number;
  applied: number;
  dup: number;
  gap: number;
  rows: number;
}

export class Store {
  readonly fixture: Fixture;
  readonly itemCount: number;
  readonly values: Int32Array;
  /** Selected option per item, -1 = none. */
  readonly selected: Int8Array;
  selectionCount = 0;
  selectionTotal = 0;
  /** Increments on every selection change (probe token `rev:<n>`). */
  revision = 0;
  lastSeq = 0;
  readonly counters: Counters = { received: 0, applied: 0, dup: 0, gap: 0, rows: 0 };
  listener: StoreListener | null = null;

  constructor(fixture: Fixture) {
    this.fixture = fixture;
    this.itemCount = fixture.itemCount;
    this.values = new Int32Array(fixture.values);
    this.selected = new Int8Array(fixture.itemCount).fill(-1);
    this.resetToFixture();
  }

  /** Back to the fixture state at seq 0 (new session, design §8.3). Listeners are not notified. */
  resetToFixture(): void {
    this.values.set(this.fixture.values);
    this.selected.fill(-1);
    this.fixture.selection.forEach(([i, o]) => {
      this.selected[i] = o;
    });
    this.lastSeq = 0;
    this.revision = 0;
    this.counters.received = 0;
    this.counters.applied = 0;
    this.counters.dup = 0;
    this.counters.gap = 0;
    this.counters.rows = 0;
    this.recomputeSummary();
  }

  value(i: number, o: number): number {
    return this.values[i * OPTIONS + o];
  }

  group(i: number): number {
    return this.fixture.groups[i];
  }

  recomputeSummary(): void {
    let count = 0;
    let total = 0;
    for (let i = 0; i < this.itemCount; i += 1) {
      const o = this.selected[i];
      if (o >= 0) {
        count += 1;
        total += this.values[i * OPTIONS + o];
      }
    }
    this.selectionCount = count;
    this.selectionTotal = total;
  }

  /** Selection rule (§8.5): tapping the selected option deselects it, otherwise it replaces the item's option. */
  toggle(i: number, o: number): void {
    const current = this.selected[i];
    if (current === o) {
      this.selected[i] = -1;
      this.selectionCount -= 1;
      this.selectionTotal -= this.value(i, o);
    } else {
      if (current >= 0) {
        this.selectionTotal -= this.value(i, current);
      } else {
        this.selectionCount += 1;
      }
      this.selected[i] = o;
      this.selectionTotal += this.value(i, o);
    }
    this.revision += 1;
    this.listener?.itemSelection(i);
    this.listener?.summary();
  }

  /** Applies one update message by the client rules of §7.5 (seq order, duplicates and gaps counted). */
  applyUpdate(seq: number, i: number, a: number, b: number, c: number): ApplyResult {
    if (seq <= this.lastSeq) {
      this.counters.dup += 1;
      return 'dup';
    }
    if (seq > this.lastSeq + 1) {
      this.counters.gap += 1;
      return 'gap';
    }
    const base = i * OPTIONS;
    const o = this.selected[i];
    if (o >= 0) {
      const next = o === 0 ? a : o === 1 ? b : c;
      this.selectionTotal += next - this.values[base + o];
    }
    this.values[base] = a;
    this.values[base + 1] = b;
    this.values[base + 2] = c;
    this.lastSeq = seq;
    this.counters.applied += 1;
    this.listener?.itemValues(i);
    if (o >= 0) {
      this.listener?.summary();
    }
    return 'applied';
  }

  /** Selection as [item, option] pairs sorted by item index. */
  selectionList(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < this.itemCount; i += 1) {
      if (this.selected[i] >= 0) {
        out.push([i, this.selected[i]]);
      }
    }
    return out;
  }

  /** Restores the exact state at lastSeq from a validated restoration record (§8.8). */
  restore(values: ReadonlyArray<readonly number[]>, selection: ReadonlyArray<readonly number[]>, lastSeq: number): void {
    values.forEach((v, i) => {
      this.values[i * OPTIONS] = v[0];
      this.values[i * OPTIONS + 1] = v[1];
      this.values[i * OPTIONS + 2] = v[2];
    });
    this.selected.fill(-1);
    selection.forEach(([i, o]) => {
      this.selected[i] = o;
    });
    this.lastSeq = lastSeq;
    this.recomputeSummary();
  }
}

// View models of the island instances of one runtime. The host owns the data; an island renders the state the host
// sent (`init`, then `v` / `ins` / `tk` / `idg` messages, and a `snap` answer to its `ready`). Messages that arrive
// before the island root mounted are buffered per instance and applied after its `init`. Pure TypeScript.

import { Observable } from '../../_rn-shared/ui/src/domain/observable.ts';
import type { InsightsSnapshot } from '../../_rn-shared/ui/src/domain/store.ts';
import { parseHostMessage } from './protocol.ts';
import type { HostMessage, InsightsSourceKind, IslandKindName, IslandState } from './protocol.ts';

export interface IslandMarks {
  mark(event: string, payload: string): void;
}

const MAX_BUFFERED = 2000;

/** One island instance (one Detail or Insights view). Implements the `InsightsStoreLike` contract of InsightsView. */
export class IslandModel {
  readonly sid: number;
  readonly kind: IslandKindName;
  readonly itemCount: number;
  readonly token: Observable<string>;
  /** Detail: values of the item; Insights: unused. */
  readonly values: Observable<readonly number[]>;
  readonly insightsDigest: Observable<string>;
  readonly index: number;
  readonly group: number;
  readonly source: InsightsSourceKind;
  readonly version: string;
  readonly openSeq: number;
  readonly rows: Observable<readonly number[]>[];
  readonly summary: Observable<readonly number[]>;
  readonly anchor: number;
  private seq: number;
  private xr: boolean;
  private insights: InsightsSnapshot;
  private readonly insightsListeners = new Set<() => void>();
  private readonly marks: IslandMarks;

  constructor(state: IslandState, marks: IslandMarks) {
    this.sid = state.sid;
    this.kind = state.k;
    this.itemCount = state.n;
    this.seq = state.s;
    this.xr = state.xr === 1;
    this.marks = marks;
    this.token = new Observable<string>(state.tk);
    this.rows = state.k === 'list' ? state.rows.map((r) => new Observable<readonly number[]>(r.slice())) : [];
    this.summary = new Observable<readonly number[]>(state.k === 'list' ? state.summary.slice() : [0, 0, 0]);
    this.anchor = state.k === 'list' ? state.anchor : 0;
    if (state.k === 'detail') {
      this.index = state.i;
      this.group = state.g;
      this.values = new Observable<readonly number[]>(state.v.slice());
      this.insights = { seq: state.s, top: [], buckets: [0, 0, 0, 0, 0] };
      this.insightsDigest = new Observable<string>('-');
      this.source = 'embedded';
      this.version = '1';
      this.openSeq = 0;
    } else if (state.k === 'insights') {
      this.index = -1;
      this.group = -1;
      this.values = new Observable<readonly number[]>([]);
      this.insights = { seq: state.s, top: state.top.map((e) => [e[0], e[1]]), buckets: state.b.slice() };
      this.insightsDigest = new Observable<string>(state.idg);
      this.source = state.src;
      this.version = state.ver;
      this.openSeq = state.open;
    } else {
      this.index = -1;
      this.group = -1;
      this.values = new Observable<readonly number[]>([]);
      this.insights = { seq: state.s, top: [], buckets: [0, 0, 0, 0, 0] };
      this.insightsDigest = new Observable<string>('-');
      this.source = 'embedded';
      this.version = '1';
      this.openSeq = 0;
    }
  }

  get lastSeq(): number {
    return this.seq;
  }

  // InsightsStoreLike
  insightsSnapshot(): InsightsSnapshot {
    return this.insights;
  }

  subscribeValues(cb: () => void): () => void {
    this.insightsListeners.add(cb);
    return () => {
      this.insightsListeners.delete(cb);
    };
  }

  private setInsights(s: number, top: number[][], b: number[]): void {
    this.insights = { seq: s, top: top.map((e) => [e[0], e[1]]), buckets: b.slice() };
    for (const cb of this.insightsListeners) {
      cb();
    }
  }

  apply(m: HostMessage): void {
    switch (m.t) {
      case 'init':
      case 'snap':
        if (m.k !== this.kind || m.s < this.seq || (m.k === 'list' && (m.n !== this.itemCount || m.summary[2] < this.summary.get()[2]))) {
          return;
        }
        this.seq = m.s;
        this.xr = m.xr === 1;
        this.token.set(m.tk);
        if (m.k === 'detail') {
          this.values.set(m.v.slice());
        } else if (m.k === 'insights') {
          this.setInsights(m.s, m.top, m.b);
          this.insightsDigest.set(m.idg);
        } else if (m.summary[2] >= this.summary.get()[2]) {
          m.rows.forEach((r, i) => this.rows[i]?.set(r.slice()));
          this.summary.set(m.summary.slice());
        }
        return;
      case 'row':
        if (this.kind !== 'list' || m.i >= this.itemCount || m.s < this.seq || m.summary[2] < this.summary.get()[2]) return;
        if (this.xr) this.marks.mark('xr.js', `s=${m.s}`);
        this.seq = m.s;
        this.rows[m.i].set(m.row.slice());
        if (m.summary.some((v, i) => v !== this.summary.get()[i])) this.summary.set(m.summary.slice());
        return;
      case 'v':
        if (this.xr) {
          this.marks.mark('xr.js', `s=${m.s}`);
        }
        if (this.kind === 'detail' && m.s > this.seq) {
          this.seq = m.s;
          this.values.set(m.v.slice());
        }
        return;
      case 'ins':
        if (this.xr) {
          this.marks.mark('xr.js', `s=${m.s}`);
        }
        if (this.kind === 'insights' && m.s > this.seq) {
          this.seq = m.s;
          this.setInsights(m.s, m.top, m.b);
        }
        return;
      case 'tk':
        this.token.set(m.k);
        return;
      case 'idg':
        this.insightsDigest.set(m.x);
        return;
      default:
        return;
    }
  }
}

/** All island instances of one runtime, addressed by `sid`. */
export class IslandRegistry {
  private readonly models = new Map<number, IslandModel>();
  private readonly pending = new Map<number, HostMessage[]>();
  private readonly marks: IslandMarks;

  constructor(marks: IslandMarks) {
    this.marks = marks;
  }

  /** The island root mounts with its `init` (object or JSON text); returns null when it is malformed. */
  adopt(init: unknown): IslandModel | null {
    const m = parseHostMessage(init);
    if (m === null || m.t !== 'init') {
      return null;
    }
    const existing = this.models.get(m.sid);
    if (existing !== undefined) {
      return existing;
    }
    const model = new IslandModel(m, this.marks);
    this.models.set(m.sid, model);
    const buffered = this.pending.get(m.sid);
    this.pending.delete(m.sid);
    for (const b of buffered ?? []) {
      model.apply(b);
    }
    return model;
  }

  /** One message from the host channel (object or JSON text); unknown messages are ignored. */
  dispatch(input: unknown): void {
    const m = parseHostMessage(input);
    if (m === null) {
      return;
    }
    const model = this.models.get(m.sid);
    if (model !== undefined) {
      model.apply(m);
      return;
    }
    if (m.t === 'init') {
      return;
    }
    let queue = this.pending.get(m.sid);
    if (queue === undefined) {
      queue = [];
      this.pending.set(m.sid, queue);
    }
    if (queue.length < MAX_BUFFERED) {
      queue.push(m);
    }
  }

  remove(sid: number): void {
    this.models.delete(sid);
    this.pending.delete(sid);
  }

  get size(): number {
    return this.models.size;
  }
}

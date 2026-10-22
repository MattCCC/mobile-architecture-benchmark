// First-usable-UI gate (design §8.4): `fui` is emitted from the draw callback that completes the set
// {row probes 0..kReq-1, summary probe}, all with their first-draw token `fui0`. `list.rendered` is a
// candidate-local diagnostic emitted when the row subset completes (usually the same frame).

export const ROW_HEIGHT = 72;

export type GateEvent = 'list.rendered' | 'fui';

export interface GateState {
  /** Selection count shown in the summary bar. */
  selectionCount(): number;
  /** Last applied seq (0 at FUI: the stream starts after FUI). */
  lastSeq(): number;
}

export class FuiGate {
  private armed = false;
  private complete = false;
  private kReq = -1;
  private hDp = -1;
  private rowsDrawn = new Set<number>();
  private rowsComplete = false;
  private summaryDrawn = false;

  constructor(
    private readonly state: GateState,
    private readonly emit: (event: GateEvent, payload: string) => void,
  ) {}

  /** Starts a new gate (cold start or new root UI in a live process, §8.3). */
  arm(): void {
    this.armed = true;
    this.complete = false;
    this.kReq = -1;
    this.hDp = -1;
    this.rowsDrawn = new Set<number>();
    this.rowsComplete = false;
    this.summaryDrawn = false;
  }

  /** Restoration launches do not emit `fui`; `restore` marks the usable state instead (§8.8). */
  disarm(): void {
    this.armed = false;
  }

  get done(): boolean {
    return this.complete;
  }

  get active(): boolean {
    return this.armed && !this.complete;
  }

  get requiredRows(): number {
    return this.kReq;
  }

  /** First layout of the list container, height in dp/pt. */
  listLayout(heightDp: number): void {
    if (!this.active || this.kReq >= 0) {
      return;
    }
    this.hDp = Math.floor(heightDp + 1e-3);
    this.kReq = Math.floor(this.hDp / ROW_HEIGHT);
    this.evaluate();
  }

  rowDrawn(index: number): void {
    if (!this.active || this.rowsDrawn.has(index)) {
      return;
    }
    this.rowsDrawn.add(index);
    this.evaluate();
  }

  summaryProbeDrawn(): void {
    if (!this.active || this.summaryDrawn) {
      return;
    }
    this.summaryDrawn = true;
    this.evaluate();
  }

  private evaluate(): void {
    if (this.kReq < 1) {
      return;
    }
    if (!this.rowsComplete) {
      for (let i = 0; i < this.kReq; i += 1) {
        if (!this.rowsDrawn.has(i)) {
          return;
        }
      }
      this.rowsComplete = true;
      this.emit('list.rendered', `rows=${this.kReq};h=${this.hDp}`);
    }
    if (this.summaryDrawn) {
      this.complete = true;
      this.emit(
        'fui',
        `rows=${this.kReq};h=${this.hDp};sel=${this.state.selectionCount()};seq=${this.state.lastSeq()}`,
      );
    }
  }
}

/** Draw-probe token bookkeeping (§6.2 probe tokens): a marker is due when the token differs from the last
 *  emitted one. */
export class TokenProbe<T> {
  private token = '';
  private emitted = '';
  private pending: T | null = null;

  /** Sets a new token; returns true when the probe must force a redraw. */
  set(token: string, pending: T): boolean {
    if (token === this.token) {
      return false;
    }
    this.token = token;
    this.pending = pending;
    return true;
  }

  /** Marks the current token as already emitted (no marker due). */
  settle(token: string): void {
    this.token = token;
    this.emitted = token;
    this.pending = null;
  }

  /** Called from the draw callback; returns the pending emission once per token. */
  drawn(): T | null {
    if (this.pending === null || this.token === this.emitted) {
      return null;
    }
    this.emitted = this.token;
    const p = this.pending;
    this.pending = null;
    return p;
  }

  get current(): string {
    return this.token;
  }
}

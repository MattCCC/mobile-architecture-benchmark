/** Batch row-render instrumentation once per JS turn, keeping one bridge message per rendered batch. */
export class RenderCounter {
  private pending = 0;

  private readonly report: (count: number) => void;

  constructor(report: (count: number) => void) {
    this.report = report;
  }

  rendered(): void {
    if (++this.pending !== 1) return;
    Promise.resolve().then(() => {
      const count = this.pending;
      this.pending = 0;
      this.report(count);
    });
  }
}

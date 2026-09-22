// Small, dependency-free tallies printed as markdown.

export class Confusion {
  readonly truths: string[];
  readonly predictions: string[];
  private readonly counts = new Map<string, number>();

  constructor(truths: string[], predictions: string[]) {
    this.truths = truths;
    this.predictions = predictions;
  }

  add(truth: string, prediction: string): void {
    const key = `${truth}\u0000${prediction}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  get(truth: string, prediction: string): number {
    return this.counts.get(`${truth}\u0000${prediction}`) ?? 0;
  }

  total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  /** Accuracy over rows whose prediction is one of `decided` (i.e. excluding abstentions). */
  accuracy(decided: string[]): { correct: number; decided: number } {
    let correct = 0;
    let n = 0;
    for (const t of this.truths) {
      for (const p of decided) {
        const c = this.get(t, p);
        n += c;
        if (t === p) correct += c;
      }
    }
    return { correct, decided: n };
  }

  table(): string {
    const header = `| truth \\ predicted | ${this.predictions.join(" | ")} | total |`;
    const sep = `| --- | ${this.predictions.map(() => "---").join(" | ")} | --- |`;
    const rows = this.truths.map((t) => {
      const cells = this.predictions.map((p) => this.get(t, p));
      return `| ${t} | ${cells.join(" | ")} | ${cells.reduce((a, b) => a + b, 0)} |`;
    });
    return [header, sep, ...rows].join("\n");
  }
}

export function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((100 * n) / d).toFixed(0)}% (${n}/${d})`;
}

export function precisionRecall(tp: number, fp: number, fn: number): string {
  const p = tp + fp === 0 ? "—" : (tp / (tp + fp)).toFixed(2);
  const r = tp + fn === 0 ? "—" : (tp / (tp + fn)).toFixed(2);
  return `precision ${p} (${tp}/${tp + fp}), recall ${r} (${tp}/${tp + fn})`;
}

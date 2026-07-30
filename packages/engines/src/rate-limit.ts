export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastCleanup = Date.now();

  constructor(private readonly limitPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    if (now - this.lastCleanup > 60_000) {
      this.cleanup(now);
      this.lastCleanup = now;
    }
    const windowStart = now - 60_000;
    const arr = (this.hits.get(key) ?? []).filter((t) => t >= windowStart);
    if (arr.length >= this.limitPerMinute) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  private cleanup(now: number): void {
    const windowStart = now - 60_000;
    for (const [key, arr] of this.hits) {
      const fresh = arr.filter((t) => t >= windowStart);
      if (!fresh.length) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }
}

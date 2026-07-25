export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limitPerMinute: number) {}

  allow(key: string): boolean {
    const now = Date.now();
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
}

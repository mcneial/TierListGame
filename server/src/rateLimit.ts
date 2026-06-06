interface RateLimitState {
  failures: number[];
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

export class InMemoryRateLimiter {
  private readonly attemptsByIp = new Map<string, RateLimitState>();

  registerFailure(ip: string) {
    const state = this.ensureState(ip);
    const now = Date.now();
    state.failures = state.failures.filter((timestamp) => now - timestamp < WINDOW_MS);
    state.failures.push(now);
  }

  isBlocked(ip: string) {
    const state = this.ensureState(ip);
    const now = Date.now();
    state.failures = state.failures.filter((timestamp) => now - timestamp < WINDOW_MS);
    return state.failures.length >= MAX_FAILURES;
  }

  private ensureState(ip: string) {
    const existing = this.attemptsByIp.get(ip);
    if (existing) {
      return existing;
    }

    const created: RateLimitState = { failures: [] };
    this.attemptsByIp.set(ip, created);
    return created;
  }
}

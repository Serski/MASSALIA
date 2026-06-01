export type TimestampMs = number;

export interface AccruingResource {
  amount: number;
  ratePerSecond: number;
  lastUpdatedAt: TimestampMs;
  cap?: number;
}

export function secondsBetween(from: TimestampMs, to: TimestampMs): number {
  return Math.max(0, Math.floor((to - from) / 1000));
}

export function accrueResource(resource: AccruingResource, now: TimestampMs): AccruingResource {
  const elapsedSeconds = secondsBetween(resource.lastUpdatedAt, now);
  const accrued = resource.amount + resource.ratePerSecond * elapsedSeconds;
  return {
    ...resource,
    amount: resource.cap === undefined ? accrued : Math.min(resource.cap, accrued),
    lastUpdatedAt: now,
  };
}

export function completionDelayMs(now: TimestampMs, completesAt: TimestampMs): number {
  return Math.max(0, completesAt - now);
}

export function parseJsonSafe<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function toTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function fromTimestamp(ts: number): Date {
  return new Date(ts * 1000);
}

export function nowTimestamp(): number {
  return toTimestamp(new Date());
}

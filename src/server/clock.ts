import "server-only";

export interface Clock {
  now(): Date;
  nowMs(): number;
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}

let activeClock: Clock = new SystemClock();

export function getClock(): Clock {
  return activeClock;
}

export function setClockForTesting(clock: Clock): void {
  activeClock = clock;
}

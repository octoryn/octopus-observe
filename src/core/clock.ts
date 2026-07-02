/**
 * A clock is an injectable source of the current time in epoch milliseconds.
 *
 * The pipeline never reads the ambient clock directly. Injecting time keeps
 * ingest deterministic under test and makes `ingestedAt` / audit timestamps a
 * controlled input rather than hidden state.
 */
export type Clock = () => number;

/** The default clock: wall-clock time. */
export const systemClock: Clock = () => Date.now();

/**
 * A clock that returns a fixed instant, or steps forward by `step` ms on each
 * read when `step` is provided. Useful for deterministic tests and replays.
 */
export function fixedClock(start: number, step = 0): Clock {
  let current = start;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

// A one-at-a-time task queue.
//
// Photo uploads run through this rather than in parallel. On a lot with one
// bar, six simultaneous uploads all crawl and any of them can time out;
// serialised, each gets the whole connection and a failure is isolated to its
// own photo.
//
// The important property is that a REJECTED task does not break the chain:
// a failure on photo four must not take out five and six.

export type Enqueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): Enqueue {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    // Chained onto BOTH settle paths, so the next task starts whether the
    // previous one resolved or threw.
    const next = tail.then(task, task);
    // The queue's own tail must never be a rejected promise, or every later
    // task would inherit an unhandled rejection. Callers still get the real
    // result from `next`.
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

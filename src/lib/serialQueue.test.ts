// Unit tests for the upload queue. Runs standalone under tsx:
//
//   npx tsx src/lib/serialQueue.test.ts

import assert from "node:assert/strict";
import { createSerialQueue } from "./serialQueue";

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("serialQueue");

  await test("runs tasks ONE AT A TIME, never overlapping", async () => {
    const enqueue = createSerialQueue();
    let running = 0;
    let maxConcurrent = 0;
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        enqueue(async () => {
          running++;
          maxConcurrent = Math.max(maxConcurrent, running);
          await tick(10);
          order.push(n);
          running--;
        }),
      ),
    );

    assert.equal(maxConcurrent, 1, "two uploads were in flight at once");
    assert.deepEqual(order, [1, 2, 3, 4], "tasks must finish in the order queued");
  });

  await test("a failing task does not stop the ones behind it", async () => {
    // The brief's requirement, literally: a failure on photo four must not
    // wipe photos one through three — nor block five and six.
    const enqueue = createSerialQueue();
    const finished: string[] = [];

    const results = await Promise.allSettled([
      enqueue(async () => {
        finished.push("one");
      }),
      enqueue(async () => {
        finished.push("two");
      }),
      enqueue(async () => {
        throw new Error("photo three failed");
      }),
      enqueue(async () => {
        finished.push("four");
      }),
      enqueue(async () => {
        finished.push("five");
      }),
    ]);

    assert.deepEqual(finished, ["one", "two", "four", "five"]);
    assert.equal(results[2].status, "rejected");
    assert.equal(
      results.filter((r) => r.status === "fulfilled").length,
      4,
      "every other task still completed",
    );
  });

  await test("the caller gets the real error, not a swallowed one", async () => {
    const enqueue = createSerialQueue();
    await assert.rejects(
      enqueue(async () => {
        throw new Error("upload failed: HTTP 503");
      }),
      /HTTP 503/,
    );
  });

  await test("the caller gets the task's return value", async () => {
    const enqueue = createSerialQueue();
    const url = await enqueue(async () => "https://blob/front.jpg");
    assert.equal(url, "https://blob/front.jpg");
  });

  await test("a retry queued after a failure still runs", async () => {
    const enqueue = createSerialQueue();
    let attempts = 0;
    const attempt = () =>
      enqueue(async () => {
        attempts++;
        if (attempts === 1) throw new Error("first try failed");
        return "ok";
      });

    await assert.rejects(attempt());
    assert.equal(await attempt(), "ok", "the retry must go through");
    assert.equal(attempts, 2);
  });

  await test("tasks queued later, while one is running, still serialise", async () => {
    const enqueue = createSerialQueue();
    const order: string[] = [];
    const first = enqueue(async () => {
      await tick(20);
      order.push("first");
    });
    await tick(5); // second is added mid-flight, the realistic case
    const second = enqueue(async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
  });

  console.log(`\n${passed} test(s) passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

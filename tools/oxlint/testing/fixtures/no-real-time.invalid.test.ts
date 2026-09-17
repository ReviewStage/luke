import { setTimeout as sleep } from "node:timers/promises";
import { Effect } from "effect";

/** Declared rather than imported: this fixture is read as syntax, never resolved. */
declare const it: {
  (name: string, body: () => unknown): void;
  readonly effect: (name: string, body: () => Effect.Effect<unknown>) => void;
  readonly live: (name: string, body: () => Effect.Effect<unknown>) => void;
};

it("waits on the machine", async () => {
  await sleep(10);
  await new Promise((resolve) => setTimeout(resolve, 10));
  globalThis.setInterval(() => {}, 10);
});

it.live("runs on the real clock", () => Effect.sleep("10 millis"));

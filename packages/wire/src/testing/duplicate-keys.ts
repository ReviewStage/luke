/**
 * duplicate-keys.ts -- fails a test that rendered two siblings under one React key, named with the key.
 *
 * Two siblings under one key make React lose track of one of them: it may
 * drop, duplicate, or leave behind an element that should be gone, as the
 * plan's head once kept every earlier task's title. React says so only
 * through `console.error`, which fails nothing, and a key may cross a
 * component's edge (a slot such as `PlanBody`'s `head`) where no lint can
 * follow it. The `vitest.config.ts` of every React suite (the panel, `@repo/ui`,
 * and the web, catalog, and desktop apps) runs this before each of its files,
 * by a relative path since vitest resolves a setup file by path: it records React's message as it is printed and fails
 * the test that printed it from its `afterEach`, which runs after the file's
 * own, and the file from its `afterAll` for one printed after its last test.
 *
 * Note that `console.error` is wrapped by assignment rather than spied on,
 * because a test's `vi.restoreAllMocks()` would take a spy away, and that the
 * test fails in `afterEach` rather than in `console.error`, because React
 * prints the message mid-render, where a throw would be React's to catch.
 * Note too that a message printed between one test's `afterEach` and the
 * next test's start, from an update nobody awaited, is blamed on the next
 * test, and this does not flush React's work to say otherwise.
 */

import { afterAll, afterEach } from "vitest";

/** The start of React's format string for the message, whose one argument is the key. */
const DUPLICATE_KEY = "Encountered two children with the same key";

/** The keys React has said two siblings shared since the last test ended. */
const duplicated: unknown[] = [];

const printError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const [format, key] = args;
  if (typeof format === "string" && format.startsWith(DUPLICATE_KEY)) duplicated.push(key);
  printError(...args);
};

/** Throws if React has said two siblings shared a key since the last check. */
function failOnDuplicated(): void {
  const keys = duplicated.splice(0);
  if (keys.length === 0) return;
  const named = [...new Set(keys.map(String))].map((key) => `\`${key}\``).join(", ");
  throw new Error(
    `Rendered two siblings under one key (${named}), which React may drop, duplicate, or leave behind: key each by a value already its own.`,
  );
}

afterEach(failOnDuplicated);

// Note that this runs after the file's last `afterEach`, so it holds what was printed once no test was left to be blamed.
afterAll(failOnDuplicated);

/**
 * duplicate-keys.ts -- fails a test that rendered two siblings under one React key, named with the key.
 *
 * Two siblings under one key make React lose track of one of them: it may
 * drop, duplicate, or leave behind an element that should be gone, as the
 * plan's head once kept every earlier task's title. React says so only
 * through `console.error`, which fails nothing, and a key may cross a
 * component's edge (a slot such as `PlanBody`'s `head`) where no lint can
 * follow it. The panel's `vitest.config.ts` runs this before each of its
 * files: it records React's message as it is printed and fails the test that
 * printed it from its `afterEach`, which runs after the file's own.
 *
 * Note that `console.error` is wrapped by assignment rather than spied on,
 * because a test's `vi.restoreAllMocks()` would take a spy away, and that the
 * test fails in `afterEach` rather than in `console.error`, because React
 * prints the message mid-render, where a throw would be React's to catch.
 */

import { afterEach } from "vitest";

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

afterEach(() => {
  const keys = duplicated.splice(0);
  if (keys.length === 0) return;
  const named = [...new Set(keys.map(String))].map((key) => `\`${key}\``).join(", ");
  throw new Error(
    `Rendered two siblings under one key (${named}), which React may drop, duplicate, or leave behind: key each by a value already its own.`,
  );
});

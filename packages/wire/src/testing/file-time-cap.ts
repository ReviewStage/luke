/**
 * file-time-cap.ts -- fails a test file that runs past 90 s in CI, so no one file holds a CI job alone.
 *
 * Vitest runs a file on one worker, so a file is the smallest piece a CI job
 * can be cut into: a file that takes three minutes holds its shard for three
 * minutes however many shards stand beside it. Every workspace's
 * `vitest.config.ts` runs this before each of its files, by a relative path
 * since vitest resolves a setup file by path; its `beforeAll` runs before the
 * file's own hooks and its `afterAll` after them, so it times the file from
 * its first hook to its last and fails it, named with its time, past the cap.
 *
 * Note that the cap holds only where `CI` is set, because a laptop's speed
 * varies too widely for one number to mean anything there, and that it is
 * 90 s rather than 60 s, because the slowest files bar the Inbox's took 67–74 s
 * in CI when it was set and a runner's speed swings by about 30%.
 */

import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

/** The longest a test file may run in CI, from its first hook to its last. */
const FILE_TIME_CAP_MS = 90_000;

// Note that the clock is taken before any test runs, because a test that fakes `performance` would stop this one.
const now = performance.now.bind(performance);

let startedAt = 0;

beforeAll(() => {
  startedAt = now();
});

// Note that the file is named from expect's state rather than the hook's suite, because vitest reads a hook's first argument as its fixtures.
afterAll(() => {
  const took = now() - startedAt;
  if (!process.env.CI || took <= FILE_TIME_CAP_MS) return;
  const file = path.relative(process.cwd(), expect.getState().testPath ?? "");
  throw new Error(
    `${file} took ${(took / 1000).toFixed(1)} s, past the ${FILE_TIME_CAP_MS / 1000} s a test file may take in CI: split it, so its parts run on workers of their own.`,
  );
});

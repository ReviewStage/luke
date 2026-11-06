import path from "node:path";
import { afterAll, beforeAll, expect } from "vitest";

const FILE_TIME_CAP_MS = 90_000;

const now = performance.now.bind(performance);

let startedAt = 0;

beforeAll(() => {
  startedAt = now();
});

afterAll(() => {
  const took = now() - startedAt;
  if (!process.env.CI || took <= FILE_TIME_CAP_MS) return;
  const file = path.relative(process.cwd(), expect.getState().testPath ?? "");
  throw new Error(
    `${file} took ${(took / 1000).toFixed(1)} s, past the ${FILE_TIME_CAP_MS / 1000} s a test file may take in CI: split it, so its parts run on workers of their own.`,
  );
});

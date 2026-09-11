import assert from "node:assert/strict";
import { type ProviderSessionObservation, SESSION_STATUS } from "@sidecar/session";
import { test } from "vitest";
import type { SessionFileCandidate } from "./local-files.js";
import { observationPass, rosterHolder } from "./observation-pass.js";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function candidate(
  providerSessionId: string,
  mtimeMs: number,
  filePath = `/sessions/${providerSessionId}.jsonl`,
): SessionFileCandidate {
  return { filePath, providerSessionId, mtimeMs };
}

interface PassHarness {
  candidates: SessionFileCandidate[];
  parses: string[];
  pass: ReturnType<typeof observationPass<SessionFileCandidate, string>>;
}

function harness(
  observation?: (
    input: Readonly<{ candidate: SessionFileCandidate; parsed: string }>,
  ) => ProviderSessionObservation | undefined,
): PassHarness {
  const candidates: SessionFileCandidate[] = [];
  const parses: string[] = [];
  const pass = observationPass<SessionFileCandidate, string>({
    now: () => NOW,
    discover: async () => candidates,
    parse: async (entry) => {
      parses.push(entry.filePath);
      return `${entry.filePath}@${entry.mtimeMs}`;
    },
    observation:
      observation ??
      (({ candidate: entry, parsed }) => ({
        providerSessionId: entry.providerSessionId,
        title: parsed,
        status: SESSION_STATUS.WORKING,
        lastActivityAt: entry.mtimeMs,
      })),
  });
  return { candidates, parses, pass };
}

test("a file whose mtime has not moved is not parsed again", async () => {
  const { candidates, parses, pass } = harness();
  candidates.push(candidate("one", 10));
  await pass.run();
  await pass.run();
  assert.deepEqual(parses, ["/sessions/one.jsonl"]);
});

test("a file whose mtime moved is parsed again", async () => {
  const { candidates, parses, pass } = harness();
  candidates.push(candidate("one", 10));
  await pass.run();
  candidates[0] = candidate("one", 11);
  const observations = await pass.run();
  assert.deepEqual(parses, ["/sessions/one.jsonl", "/sessions/one.jsonl"]);
  assert.equal(observations[0]?.title, "/sessions/one.jsonl@11");
});

test("a vanished file's parse is pruned, so its return is a fresh read", async () => {
  const { candidates, parses, pass } = harness();
  candidates.push(candidate("one", 10));
  await pass.run();
  candidates.length = 0;
  await pass.run();
  candidates.push(candidate("one", 10));
  await pass.run();
  assert.deepEqual(parses, ["/sessions/one.jsonl", "/sessions/one.jsonl"]);
});

test("a session id two files claim resolves to the first the discovery ordered", async () => {
  const { candidates, parses, pass } = harness();
  candidates.push(
    candidate("one", 20, "/sessions/newest.jsonl"),
    candidate("one", 10, "/sessions/oldest.jsonl"),
  );
  const observations = await pass.run();
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "/sessions/newest.jsonl@20");
  assert.deepEqual(parses, ["/sessions/newest.jsonl"]);
});

test("a candidate the provider declines to observe leaves no row", async () => {
  const { candidates, pass } = harness(({ candidate: entry }) =>
    entry.providerSessionId === "hidden"
      ? undefined
      : {
          providerSessionId: entry.providerSessionId,
          title: entry.providerSessionId,
          status: SESSION_STATUS.WORKING,
          lastActivityAt: entry.mtimeMs,
        },
  );
  candidates.push(candidate("hidden", 10), candidate("shown", 11));
  const observations = await pass.run();
  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["shown"],
  );
});

test("prepare runs once per pass, before any parse", async () => {
  const order: string[] = [];
  const pass = observationPass<SessionFileCandidate, string>({
    now: () => NOW,
    discover: async () => [candidate("one", 10), candidate("two", 11)],
    prepare: () => {
      order.push("prepare");
    },
    parse: async (entry) => {
      order.push(`parse:${entry.providerSessionId}`);
      return entry.providerSessionId;
    },
    observation: ({ candidate: entry }) => ({
      providerSessionId: entry.providerSessionId,
      title: entry.providerSessionId,
      status: SESSION_STATUS.WORKING,
      lastActivityAt: entry.mtimeMs,
    }),
  });
  await pass.run();
  assert.deepEqual(order, ["prepare", "parse:one", "parse:two"]);
});

test("latest answers exactly what the last run published", async () => {
  const { candidates, pass } = harness();
  assert.deepEqual(pass.latest(), []);
  candidates.push(candidate("one", 10));
  const observations = await pass.run();
  assert.deepEqual(pass.latest(), observations);
});

test("a roster holder answers exactly what it last published", () => {
  const roster = rosterHolder();
  const published = roster.publish([
    {
      providerSessionId: "one",
      title: "one",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: NOW,
    },
  ]);
  assert.deepEqual(roster.latest(), published);
});

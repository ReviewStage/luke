import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type ProviderSessionObservation, SESSION_STATUS } from "@sidecar/session";
import { Effect } from "effect";
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
    discover: () => Effect.succeed(candidates),
    parse: (entry) =>
      Effect.sync(() => {
        parses.push(entry.filePath);
        return `${entry.filePath}@${entry.mtimeMs}`;
      }),
    observation: (input) =>
      Effect.succeed(
        observation
          ? observation(input)
          : {
              providerSessionId: input.candidate.providerSessionId,
              title: input.parsed,
              status: SESSION_STATUS.WORKING,
              lastActivityAt: input.candidate.mtimeMs,
            },
      ),
  });
  return { candidates, parses, pass };
}

it.effect("a file whose mtime has not moved is not parsed again", () =>
  Effect.gen(function* () {
    const { candidates, parses, pass } = harness();
    candidates.push(candidate("one", 10));
    yield* pass.run;
    yield* pass.run;
    assert.deepEqual(parses, ["/sessions/one.jsonl"]);
  }),
);

it.effect("a file whose mtime moved is parsed again", () =>
  Effect.gen(function* () {
    const { candidates, parses, pass } = harness();
    candidates.push(candidate("one", 10));
    yield* pass.run;
    candidates[0] = candidate("one", 11);
    const observations = yield* pass.run;
    assert.deepEqual(parses, ["/sessions/one.jsonl", "/sessions/one.jsonl"]);
    assert.equal(observations[0]?.title, "/sessions/one.jsonl@11");
  }),
);

it.effect("a vanished file's parse is pruned, so its return is a fresh read", () =>
  Effect.gen(function* () {
    const { candidates, parses, pass } = harness();
    candidates.push(candidate("one", 10));
    yield* pass.run;
    candidates.length = 0;
    yield* pass.run;
    candidates.push(candidate("one", 10));
    yield* pass.run;
    assert.deepEqual(parses, ["/sessions/one.jsonl", "/sessions/one.jsonl"]);
  }),
);

it.effect("a session id two files claim resolves to the first the discovery ordered", () =>
  Effect.gen(function* () {
    const { candidates, parses, pass } = harness();
    candidates.push(
      candidate("one", 20, "/sessions/newest.jsonl"),
      candidate("one", 10, "/sessions/oldest.jsonl"),
    );
    const observations = yield* pass.run;
    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.title, "/sessions/newest.jsonl@20");
    assert.deepEqual(parses, ["/sessions/newest.jsonl"]);
  }),
);

it.effect("a candidate the provider declines to observe leaves no row", () =>
  Effect.gen(function* () {
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
    const observations = yield* pass.run;
    assert.deepEqual(
      observations.map((observation) => observation.providerSessionId),
      ["shown"],
    );
  }),
);

it.effect("prepare runs once per pass, before any parse", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const pass = observationPass<SessionFileCandidate, string>({
      now: () => NOW,
      discover: () => Effect.succeed([candidate("one", 10), candidate("two", 11)]),
      prepare: () =>
        Effect.sync(() => {
          order.push("prepare");
        }),
      parse: (entry) =>
        Effect.sync(() => {
          order.push(`parse:${entry.providerSessionId}`);
          return entry.providerSessionId;
        }),
      observation: ({ candidate: entry }) =>
        Effect.succeed({
          providerSessionId: entry.providerSessionId,
          title: entry.providerSessionId,
          status: SESSION_STATUS.WORKING,
          lastActivityAt: entry.mtimeMs,
        }),
    });
    yield* pass.run;
    assert.deepEqual(order, ["prepare", "parse:one", "parse:two"]);
  }),
);

it.effect("latest answers exactly what the last run published", () =>
  Effect.gen(function* () {
    const { candidates, pass } = harness();
    assert.deepEqual(pass.latest(), []);
    candidates.push(candidate("one", 10));
    const observations = yield* pass.run;
    assert.deepEqual(pass.latest(), observations);
  }),
);

it("a roster holder answers exactly what it last published", () => {
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

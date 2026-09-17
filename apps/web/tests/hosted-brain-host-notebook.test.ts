import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { maximumMemorySearchResults, RETRIEVAL_MODE } from "@sidecar/memory";
import { fakeHttpClient } from "@sidecar/wire/testing";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll } from "vitest";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "../server/core";
import { workspaceEmbedding } from "../server/db/workspace-schema";
import type { HostedEmbedder } from "../server/hosted/brain-host/embedding";
import {
  HOSTED_NOTEBOOK_REFUSAL,
  type HostedNotebookSeams,
  hostedNotebookAccess,
  NOTEBOOK_SEARCH,
  NOTEBOOK_SEARCH_NOTE,
  notebookPath,
} from "../server/hosted/brain-host/notebook";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { countRows } from "./support/store-rows";

/**
 * The notebook's two reads over the account's real rows on the real
 * migrations: a search reads, cuts, and ranks in process, embeds the query
 * and the uncached passages once and caches the vectors, degrades to keyword
 * alone when it has no embedder or the embedder does not answer, and bounds
 * its backfill; a read answers a bounded line range and refuses anything
 * outside the notebook. The embedder is a fake over a tiny vocabulary, so
 * no vector here came from any model. Synthetic notes throughout.
 */

const NOW = Date.UTC(2026, 8, 15);
const NEVER = new AbortController().signal;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** A vector over a fixed vocabulary: a term's presence, and a constant so no vector is zero. */
const VOCABULARY = ["notch", "espresso", "desk", "friday"];
function vectorOf(text: string): readonly number[] {
  const lower = text.toLowerCase();
  return [...VOCABULARY.map((term) => (lower.includes(term) ? 1 : 0)), 0.1];
}

function fakeEmbedder(seen: string[][]): HostedEmbedder {
  return {
    model: "fake-embed",
    embed: (texts) =>
      Effect.sync(() => {
        seen.push([...texts]);
        return texts.map(vectorOf);
      }),
  };
}

const NOTEBOOK = {
  "MEMORY.md":
    "# MEMORY.md\n\n- The notch decision: keep the panel below the notch.\n- Ship on Friday.",
  "USER.md": "# USER.md\n\n- Prefers espresso in the mornings.\n- Works at a standing desk.",
  "memory/2026-09-14.md": "- Yesterday: shipped the release.",
  "memory/2026-07-17.md": "- Sixty days ago: the notch decision was first raised.",
  "AGENTS.md": "# AGENTS.md\n\nespresso notch desk friday: the agent notes are not the notebook.",
} as const;

/** A user with the notebook written under the ambient client. */
const seededUser = Effect.gen(function* () {
  const userId = yield* Effect.promise(() => database.createUser());
  for (const [path, content] of Object.entries(NOTEBOOK)) {
    yield* database.store.workspace.write(userId, path, content, NOW);
  }
  return userId;
});

function access(
  userId: string,
  embedder: HostedEmbedder | undefined,
  overrides: Partial<HostedNotebookSeams> = {},
) {
  return Effect.map(SqlClient.SqlClient, (client) =>
    hostedNotebookAccess({
      client,
      http: fakeHttpClient(() => {
        throw new Error("no search here reaches the network");
      }),
      store: database.store,
      userId,
      embedder,
      now: () => NOW,
      ...overrides,
    }),
  );
}

function paths(answer: WireRecord): readonly string[] {
  assert.ok(Array.isArray(answer.results));
  return answer.results.map((result) => {
    assert.ok(isRecord(result));
    assert.ok(isWireString(result.path));
    return result.path;
  });
}

it.layer(database.sql)("the notebook over the account's rows", (it) => {
  it.effect(
    "a hybrid search embeds the query and every uncached passage once, caches the vectors, ranks the notebook files alone, and embeds only the query next time",
    () =>
      Effect.gen(function* () {
        const userId = yield* seededUser;
        const seen: string[][] = [];
        const notebook = yield* access(userId, fakeEmbedder(seen));

        const first = yield* notebook.search({ query: "espresso", signal: NEVER });
        assert.equal(first.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(first.mode, RETRIEVAL_MODE.HYBRID);
        assert.equal(first.note, undefined);
        const found = paths(first);
        assert.equal(found[0], "USER.md");
        assert.equal(found.includes("AGENTS.md"), false, "AGENTS.md is not the notebook");
        assert.equal(seen.length, 1);
        assert.equal(seen[0]?.[0], "espresso");
        const passages = (seen[0]?.length ?? 0) - 1;
        assert.equal(passages, 4, "one passage per notebook file, each short");
        assert.equal(yield* countRows(workspaceEmbedding.userId, userId), passages);

        const second = yield* notebook.search({ query: "notch", signal: NEVER });
        assert.equal(second.mode, RETRIEVAL_MODE.HYBRID);
        assert.deepEqual(
          seen[1],
          ["notch"],
          "every passage is cached, so the query alone is embedded",
        );
        const notch = paths(second);
        assert.ok(
          notch.indexOf("MEMORY.md") < notch.indexOf("memory/2026-07-17.md"),
          "the sixty-day-old note decays below the evergreen file",
        );

        // A rewritten file's new passage is embedded, and the stale vector goes.
        yield* database.store.workspace.write(userId, "USER.md", "- Prefers tea now.", NOW + 1);
        const third = yield* notebook.search({ query: "tea", signal: NEVER });
        assert.equal(third.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(seen[2], ["tea", "- Prefers tea now."]);
        assert.equal(yield* countRows(workspaceEmbedding.userId, userId), passages);
      }),
  );

  it.effect(
    "a result names the path and the range memory_get takes back, a snippet, and a score in (0, 1], at most the ceiling of them",
    () =>
      Effect.gen(function* () {
        const userId = yield* seededUser;
        const notebook = yield* access(userId, undefined);
        const answer = yield* notebook.search({
          query: "notch decision",
          signal: NEVER,
          maxResults: 1,
        });
        assert.ok(Array.isArray(answer.results));
        assert.equal(answer.results.length, 1);
        assert.deepEqual(answer.results[0], {
          path: "MEMORY.md",
          from: 1,
          lines: 4,
          snippet:
            "# MEMORY.md - The notch decision: keep the panel below the notch. - Ship on Friday.",
          score: 1,
        });
        const wide = yield* notebook.search({ query: "notch", signal: NEVER });
        assert.ok(Array.isArray(wide.results));
        assert.ok(wide.results.length <= maximumMemorySearchResults);
      }),
  );

  it.effect(
    "without an embedder, or with one that does not answer, or once the turn is over, a search is keyword-only and says which",
    () =>
      Effect.gen(function* () {
        const userId = yield* seededUser;

        const none = yield* (yield* access(userId, undefined)).search({
          query: "espresso",
          signal: NEVER,
        });
        assert.equal(none.mode, RETRIEVAL_MODE.KEYWORD);
        assert.equal(none.note, NOTEBOOK_SEARCH_NOTE.NO_CREDENTIAL);
        assert.equal(paths(none)[0], "USER.md", "the keyword lane still answers");

        const silent: HostedEmbedder = { model: "silent", embed: () => Effect.succeed(undefined) };
        const unanswered = yield* (yield* access(userId, silent)).search({
          query: "espresso",
          signal: NEVER,
        });
        assert.equal(unanswered.mode, RETRIEVAL_MODE.KEYWORD);
        assert.equal(unanswered.note, NOTEBOOK_SEARCH_NOTE.NOT_ANSWERED);
        assert.equal(yield* countRows(workspaceEmbedding.userId, userId), 0);

        const over = new AbortController();
        over.abort();
        const hanging: HostedEmbedder = { model: "hanging", embed: () => Effect.never };
        const ended = yield* (yield* access(userId, hanging)).search({
          query: "espresso",
          signal: over.signal,
        });
        assert.equal(ended.mode, RETRIEVAL_MODE.KEYWORD);
        assert.equal(ended.note, NOTEBOOK_SEARCH_NOTE.TURN_OVER);
        assert.equal(paths(ended)[0], "USER.md");
      }),
  );

  it.effect(
    "the backfill is bounded: a search embeds at most the batch of uncached passages, notes the rest, and later searches fill the cache",
    () =>
      Effect.gen(function* () {
        const userId = yield* seededUser;
        const seen: string[][] = [];
        const notebook = yield* access(userId, fakeEmbedder(seen), { embedBatch: 1 });

        const first = yield* notebook.search({ query: "desk", signal: NEVER });
        assert.equal(first.mode, RETRIEVAL_MODE.HYBRID);
        assert.equal(seen[0]?.length, 2, "the query and one passage");
        assert.match(String(first.note), /^3 passages await embedding/);
        assert.equal(yield* countRows(workspaceEmbedding.userId, userId), 1);

        yield* notebook.search({ query: "desk", signal: NEVER });
        yield* notebook.search({ query: "desk", signal: NEVER });
        const fourth = yield* notebook.search({ query: "desk", signal: NEVER });
        assert.equal(fourth.note, undefined);
        assert.equal(yield* countRows(workspaceEmbedding.userId, userId), 4);
        assert.equal(NOTEBOOK_SEARCH.EMBED_BATCH, 64);
      }),
  );

  it.effect("an empty notebook searches to nothing without embedding anything", () =>
    Effect.gen(function* () {
      const userId = yield* Effect.promise(() => database.createUser());
      const seen: string[][] = [];
      const answer = yield* (yield* access(userId, fakeEmbedder(seen))).search({
        query: "anything",
        signal: NEVER,
      });
      assert.deepEqual(answer, {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        mode: RETRIEVAL_MODE.HYBRID,
        results: [],
      });
      assert.deepEqual(seen, []);
    }),
  );

  it.effect(
    "memory_get answers a bounded excerpt by line range, says when more follows, and refuses a path outside the notebook, a missing file, and a line past the end",
    () =>
      Effect.gen(function* () {
        const userId = yield* Effect.promise(() => database.createUser());
        const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`);
        yield* database.store.workspace.write(userId, "MEMORY.md", lines.join("\n"), NOW);
        const notebook = yield* access(userId, undefined);
        const read = (ask: Parameters<typeof notebook.get>[0]) => notebook.get(ask);

        const whole = yield* read({ path: "MEMORY.md" });
        assert.equal(whole.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(whole.from, 1);
        assert.equal(whole.to, NOTEBOOK_SEARCH.DEFAULT_LINES);
        assert.equal(whole.total_lines, 200);
        assert.equal(whole.truncated, true);
        assert.equal(whole.text, lines.slice(0, NOTEBOOK_SEARCH.DEFAULT_LINES).join("\n"));

        assert.deepEqual(yield* read({ path: "MEMORY.md", from: 100, lines: 5 }), {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          path: "MEMORY.md",
          from: 100,
          to: 104,
          total_lines: 200,
          truncated: true,
          text: "line 100\nline 101\nline 102\nline 103\nline 104",
        });
        const tail = yield* read({ path: "MEMORY.md", from: 199, lines: 50 });
        assert.equal(tail.to, 200);
        assert.equal(tail.truncated, false);
        const capped = yield* read({ path: "MEMORY.md", lines: 5_000 });
        assert.equal(
          capped.to,
          NOTEBOOK_SEARCH.MAXIMUM_LINES > 200 ? 200 : NOTEBOOK_SEARCH.MAXIMUM_LINES,
        );

        const belowStart = yield* read({ path: "MEMORY.md", from: 0, lines: 2 });
        assert.equal(belowStart.from, 1);
        assert.equal(belowStart.to, 2);
        assert.equal(belowStart.text, (yield* read({ path: "MEMORY.md", from: 1, lines: 2 })).text);

        assert.deepEqual(yield* read({ path: "MEMORY.md", from: 201 }), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: HOSTED_NOTEBOOK_REFUSAL.PAST_END,
        });
        assert.deepEqual(yield* read({ path: "memory/2026-01-01.md" }), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: HOSTED_NOTEBOOK_REFUSAL.NOT_FOUND,
        });
        for (const outside of [
          "AGENTS.md",
          "../MEMORY.md",
          "/etc/passwd",
          "memory/../USER.md",
          "memory/notes/x.md",
          "memory/x.txt",
          "",
        ]) {
          assert.deepEqual(
            yield* read({ path: outside }),
            { status: ACTION_RESULT_STATUS.REJECTED, reason: HOSTED_NOTEBOOK_REFUSAL.NOT_NOTEBOOK },
            outside,
          );
        }
      }),
  );

  it("the notebook's paths are MEMORY.md, USER.md, and a Markdown file directly under memory/", () => {
    assert.equal(notebookPath("MEMORY.md"), "MEMORY.md");
    assert.equal(notebookPath("USER.md"), "USER.md");
    assert.equal(notebookPath("memory/2026-09-14.md"), "memory/2026-09-14.md");
    assert.equal(notebookPath("memory/2026-09-14-standup.md"), "memory/2026-09-14-standup.md");
    assert.equal(notebookPath("IDENTITY.md"), undefined);
    assert.equal(notebookPath("memory/"), undefined);
    assert.equal(notebookPath("memory/a/b.md"), undefined);
    assert.equal(notebookPath("Memory/2026-09-14.md"), undefined);
  });
});

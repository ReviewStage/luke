import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  type Agent,
  createAgent,
  discardAgent,
  readAgent,
  recordAgentCompaction,
  recordAgentPublished,
  recordAgentStep,
  renameAgent,
  takeAgentMentionedServers,
  updateAgentBranch,
} from "@luke/database/models/agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { savePlanText } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { agentTable } from "@luke/database/schemas/agent";
import { messages } from "@luke/database/schemas/storage";
import { getTestDB, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  firstMessageParts,
  firstMessageText,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  REPLAY_TOOL_STATE,
  REPLAY_VALUE_FORM,
  START_NOTE_HEADING,
  stepsBytes,
} from "@luke/features/agent-replay";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_STATUS,
  agentAnswerSchema,
  agentListAnswerSchema,
  agentPageAnswerSchema,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { AUTOMATION_FIRING } from "@luke/features/automation-wire";
import { keptPictureIdOf } from "@luke/features/conversation-picture-wire";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import type { WireBoundaryInput } from "@luke/wire";
import { temporaryDirectory } from "@luke/wire/testing";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Option } from "effect";
import { afterEach, type TestContext, vi } from "vitest";
import {
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT,
  AGENT_STARTS,
  fakeEve,
  LONG_TURNS,
  openedParts,
  openTask,
  PNG,
  PUBLISHED,
  publishedPullRequest,
  RELAY_FULL_NAME,
  readAnswer,
  refusal,
  request,
  SIZED_PNG,
  SMALL_WINDOW,
  SNAPSHOT,
  SOL,
  startAs,
  TASK_AGENTS,
  text,
  transcriptRow,
} from "../testing/agents-app-support.js";
import type { RepositoryScript } from "../testing/github-app-fake.js";
import {
  fixtureOidcToken,
  SOURCE_SANDBOX,
  type SourceCheckout,
  sourceCheckout,
  sourceSandbox,
} from "../testing/source-sandbox.js";
import { REPLAY_BOUNDS } from "./coder-host/replay.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/**
 * The coding-agent routes, answered by the group the way a function answers
 * them, over a real dialect: a Start is one agent whose eve session opens
 * with the plan as its first message, a retry under the same key is that
 * agent and opens nothing again, the list reads each agent's status from its
 * newest turn, the transcript answers the conversation's rows past a cursor,
 * and a Stop is eve's cancel of the turn under way and the row's stamp. eve
 * is a fake at the client's boundary, GitHub a script, the catalog fixed,
 * and the store PGlite. Synthetic accounts, bearers, tasks, and words
 * throughout.
 */

it.layer(getTestDB())("starting an agent from another", (it) => {
  /** A source agent on the owner's plan, on a choice and servers of its own, with a transcript of two turns, a branch, and a pull request, its GitHub answering as given. */
  const sourceAgentOn = (github?: RepositoryScript, eve?: ReturnType<typeof fakeEve>) =>
    Effect.gen(function* () {
      const opened = yield* openTask({
        ...(github === undefined ? undefined : { github }),
        ...(eve === undefined ? undefined : { eve }),
      });
      const source = readAnswer(
        agentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(
          startAs(opened.owner, opened.task.id, {
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            disabledServers: [INTEGRATION_PROVIDER.LINEAR],
          }),
        ),
      ).agent;
      const stored = Option.getOrThrow(yield* readAgent(opened.owner, source.id));
      yield* transcriptRow(stored, 2, MESSAGE_ROLE.USER, [text("Use the mailer.")]);
      const firstTurn = yield* transcriptRow(stored, 3, MESSAGE_ROLE.ASSISTANT, [
        { type: "reasoning", text: "A thought of its own.", state: "done" },
        text("On it."),
        {
          type: "tool-bash",
          toolCallId: "call-1",
          state: "output-available",
          input: { command: "pnpm test" },
          output: "ok",
        },
      ]);
      const laterLine = yield* transcriptRow(stored, 4, MESSAGE_ROLE.USER, [
        text("Also add tests."),
      ]);
      yield* transcriptRow(stored, 5, MESSAGE_ROLE.ASSISTANT, [text("Done.")]);
      yield* updateAgentBranch(opened.owner, source.id, PUBLISHED.branch);
      yield* recordAgentPublished(opened.owner, source.id, {
        number: PUBLISHED.number,
        title: "Expire teammate invitations",
        url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.NONE,
        additions: 4,
        deletions: 1,
        changedFiles: 1,
      });
      return { ...opened, source, stored, firstTurn, laterLine };
    });
  const sourceAgent = sourceAgentOn();

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.effect(
    "a continue is handed the plan as it stands now and every step after the source's brief, its reasoning left out, on the source's choice and servers, and names where it came from",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source } = yield* sourceAgent;
        yield* savePlanText(owner, task.id, "## Goal\n\nInvite by link.\n");

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
        ).agent;
        const { text: handed, parts } = openedParts(eve);

        assert.deepEqual(started.from, { agentId: source.id, steps: 5, totalSteps: 5 });
        assert.deepEqual(
          [started.model, started.effort, started.disabledServers],
          [SOL, "low", [INTEGRATION_PROVIDER.LINEAR]],
        );
        assert.equal(parts.brief, "# Teammate invitations\n\n## Goal\n\nInvite by link.\n");
        assert.deepEqual(
          parts.replay?.steps.map((step) => [step.kind, step.summary]),
          [
            [REPLAY_STEP_KIND.LINE, "The developer: Use the mailer."],
            [REPLAY_STEP_KIND.SAID, "Said: On it."],
            [REPLAY_STEP_KIND.TOOL, "Ran: pnpm test"],
            [REPLAY_STEP_KIND.LINE, "The developer: Also add tests."],
            [REPLAY_STEP_KIND.SAID, "Said: Done."],
          ],
        );
        assert.match(parts.replay?.steps[2]?.words ?? "", /Result: ok/u);
        // A call names the tool it called, and a line when it was sent, which the replay card draws them by.
        assert.deepEqual(
          [
            parts.replay?.steps[2]?.tool,
            parts.replay?.steps[2]?.inputForm,
            parts.replay?.steps[2]?.outputForm,
          ],
          ["bash", REPLAY_VALUE_FORM.JSON, REPLAY_VALUE_FORM.TEXT],
        );
        assert.ok(
          parts.replay?.steps
            .filter((step) => step.kind === REPLAY_STEP_KIND.LINE)
            .every((step) => Number.isSafeInteger(step.at)),
        );
        assert.match(parts.replay?.preamble ?? "", /You continue the work/u);
        assert.ok(parts.replay?.preamble.includes(PUBLISHED.branch));
        assert.match(
          parts.replay?.preamble ?? "",
          /what it had not pushed could not be copied from its sandbox/u,
          "a source that never opened a sandbox is taken up from the branch it pushed",
        );
        assert.ok(parts.replay?.preamble.includes(`/pull/${PUBLISHED.number}`));
        assert.doesNotMatch(handed, /A thought of its own/u);
        const stored = Option.getOrThrow(yield* readAgent(owner, started.id));
        assert.equal(
          stored.planSnapshot,
          handed,
          "the agent keeps the first message it was handed",
        );
        const listed = readAnswer(
          agentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        const fromOf = new Map(listed.agents.map((agent) => [agent.id, agent.from]));
        assert.deepEqual(
          [fromOf.has(source.id), fromOf.get(source.id), fromOf.get(started.id)],
          [true, undefined, { agentId: source.id, steps: 5, totalSteps: 5 }],
        );
      }),
  );

  /** A source whose session eve opened is claimed, with a turn under way eve knows as `turn_0`; answers the session. */
  const sourceRunning = (stored: Agent, eve: ReturnType<typeof fakeEve>) =>
    Effect.gen(function* () {
      const target = { userId: stored.userId, conversationId: stored.conversationId };
      const sessionId = eve.opened[0]?.sessionId ?? "";
      assert.equal(yield* claimRuntimeSession(target, sessionId, new Date()), true);
      const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
      const turnId = randomUUID();
      yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
      yield* writer.consume(target, {
        kind: RUN_EVENT.TURN_STARTED,
        conversationId: sessionKey(target.conversationId),
        turnId,
        sequence: 1,
        origin: RUN_TURN_ORIGIN.TYPED,
        trigger: TURN_TRIGGER.ASK,
        at: 0,
      });
      // The source's lines are the turn's, so none of them reads as awaiting a turn of its own.
      yield* Database.use((db) =>
        db
          .update(messages)
          .set({ turnId })
          .where(eq(messages.conversationId, stored.conversationId)),
      );
      return sessionId;
    });

  it.effect(
    "a continue stops its source's turn still running, once however many continue it, and a fork leaves its source running",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, source, stored, firstTurn } = yield* sourceAgentOn(
          undefined,
          eve,
        );
        const sessionId = yield* sourceRunning(stored, eve);
        const startFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        const sourceStatus = Effect.map(
          ask(request(AGENT, owner, { id: source.id })),
          (answered) =>
            readAnswer(agentPageAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agent.status,
        );

        yield* startFrom({ agentId: source.id, messageId: firstTurn });
        assert.deepEqual(eve.cancelled, [], "a fork stops nothing");
        assert.equal(yield* sourceStatus, AGENT_STATUS.RUNNING);

        yield* startFrom({ agentId: source.id });
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        assert.equal(yield* sourceStatus, AGENT_STATUS.CANCELLED);

        yield* startFrom({ agentId: source.id });
        assert.deepEqual(
          eve.cancelled,
          [[sessionId, "turn_0"]],
          "a source stopped is not stopped again",
        );
      }),
  );

  it.effect(
    "a continue of a pilot is a pilot that the agents its source started now report to, its source archived, and a fork of it takes over nothing",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, source, stored, firstTurn } = yield* sourceAgent;
        // Note that no Start makes a pilot yet, so the source is made one in place.
        yield* Database.use((db) =>
          db.update(agentTable).set({ kind: AGENT_KIND.PILOT }).where(eq(agentTable.id, source.id)),
        );
        const coder = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: task.id,
            planSnapshot: "# Invite by link",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: stored.repository,
            startedByAgentId: source.id,
          }),
        ).agent;
        const startFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        const stands = (agentId: string) =>
          Effect.map(readAgent(owner, agentId), (read) => Option.getOrThrow(read));

        yield* startFrom({ agentId: source.id, messageId: firstTurn });
        assert.equal(
          (yield* stands(coder.id)).startedByAgentId,
          source.id,
          "a fork takes over nothing",
        );

        const continued = yield* startFrom({ agentId: source.id });
        assert.deepEqual(
          [
            (yield* stands(continued.id)).kind,
            (yield* stands(coder.id)).startedByAgentId,
            (yield* stands(source.id)).archivedAt !== null,
          ],
          [AGENT_KIND.PILOT, continued.id, true],
        );
      }),
  );

  it.effect(
    "a source eve refuses to stop still has its continue started, and runs on, a pilot unarchived",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve({ cancels: false });
        const { owner, task, ask, source, stored } = yield* sourceAgentOn(undefined, eve);
        const sessionId = yield* sourceRunning(stored, eve);
        yield* Database.use((db) =>
          db.update(agentTable).set({ kind: AGENT_KIND.PILOT }).where(eq(agentTable.id, source.id)),
        );

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
        ).agent;

        assert.deepEqual(started.from?.agentId, source.id);
        assert.deepEqual(eve.cancelled, [[sessionId, "turn_0"]]);
        const page = readAnswer(
          agentPageAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT, owner, { id: source.id })),
        ).agent;
        assert.equal(page.status, AGENT_STATUS.RUNNING);
        assert.equal(Option.getOrThrow(yield* readAgent(owner, source.id)).archivedAt, null);
      }),
  );

  it.effect(
    "a continue is named after its source, the suffix never stacked and the whole cut to fit, a source with no title names none, and a fork is named as it starts",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, source, firstTurn } = yield* sourceAgent;
        const titleFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );

        assert.equal((yield* titleFrom({ agentId: source.id })).title, null);
        yield* renameAgent(owner, source.id, "Invite by link");
        const continued = yield* titleFrom({ agentId: source.id });
        assert.equal(continued.title, "Invite by link (continued)");
        assert.equal(
          (yield* titleFrom({ agentId: continued.id })).title,
          "Invite by link (continued)",
        );
        assert.equal((yield* titleFrom({ agentId: source.id, messageId: firstTurn })).title, null);
        const long = "Expire teammate invitations ".repeat(4);
        yield* renameAgent(owner, source.id, long);
        const cut = (yield* titleFrom({ agentId: source.id })).title ?? "";
        assert.equal(cut.length <= AGENT_BOUNDS.MAX_TITLE_CHARS, true);
        assert.match(cut, /^Expire teammate invitations Expire .*[^ ] \(continued\)$/u);
      }),
  );

  it.effect(
    "a source names the agents that continued and forked it, in its task's list, on its own page, and once archived",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, source, stored, firstTurn } = yield* sourceAgentOn(
          undefined,
          eve,
        );
        yield* sourceRunning(stored, eve);
        const startFrom = (from: { agentId: string; messageId?: string }) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        const continued = yield* startFrom({ agentId: source.id });
        const forked = yield* startFrom({ agentId: source.id, messageId: firstTurn });
        // Note that the two start within one instant here, so they are compared in the order of their ids.
        const byId = <Named extends { readonly agentId: string }>(
          named: readonly Named[] | undefined,
        ) => [...(named ?? [])].sort((a, b) => a.agentId.localeCompare(b.agentId));
        const expected = byId([
          { agentId: continued.id, title: null, forked: false },
          { agentId: forked.id, title: null, forked: true, messageId: firstTurn },
        ]);

        const listed = readAnswer(
          agentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        const continuedByOf = new Map(listed.agents.map((agent) => [agent.id, agent.continuedBy]));
        assert.deepEqual(byId(continuedByOf.get(source.id)), expected);
        assert.equal(continuedByOf.get(continued.id), undefined);
        const page = readAnswer(
          agentPageAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT, owner, { id: source.id })),
        ).agent;
        assert.deepEqual(byId(page.continuedBy), expected);
        const archived = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT, owner, { method: "PATCH", id: source.id, body: { archived: true } }),
          ),
        ).agent;
        assert.deepEqual(byId(archived.continuedBy), expected);
      }),
  );

  /** A source whose stopped sandbox holds a change it never committed, over a checkout and remote on disk, and a continue of it; GitHub answers its pull request's reads as `pull` does, where given. */
  const copyScenario = (t: TestContext, pull?: RepositoryScript) =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureOidcToken());
      const checkout = sourceCheckout(yield* Effect.promise(() => temporaryDirectory(t, "copy-")));
      writeFileSync(join(checkout.checkout, "invites.ts"), "export const ttl = 7;\n");
      const sandbox = sourceSandbox(checkout, "stopped");
      const opened = yield* sourceAgentOn(
        pull === undefined ? sandbox.answer : (sent) => sandbox.answer(sent) ?? pull(sent),
      );
      yield* claimRuntimeSession(opened.stored, "wrun_source", new Date());
      const continued = Effect.gen(function* () {
        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: opened.source.id },
            }),
          ),
        ).agent;
        return { started, preamble: openedParts(opened.eve).parts.replay?.preamble ?? "" };
      });
      return { ...opened, checkout, sandbox, continued };
    });

  /** The fetch the preamble hands on, run in a checkout of the remote cloned as an agent's is, with the default branch alone; answers that checkout. */
  const fetchedAsHanded = (checkout: SourceCheckout, preamble: string) => {
    const fetch = /`(git remote set-branches [^`]+)`/u.exec(preamble)?.[1] ?? "";
    const fresh = join(checkout.root, "fresh");
    checkout.sh(
      checkout.root,
      "git",
      "clone",
      "--quiet",
      "--single-branch",
      "--branch",
      "main",
      checkout.remote,
      fresh,
    );
    checkout.sh(fresh, "sh", "-c", fetch);
    return fresh;
  };

  it.effect(
    "a continue copies the source's checkout, what it had not committed included, to a branch of its own from the sandbox it wakes and stops again, names that branch and how a fresh checkout fetches it, and keeps it on its record",
    (t) =>
      Effect.gen(function* () {
        const { checkout, sandbox, continued } = yield* copyScenario(t);

        const { started, preamble } = yield* continued;

        const branch = started.from?.branch ?? "";
        assert.match(branch, /^luke\/teammate-invitations-continued-[0-9a-f]{8}$/u);
        assert.ok(
          preamble.includes(
            `with what it had not committed or pushed recorded as one snapshot commit on top, is copied to the branch \`${branch}\`, made for you`,
          ),
        );
        assert.ok(preamble.includes(`Its own branch was \`${PUBLISHED.branch}\``));
        // The words the preamble hands on, run in a checkout cloned as an agent's is, find the copy.
        const fresh = fetchedAsHanded(checkout, preamble);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), branch);
        assert.equal(readFileSync(join(fresh, "invites.ts"), "utf8"), "export const ttl = 7;\n");
        // The stop runs behind the Start, which answered without waiting on it.
        yield* Deferred.await(sandbox.stopAsked);
        assert.deepEqual(
          [sandbox.ran, sandbox.stops],
          [[SOURCE_SANDBOX.WOKEN], [SOURCE_SANDBOX.WOKEN]],
        );
      }),
  );

  it.effect(
    "a continue of a source on no task, keyed by that source, copies its checkout to a branch of its own as a task's continue does, checked against the repository the source's own place clones",
    (t) =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, checkout } = yield* copyScenario(t);
        // An automation's run leaves an agent so: in its workspace, on no task, handed a prompt.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({
              taskId: null,
              organizationId: task.workspaceId,
              planSnapshot: null,
              prompt: SNAPSHOT,
            })
            .where(eq(agentTable.id, source.id)),
        );

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            request(AGENT_STARTS, owner, {
              method: "POST",
              id: source.id,
              body: { idempotencyKey: randomUUID(), from: { agentId: source.id } },
            }),
          ),
        ).agent;
        const preamble = openedParts(eve).parts.replay?.preamble ?? "";

        assert.equal(started.planId, null);
        const branch = started.from?.branch ?? "";
        assert.match(branch, /^luke\/teammate-invitations-continued-[0-9a-f]{8}$/u);
        assert.ok(
          preamble.includes(
            `with what it had not committed or pushed recorded as one snapshot commit on top, is copied to the branch \`${branch}\`, made for you`,
          ),
        );
        const fresh = fetchedAsHanded(checkout, preamble);
        assert.equal(readFileSync(join(fresh, "invites.ts"), "utf8"), "export const ttl = 7;\n");
      }),
  );

  it.effect(
    "a continue of a source whose pull request is still open is told to carry the copy onto that pull request's branch and open no second one, and the words it is handed bring the branch to the copy",
    (t) =>
      Effect.gen(function* () {
        const { checkout, continued } = yield* copyScenario(t, publishedPullRequest);
        // The source worked on its pull request's branch, pushed, with its change still uncommitted.
        checkout.sh(checkout.checkout, "git", "switch", "--quiet", "-c", PUBLISHED.branch);
        checkout.sh(checkout.checkout, "git", "push", "--quiet", "origin", PUBLISHED.branch);

        const { started, preamble } = yield* continued;

        const copied = started.from?.branch ?? "";
        assert.ok(preamble.includes("open no new pull request"), preamble);
        assert.ok(!preamble.includes("open your pull request from it"), preamble);
        const fresh = fetchedAsHanded(checkout, preamble);
        const [, carry = ""] = [...preamble.matchAll(/`(git remote set-branches [^`]+)`/gu)].map(
          (match) => match[1],
        );
        const merge = /`(git merge --ff-only [^`]+)`/u.exec(preamble)?.[1] ?? "";
        checkout.sh(fresh, "sh", "-c", `${carry} && ${merge}`);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), PUBLISHED.branch);
        assert.equal(
          checkout.sh(fresh, "git", "rev-parse", "HEAD"),
          checkout.sh(fresh, "git", "rev-parse", copied),
        );
        assert.equal(readFileSync(join(fresh, "invites.ts"), "utf8"), "export const ttl = 7;\n");
      }),
  );

  it.effect(
    "a continue of a source whose pull request its row still reads open, but GitHub says merged since, opens its own from the copy",
    (t) =>
      Effect.gen(function* () {
        const merged: RepositoryScript = async (sent) => {
          const answered = await publishedPullRequest(sent);
          const pathname = new URL(sent.url).pathname;
          if (answered === undefined || !pathname.endsWith(`/pulls/${PUBLISHED.number}`)) {
            return answered;
          }
          const pull = await answered.json();
          return Response.json({
            ...pull,
            state: "closed",
            merged: true,
            merged_at: "2026-10-16T09:00:00Z",
          });
        };
        const { continued } = yield* copyScenario(t, merged);

        const { preamble } = yield* continued;

        assert.ok(preamble.includes("open your pull request from it as usual"), preamble);
        assert.ok(!preamble.includes("open no new pull request"), preamble);
      }),
  );

  it.effect(
    "a sandbox held past the copy's own hold, by a developer's terminal or another Start's copy, is woken for the copy and left up",
    (t) =>
      Effect.gen(function* () {
        const { stored, sandbox, continued } = yield* copyScenario(t);
        yield* holdSandbox(stored.conversationId, new Date(Date.now() + 10 * 60_000));

        const { started } = yield* continued;

        assert.ok(started.from?.branch !== undefined);
        assert.deepEqual([sandbox.ran, sandbox.stops], [[SOURCE_SANDBOX.WOKEN], []]);
      }),
  );

  it.effect(
    "a source whose task moved to another repository since it started is copied nowhere, its sandbox left asleep, and taken up from the branch it pushed, fetched as one word whatever a shell would read in its name",
    (t) =>
      Effect.gen(function* () {
        const { owner, source, checkout, sandbox, continued } = yield* copyScenario(t);
        // A name git allows whose words a shell would run, joined so it reads as no template placeholder.
        const pushedBranch = ["luke/invites$(touch$", "{IFS}pwned)"].join("");
        checkout.sh(
          checkout.checkout,
          "git",
          "push",
          "--quiet",
          "origin",
          `HEAD:refs/heads/${pushedBranch}`,
        );
        yield* updateAgentBranch(owner, source.id, pushedBranch);
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ repository: "Acme/Former" })
            .where(eq(agentTable.id, source.id)),
        );

        const { started, preamble } = yield* continued;

        assert.equal(started.from?.branch, undefined);
        assert.match(preamble, /what it had not pushed could not be copied from its sandbox/u);
        assert.deepEqual([sandbox.ran, sandbox.stops, sandbox.state.status], [[], [], "stopped"]);
        const fresh = fetchedAsHanded(checkout, preamble);
        assert.equal(checkout.sh(fresh, "git", "branch", "--show-current"), pushedBranch);
        assert.equal(existsSync(join(fresh, "pwned")), false);
      }),
  );

  it.effect(
    "a fork is cut at the source's message, its turn included, warned of the files the source edited after it, and a message that is none of the source's journals is refused",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored, firstTurn, laterLine } = yield* sourceAgent;
        const patch = (files: readonly string[]) => ({
          patchText: `*** Begin Patch\n${files.map((file) => `*** Update File: ${file}\n@@\n-a\n+b`).join("\n")}\n*** End Patch`,
        });
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          {
            type: "tool-apply_patch",
            toolCallId: "call-2",
            state: "output-available",
            input: patch(["src/invites.ts", "src/expiry.ts"]),
            output: "ok",
          },
          {
            type: "tool-write_file",
            toolCallId: "call-3",
            state: "output-available",
            input: { filePath: "src/mailer.ts", content: "x" },
            output: "ok",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-4",
            state: "output-error",
            input: patch(["src/refused.ts"]),
            errorText: "the patch did not apply",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-5",
            state: "output-available",
            input: patch(["src/invites.ts"]),
            output: "ok",
          },
          {
            type: "tool-apply_patch",
            toolCallId: "call-6",
            state: "output-available",
            input: {
              patchText:
                "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n*** End Patch",
            },
            output: "ok",
          },
          // A native harness's edits count as the agent's own file tools' do.
          {
            type: "tool-Edit",
            toolCallId: "call-7",
            state: "output-available",
            input: { file_path: "src/claude.ts", old_string: "a", new_string: "b" },
            output: "The file has been updated successfully.",
          },
          {
            type: "tool-fileChange",
            toolCallId: "call-8",
            state: "output-available",
            input: { changes: [{ path: "src/codex.ts", kind: { type: "update" }, diff: "" }] },
            output: { status: "completed" },
          },
        ]);
        const fork = (messageId: string) =>
          ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageId },
            }),
          );

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* fork(firstTurn),
        ).agent;
        const { parts } = openedParts(eve);

        assert.deepEqual(started.from, {
          agentId: source.id,
          messageId: firstTurn,
          steps: 3,
          totalSteps: 3,
        });
        assert.deepEqual(
          parts.replay?.steps.map((step) => step.summary),
          ["The developer: Use the mailer.", "Said: On it.", "Ran: pnpm test"],
        );
        assert.match(parts.replay?.preamble ?? "", /You are a fork/u);
        assert.match(
          parts.replay?.preamble ?? "",
          /may be ahead of the message you were forked at\. After that message it edited `src\/invites\.ts`, `src\/expiry\.ts`, `src\/mailer\.ts`, `src\/old\.ts`, `src\/new\.ts`, `src\/claude\.ts`, `src\/codex\.ts`; undo/u,
        );
        for (const named of [laterLine, randomUUID()]) {
          assert.deepEqual(
            yield* fork(named),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
      }),
  );

  it.effect(
    "a continue of a source whose turn failed part way replays the words that turn formed before it failed",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const target = { userId: owner, conversationId: stored.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        const turn = { conversationId: sessionKey(target.conversationId), turnId };
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_1",
        });
        const bodies = [
          {
            kind: RUN_EVENT.TURN_STARTED,
            origin: RUN_TURN_ORIGIN.TYPED,
            trigger: TURN_TRIGGER.ASK,
            at: 0,
          },
          { kind: RUN_EVENT.STEP_STARTED, step: 1 },
          { kind: RUN_EVENT.TEXT_DRAFTED, step: 1, text: "Halfway through the mailer." },
          {
            kind: RUN_EVENT.TURN_ENDED,
            status: RUN_STATUS.FAILED,
            responseIds: [],
            at: 1,
          },
        ] as const;
        for (const [index, body] of bodies.entries()) {
          yield* writer.consume(target, { ...turn, ...body, sequence: index + 1 });
        }

        readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id },
            }),
          ),
        );

        assert.equal(
          openedParts(eve).parts.replay?.steps.at(-1)?.summary,
          "Said: Halfway through the mailer.",
        );
      }),
  );

  it.effect(
    "a fork of a reply still being written keeps the steps, and the words and calls of the last of them, seen as Fork was pressed, nothing written after, and names the files the rest of that reply edited; a fork naming no steps keeps the reply whole",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const write = (callId: string, filePath: string) => ({
          type: "tool-write_file",
          toolCallId: callId,
          state: "output-available",
          input: { filePath, content: "x" },
          output: "ok",
        });
        const writing = yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          { type: "step-start" },
          text("Writing the expiry first."),
          write("call-7", "src/expiry.ts"),
          { type: "step-start" },
          text("Now the mailer."),
          write("call-8", "src/mailer.ts"),
        ]);
        const fork = (messageSteps: number | undefined, messageStepParts?: number) =>
          Effect.gen(function* () {
            const started = readAnswer(
              agentAnswerSchema,
              HOSTED_HTTP_STATUS.CREATED,
              yield* ask(
                startAs(owner, task.id, {
                  idempotencyKey: randomUUID(),
                  from: {
                    agentId: source.id,
                    messageId: writing,
                    ...(messageSteps === undefined ? undefined : { messageSteps }),
                    ...(messageStepParts === undefined ? undefined : { messageStepParts }),
                  },
                }),
              ),
            ).agent;
            return { started, replay: openedParts(eve).parts.replay };
          });

        const pinned = yield* fork(1);
        assert.equal(pinned.started.from?.messageSteps, 1);
        assert.deepEqual(
          pinned.replay?.steps.slice(-2).map((step) => step.summary),
          ["Said: Writing the expiry first.", "Wrote: src/expiry.ts"],
        );
        assert.match(
          pinned.replay?.preamble ?? "",
          /After that message it edited `src\/mailer\.ts`; undo/u,
        );

        // A press that saw the step's words and not yet its call keeps the words alone.
        const within = yield* fork(1, 1);
        assert.equal(within.started.from?.messageStepParts, 1);
        assert.equal(within.replay?.steps.at(-1)?.summary, "Said: Writing the expiry first.");
        assert.match(
          within.replay?.preamble ?? "",
          /After that message it edited `src\/expiry\.ts`, `src\/mailer\.ts`; undo/u,
        );

        const whole = yield* fork(undefined);
        assert.equal(whole.started.from?.messageSteps, undefined);
        assert.deepEqual(
          whole.replay?.steps.slice(-2).map((step) => step.summary),
          ["Said: Now the mailer.", "Wrote: src/mailer.ts"],
        );
        assert.match(whole.replay?.preamble ?? "", /edited no file after that message/u);

        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageSteps: 1 },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id, messageId: writing, messageStepParts: 1 },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a source on another plan, or one the account does not reach, is refused as naming nothing, and a prompt beside a source as invalid",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, eve, source } = yield* sourceAgent;
        const elsewhere = yield* startTask(owner, { name: "Billing", repository: RELAY_FULL_NAME });
        const away = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: elsewhere.id,
            planSnapshot: "# Billing",
            prompt: null,
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
          }),
        ).agent;
        const opened = eve.opened.length;

        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: away.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            startAs(other, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              task: "Do it again.",
              from: { agentId: source.id },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(eve.opened.length, opened);
      }),
  );

  it.effect(
    "a Start keyed by an agent on no task continues it in its workspace on its repository and forks it at one of its messages there, a retry answering the agent it made, even once the source is gone; a body naming another source, an account outside the workspace, a task's Start naming it, and a source in no repository start nothing; and one keyed by an agent on a task starts on that task",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, eve } = yield* openTask();
        const BRIEF = "Sweep the flaky tests.";
        const made = yield* createAgent(owner, {
          taskId: null,
          organizationId: task.workspaceId,
          planSnapshot: null,
          prompt: BRIEF,
          idempotencyKey: randomUUID(),
          model: SOL,
          effort: "low",
          repository: RELAY_FULL_NAME,
        });
        const source = Option.getOrThrow(made).agent;
        yield* transcriptRow(source, 1, MESSAGE_ROLE.USER, [text(BRIEF)]);
        const firstTurn = yield* transcriptRow(source, 2, MESSAGE_ROLE.ASSISTANT, [
          text("Fixed the shared temp dir."),
        ]);
        yield* transcriptRow(source, 3, MESSAGE_ROLE.USER, [text("Now the clock.")]);
        yield* transcriptRow(source, 4, MESSAGE_ROLE.ASSISTANT, [text("Fixed the clock read.")]);
        const startFromAs = (bearer: string, agentId: string, body: WireBoundaryInput) =>
          ask(request(AGENT_STARTS, bearer, { method: "POST", id: agentId, body }));
        const replayed = () =>
          (openedParts(eve).parts.replay?.steps ?? []).map((step) => step.summary);

        const key = randomUUID();
        const continueBody = { idempotencyKey: key, from: { agentId: source.id } };
        const continued = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* startFromAs(owner, source.id, continueBody),
        ).agent;
        const stored = Option.getOrThrow(yield* readAgent(owner, continued.id));
        assert.deepEqual(
          [stored.taskId, stored.organizationId, stored.repository, stored.planSnapshot],
          [null, task.workspaceId, RELAY_FULL_NAME, null],
        );
        assert.equal(openedParts(eve).parts.brief, BRIEF);
        assert.deepEqual(replayed(), [
          "Said: Fixed the shared temp dir.",
          "The developer: Now the clock.",
          "Said: Fixed the clock read.",
        ]);
        assert.equal(stored.prompt, openedParts(eve).text, "it keeps the message it was handed");
        assert.deepEqual(continued.from, { agentId: source.id, steps: 3, totalSteps: 3 });
        const opened = eve.opened.length;
        const again = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* startFromAs(owner, source.id, continueBody),
        ).agent;
        assert.equal(again.id, continued.id);
        assert.equal(eve.opened.length, opened, "a retry opens no session");
        assert.deepEqual(
          yield* startFromAs(owner, source.id, {
            idempotencyKey: key,
            from: { agentId: source.id, messageId: firstTurn },
          }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "a key reused for another Start is refused, never answered with the first's agent",
        );
        assert.deepEqual(
          yield* startFromAs(owner, source.id, { ...continueBody, model: SOL }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          "a retry naming a model without its effort is refused as the first would be",
        );

        const forked = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* startFromAs(owner, source.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: source.id, messageId: firstTurn },
          }),
        ).agent;
        assert.equal(forked.planId, null);
        assert.deepEqual(replayed(), ["Said: Fixed the shared temp dir."]);

        const before = eve.opened.length;
        assert.deepEqual(
          yield* startFromAs(owner, continued.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: source.id },
          }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* startFromAs(other, source.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: source.id },
          }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
          "a task's Start refuses a source on no task rather than starting afresh",
        );
        const bare = yield* createAgent(owner, {
          taskId: null,
          organizationId: task.workspaceId,
          planSnapshot: null,
          prompt: "Talk the release through.",
          idempotencyKey: randomUUID(),
          model: SOL,
          effort: "low",
          repository: null,
        });
        const bareId = Option.getOrThrow(bare).agent.id;
        assert.deepEqual(
          yield* startFromAs(owner, bareId, {
            idempotencyKey: randomUUID(),
            from: { agentId: bareId },
          }),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
          "a source on no task and in no repository has no checkout to go on from",
        );
        assert.equal(eve.opened.length, before);

        // The same path from an agent on a task starts on that task, as the task's own Start would.
        const onTask = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const fromTask = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* startFromAs(owner, onTask.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: onTask.id },
          }),
        ).agent;
        assert.equal(fromTask.planId, task.id);
        assert.equal(Option.getOrThrow(yield* readAgent(owner, fromTask.id)).taskId, task.id);

        // A retry is answered with the agent its key made though the source is gone since.
        yield* Database.use((db) => db.delete(agentTable).where(eq(agentTable.id, source.id)));
        const retried = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* startFromAs(owner, source.id, continueBody),
        ).agent;
        assert.equal(retried.id, continued.id);
      }),
  );

  /** A server mention as the desktop writes one. */
  const serverMention = (provider: IntegrationProvider, name: string) =>
    mentionMarkdown({ kind: MENTION_KIND.SERVER, provider }, name, {
      workspace: "acme",
      repository: null,
    });

  /** The words and files the session opened on, its first part's words read back as a first message. */
  const openedWithFiles = (eve: ReturnType<typeof fakeEve>) => {
    const message = eve.opened.at(-1)?.message.message;
    assert.ok(Array.isArray(message), "the session opened on parts");
    const [first] = message;
    assert.ok(first?.type === "text", "the first part is the words");
    return {
      parts: firstMessageParts(first.text),
      files: message.flatMap((part) => (part.type === "file" ? [part.filename] : [])),
    };
  };

  it.effect(
    "a note beside a source is written after the replay as the developer's with its files, and the first turn's servers are read from the note, never the replay",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.USER, [
          text(`Look in ${serverMention(INTEGRATION_PROVIDER.NOTION, "Notion")} too.`),
        ]);
        const note = `Now check ${serverMention(INTEGRATION_PROVIDER.LINEAR, "Linear")} first.`;
        const png = {
          name: "flow.png",
          mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          data: Buffer.from(PNG).toString("base64"),
        };

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: source.id },
              note: `  ${note}\n`,
              attachments: [png],
            }),
          ),
        ).agent;
        const { parts, files } = openedWithFiles(eve);

        assert.deepEqual(parts.note, {
          heading: START_NOTE_HEADING.DEVELOPER,
          text: note,
          files: { text: 0, other: 1 },
        });
        assert.equal(parts.replay?.steps.length, 6);
        assert.deepEqual(files, ["flow.png"]);
        const kept = Option.getOrThrow(yield* readAgent(owner, started.id));
        assert.deepEqual(yield* takeAgentMentionedServers(owner, kept.conversationId), [
          INTEGRATION_PROVIDER.LINEAR,
        ]);
      }),
  );

  it.effect(
    "the source's files are attached again only as far as they fit beside the note's within one message's bounds, and the rest are named as not passed on",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const data = Buffer.from(PNG).toString("base64");
        const source = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: task.id,
            planSnapshot: null,
            prompt: "Match these screens.",
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
          }),
        ).agent;
        const shots = Array.from(
          { length: AGENT_BOUNDS.MAX_ATTACHMENTS },
          (_, at) => `screen-${at}.png`,
        );
        yield* transcriptRow(source, 1, MESSAGE_ROLE.USER, [
          text("Match these screens."),
          ...shots.map((filename) => ({
            type: "file",
            mediaType: AGENT_ATTACHMENT_TYPE.PNG,
            filename,
            url: `data:${AGENT_ATTACHMENT_TYPE.PNG};base64,${data}`,
          })),
        ]);

        yield* ask(
          startAs(owner, task.id, {
            idempotencyKey: randomUUID(),
            from: { agentId: source.id },
            note: "And this one.",
            attachments: [{ name: "new.png", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data }],
          }),
        );
        const { parts, files } = openedWithFiles(eve);

        assert.deepEqual(files, [...shots.slice(0, -1), "new.png"]);
        assert.match(parts.replay?.preamble ?? "", /could not be passed on: screen-9\.png\./u);
      }),
  );

  it.effect(
    "a source's first row, the line its Start wrote, keeps no bytes of the image its prompt carried, naming the picture kept beside its conversation by id, and a continue attaches the image again from that picture",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const data = Buffer.from(SIZED_PNG).toString("base64");
        const source = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              task: "Match this screen.",
              attachments: [{ name: "flow.png", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data }],
            }),
          ),
        ).agent;
        const stored = Option.getOrThrow(yield* readAgent(owner, source.id));
        const [first] = yield* Database.use((db) =>
          db
            .select({ parts: messages.parts })
            .from(messages)
            .where(eq(messages.conversationId, stored.conversationId)),
        );
        assert.deepEqual(
          (first?.parts ?? []).flatMap((part) =>
            part.type === "file"
              ? [[part.filename, part.url, keptPictureIdOf(part.providerMetadata) !== undefined]]
              : [],
          ),
          [["flow.png", "", true]],
        );

        yield* ask(
          startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
        );
        const opened = eve.opened.at(-1)?.message.message;
        assert.ok(Array.isArray(opened));

        assert.deepEqual(
          opened.flatMap((part) => (part.type === "file" ? [[part.filename, part.data]] : [])),
          [["flow.png", `data:${AGENT_ATTACHMENT_TYPE.PNG};base64,${data}`]],
        );
        assert.doesNotMatch(
          openedWithFiles(eve).parts.replay?.preamble ?? "",
          /could not be passed on/u,
        );
      }),
  );

  it.effect(
    "an automation run's source hands on the servers its own prompt names and the note's, never those of the webhook body it carried",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const prompt = `Triage ${serverMention(INTEGRATION_PROVIDER.LINEAR, "Linear")} daily.`;
        const run = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: task.id,
            planSnapshot: null,
            prompt: `${prompt}\n\nThe webhook said: see ${serverMention(INTEGRATION_PROVIDER.NOTION, "Notion")}.`,
            idempotencyKey: randomUUID(),
            model: SOL,
            effort: "low",
            repository: RELAY_FULL_NAME,
            automationOrigin: {
              name: "Daily triage",
              firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: 40 },
              prompt,
            },
          }),
        ).agent;

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId: run.id },
              note: `Post it in ${serverMention(INTEGRATION_PROVIDER.SLACK, "Slack")}.`,
            }),
          ),
        ).agent;

        const kept = Option.getOrThrow(yield* readAgent(owner, started.id));
        assert.deepEqual(
          (yield* takeAgentMentionedServers(owner, kept.conversationId)).toSorted(),
          [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.SLACK],
        );
      }),
  );

  it.effect(
    "a note without a source, files beside a source with no note, and a prompt beside a source and a note are refused as invalid",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source } = yield* sourceAgent;
        const png = {
          name: "flow.png",
          mediaType: AGENT_ATTACHMENT_TYPE.PNG,
          data: Buffer.from(PNG).toString("base64"),
        };
        const opened = eve.opened.length;
        for (const body of [
          { note: "Carry on." },
          { from: { agentId: source.id }, attachments: [png] },
          { from: { agentId: source.id }, note: "Carry on.", task: "Do it again." },
          { from: { agentId: source.id }, note: " " },
        ]) {
          assert.deepEqual(
            yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), ...body })),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
            JSON.stringify(Object.keys(body)),
          );
        }
        assert.equal(eve.opened.length, opened);
      }),
  );

  it.effect(
    "a retry from another agent answers the agent its key made though the source has gone since, and a source whose transcript does not read is answered as unavailable rather than as an empty replay",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, source, stored } = yield* sourceAgent;
        const body = { idempotencyKey: randomUUID(), from: { agentId: source.id } };
        const first = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, body)),
        ).agent;

        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [{ type: "text" }]);
        const opened = eve.opened.length;
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(eve.opened.length, opened);

        yield* discardAgent(owner, source.id);
        const again = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(startAs(owner, task.id, body)),
        ).agent;
        assert.equal(again.id, first.id);
        assert.equal(eve.opened.length, opened);
      }),
  );

  it.effect(
    "a source whose prompt holds a note's heading in its prose hands on its brief whole, and a note it was handed behind its marker becomes its first step",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const prose = `Write the guide.\n\n${START_NOTE_HEADING.DEVELOPER}\n\nExplain this heading in the guide.`;
        const sourceOf = (handed: string) =>
          Effect.gen(function* () {
            const made = Option.getOrThrow(
              yield* createAgent(owner, {
                taskId: task.id,
                planSnapshot: null,
                prompt: handed,
                idempotencyKey: randomUUID(),
                model: SOL,
                effort: "low",
                repository: RELAY_FULL_NAME,
              }),
            ).agent;
            yield* transcriptRow(made, 1, MESSAGE_ROLE.USER, [text(handed)]);
            return made;
          });
        const continueFrom = (agentId: string) =>
          ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId } }));

        yield* continueFrom((yield* sourceOf(prose)).id);
        assert.equal(openedParts(eve).parts.brief, prose);
        assert.deepEqual(openedParts(eve).parts.replay?.steps, []);

        yield* continueFrom(
          (yield* sourceOf(firstMessageText(prose, undefined, "Keep it short."))).id,
        );
        const read = openedParts(eve).parts;
        assert.equal(read.brief, prose);
        assert.deepEqual(
          read.replay?.steps.map((step) => step.summary),
          ["The developer: Keep it short."],
        );
      }),
  );

  it.effect(
    "a transcript of more rows than are read keeps its newest rows, so a continue replays where it ended and a fork at a late message is found, and an unreadable row past a fork's cut refuses only a continue",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve } = yield* openTask();
        const source = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = Option.getOrThrow(yield* readAgent(owner, source.id));
        const turns = REPLAY_BOUNDS.MAX_ROWS + 50;
        const ids: string[] = [];
        // Note that the rows go in by the thousand, because one insert a row would take minutes.
        for (let from = 0; from < turns; from += 1_000) {
          const rows = Array.from({ length: Math.min(1_000, turns - from) }, (_, at) => ({
            userId: stored.userId,
            conversationId: stored.conversationId,
            seq: from + at + 2,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.ASSISTANT,
            // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
            parts: [text(`Step ${from + at}.`)] as never,
            metadata: { author: MESSAGE_AUTHOR.MODEL },
            placedAt: new Date(),
          }));
          const written = yield* Database.use((db) =>
            db.insert(messages).values(rows).returning({ id: messages.id }),
          );
          ids.push(...written.map((row) => row.id));
        }
        const startFrom = (from: WireBoundaryInput) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );

        yield* startFrom({ agentId: source.id });
        assert.equal(
          openedParts(eve).parts.replay?.steps.at(-1)?.summary,
          `Said: Step ${turns - 1}.`,
        );
        const late = turns - 10;
        yield* startFrom({ agentId: source.id, messageId: ids[late] ?? "" });
        assert.equal(openedParts(eve).parts.replay?.steps.at(-1)?.summary, `Said: Step ${late}.`);

        // A fork with more rows after it than are read names no files as if they were all it edited.
        yield* startFrom({ agentId: source.id, messageId: ids[10] ?? "" });
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Which files it edited after that message could not all be read/u,
        );

        // A fork with exactly as many rows after it as are read still names what they edited, here nothing.
        yield* startFrom({
          agentId: source.id,
          messageId: ids[turns - 1 - REPLAY_BOUNDS.MAX_ROWS] ?? "",
        });
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Its file tools edited no file after that message/u,
        );

        // A row past the cut that does not read refuses a continue, but not a fork that needs none of it.
        yield* transcriptRow(stored, turns + 2, MESSAGE_ROLE.ASSISTANT, [{ type: "text" }]);
        assert.deepEqual(
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        const fork = yield* startFrom({ agentId: source.id, messageId: ids[late] ?? "" });
        assert.equal(fork.from?.steps, openedParts(eve).parts.replay?.steps.length);
        assert.equal(openedParts(eve).parts.replay?.steps.at(-1)?.summary, `Said: Step ${late}.`);
        assert.match(
          openedParts(eve).parts.replay?.preamble ?? "",
          /Which files it edited after that message could not all be read/u,
        );
      }),
  );

  /** A source on the small-window model with a transcript of thirty long turns after its brief. */
  const longSource = (options: { readonly summaryModel?: SummaryModelOf } = {}) =>
    Effect.gen(function* () {
      const opened = yield* openTask(options);
      const first = readAnswer(
        agentAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* opened.ask(
          startAs(opened.owner, opened.task.id, {
            idempotencyKey: randomUUID(),
            model: SMALL_WINDOW.model,
            effort: "high",
          }),
        ),
      ).agent;
      const stored = Option.getOrThrow(yield* readAgent(opened.owner, first.id));
      for (let turn = 0; turn < LONG_TURNS; turn += 1) {
        yield* transcriptRow(stored, turn + 2, MESSAGE_ROLE.ASSISTANT, [
          text(`Step ${turn}. ${"x".repeat(5_000)}`),
        ]);
      }
      const continueFrom = (
        agentId: string,
        body: Readonly<Record<string, WireBoundaryInput>> = {},
      ) =>
        Effect.map(
          opened.ask(
            startAs(opened.owner, opened.task.id, {
              idempotencyKey: randomUUID(),
              from: { agentId },
              ...body,
            }),
          ),
          (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
        );
      return { ...opened, first, stored, continueFrom };
    });

  it.effect(
    "a source whose transcript fits the new agent's window replays whole, every tool call's input and result in full",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, eve, stored, source } = yield* sourceAgent;
        // A result that reads like a failure and a subject that reads like a running call are neither.
        const output = `Failed: nothing, this is what it printed\n${"line of output\n".repeat(400)}the end`;
        yield* transcriptRow(stored, 6, MESSAGE_ROLE.ASSISTANT, [
          {
            type: "tool-bash",
            toolCallId: "call-2",
            state: "output-available",
            input: { command: `pnpm test ${"--flag ".repeat(200)}(running)` },
            output,
          },
        ]);

        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId: source.id } }),
          ),
        ).agent;
        const steps = openedParts(eve).parts.replay?.steps ?? [];

        assert.deepEqual(started.from, { agentId: source.id, steps: 6, totalSteps: 6 });
        assert.ok(steps.at(-1)?.words.endsWith(`Result: ${output}`));
        assert.ok(steps.at(-1)?.words.includes("--flag ".repeat(200)));
        assert.deepEqual(
          [steps.at(-1)?.state, steps.at(-1)?.output, steps.at(-1)?.input],
          [
            REPLAY_TOOL_STATE.DONE,
            output,
            JSON.stringify({ command: `pnpm test ${"--flag ".repeat(200)}(running)` }),
          ],
        );
        assert.deepEqual(steps[0]?.sender, { kind: REPLAY_SENDER.DEVELOPER });
      }),
  );

  it.effect(
    "a smaller window keeps the newest steps that fit it and says how many were left out, where a larger one replays the same transcript whole",
    () =>
      Effect.gen(function* () {
        const { eve, first, continueFrom } = yield* longSource();

        const small = yield* continueFrom(first.id);
        const kept = openedParts(eve).parts.replay;
        assert.equal(small.from?.totalSteps, LONG_TURNS);
        assert.ok(
          (small.from?.steps ?? LONG_TURNS) < LONG_TURNS,
          "the oldest steps went past the bound",
        );
        assert.ok((small.from?.steps ?? 0) > 0);
        assert.equal(kept?.steps.length, small.from?.steps);
        assert.match(kept?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
        assert.ok(stepsBytes(kept?.steps ?? []) < SMALL_WINDOW.tokens * 4);
        assert.match(
          kept?.preamble ?? "",
          new RegExp(
            `The oldest ${LONG_TURNS - (small.from?.steps ?? 0)} of its ${LONG_TURNS} steps are left out`,
            "u",
          ),
        );
        assert.equal(kept?.summary, undefined);

        const large = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        assert.deepEqual(large.from, {
          agentId: first.id,
          steps: LONG_TURNS,
          totalSteps: LONG_TURNS,
        });
      }),
  );

  it.effect(
    "the steps a window cannot keep are summarized on the new agent's model at its lowest effort, the summary ahead of the newest steps and counted within the bound",
    () =>
      Effect.gen(function* () {
        const asked: { prompt: string; options: string }[] = [];
        const efforts: string[] = [];
        const model = new MockLanguageModelV4({
          doGenerate: async (options) => {
            asked.push({
              prompt: JSON.stringify(options.prompt),
              options: JSON.stringify(options.providerOptions),
            });
            return {
              content: [{ type: "text", text: "Recap: the developer asked for step after step." }],
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              warnings: [],
            };
          },
        });
        const summaryModel: SummaryModelOf = (_, __, effort) => {
          efforts.push(effort);
          return Effect.succeed({ model, providerOptions: {}, counted: Effect.void });
        };
        const { eve, first, continueFrom } = yield* longSource({ summaryModel });
        const unsummarized = yield* longSource();
        yield* unsummarized.continueFrom(unsummarized.first.id);
        const alone = openedParts(unsummarized.eve).parts.replay?.steps.length ?? 0;

        const started = yield* continueFrom(first.id);
        const replay = openedParts(eve).parts.replay;

        assert.deepEqual(efforts, ["low"]);
        assert.deepEqual(replay?.summary, {
          text: "Recap: the developer asked for step after step.",
          steps: LONG_TURNS - (started.from?.steps ?? 0),
        });
        assert.ok(
          (started.from?.steps ?? 0) < alone,
          "the summary's room came out of the steps kept",
        );
        assert.match(replay?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
        assert.match(replay?.preamble ?? "", /written by Luke rather than by that agent/u);
        assert.match(asked[0]?.prompt ?? "", /Step 0\./u);
        assert.ok(
          asked.every((call) => !/Step 29\./u.test(call.prompt)),
          "a step kept is not summarized",
        );
      }),
  );

  it.effect(
    "a continue of a continue keeps the summary its source carried ahead of that source's steps, where the new window holds them",
    () =>
      Effect.gen(function* () {
        const model = new MockLanguageModelV4({
          doGenerate: async () => ({
            content: [{ type: "text", text: "Recap of the oldest steps." }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            warnings: [],
          }),
        });
        const summaryModel: SummaryModelOf = () =>
          Effect.succeed({ model, providerOptions: {}, counted: Effect.void });
        const { eve, first, continueFrom } = yield* longSource({ summaryModel });
        const second = yield* continueFrom(first.id);
        const carried = openedParts(eve).parts.replay;
        assert.ok(carried?.summary !== undefined);

        yield* continueFrom(second.id, { model: SOL, effort: "low" });
        const third = openedParts(eve).parts.replay;

        assert.deepEqual(third?.summary, carried.summary);
        assert.deepEqual(
          third?.steps.map((step) => step.summary),
          carried.steps.map((step) => step.summary),
        );
        assert.equal(third?.totalSteps, LONG_TURNS);
      }),
  );

  it.effect(
    "the files a Start's note carries are counted against the window before the steps are chosen",
    () =>
      Effect.gen(function* () {
        const { eve, first, continueFrom } = yield* longSource();
        yield* continueFrom(first.id, { note: "Look at this." });
        const without = openedParts(eve).parts.replay?.steps.length ?? 0;

        const notes = {
          name: "notes.txt",
          mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
          data: Buffer.from("y".repeat(40_000), "utf8").toString("base64"),
        };
        const started = yield* continueFrom(first.id, {
          note: "Look at this.",
          attachments: [notes],
        });

        assert.ok((started.from?.steps ?? without) < without, "the file took room the steps had");
      }),
  );

  it.effect(
    "a continue of an agent that never ran a turn is sent to the branch and pull request of the agent that one took up, not the default branch, unless that branch is in a repository the task moved from",
    () =>
      Effect.gen(function* () {
        // GitHub holds the source's pull request open, as its row says, when the first continue reads it again.
        const { owner, task, ask, eve, source } = yield* sourceAgentOn(publishedPullRequest);
        const continueFrom = (agentId: string) =>
          Effect.map(
            ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), from: { agentId } })),
            (answered) => readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answered).agent,
          );
        // The middle agent's session never ran a turn: it has no rows, no branch, and no sandbox.
        const never = yield* continueFrom(source.id);
        yield* continueFrom(never.id);
        const preamble = openedParts(eve).parts.replay?.preamble ?? "";

        assert.match(
          preamble,
          /It never made a branch of its own: it took up the work of the agent/u,
        );
        assert.ok(preamble.includes(`(agent id ${source.id})`));
        assert.ok(preamble.includes(`git switch '${PUBLISHED.branch}'`));
        assert.ok(preamble.includes(`/pull/${PUBLISHED.number}`));
        assert.doesNotMatch(preamble, /start from the repository's default branch/u);

        // A branch left in a repository the task has since moved from is none the new checkout holds.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ repository: "Acme/Former" })
            .where(eq(agentTable.id, source.id)),
        );
        yield* continueFrom(never.id);
        const moved = openedParts(eve).parts.replay?.preamble ?? "";
        assert.match(moved, /start from the repository's default branch/u);
        assert.ok(!moved.includes(PUBLISHED.branch));
      }),
  );

  it.effect(
    "a source eve compacted replays verbatim no more than the context it last measured, where the same source uncompacted replays whole",
    () =>
      Effect.gen(function* () {
        const { owner, eve, first, continueFrom } = yield* longSource();
        const stepAt = (inputTokens: number, at: number) =>
          recordAgentStep(owner, first.id, {
            inputTokens,
            outputTokens: 500,
            systemPromptTokens: 2_000,
            toolDefinitionTokens: 1_000,
            briefTokens: 100,
            at,
          });
        // Its thirty steps of about five thousand bytes each, as its model last read them whole.
        yield* stepAt(LONG_TURNS * 2_600, 1_000);
        const whole = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        assert.equal(whole.from?.steps, LONG_TURNS, "a source that never compacted replays whole");

        // eve folded all but the newest into a summary, and the next step read far less.
        const measured = 6_000;
        yield* recordAgentCompaction(owner, first.id, new Date(2_000));
        yield* stepAt(measured, 3_000);
        const bounded = yield* continueFrom(first.id, { model: SOL, effort: "low" });
        const replay = openedParts(eve).parts.replay;

        assert.equal(bounded.from?.totalSteps, LONG_TURNS);
        assert.ok((bounded.from?.steps ?? LONG_TURNS) < LONG_TURNS);
        assert.ok(stepsBytes(replay?.steps ?? []) <= measured * 2);
        assert.match(replay?.steps.at(-1)?.summary ?? "", /^Said: Step 29\./u);
      }),
  );

  it.effect(
    "a native source, whose steps estimate no instructions of their own, is fitted with the fallback's room for them, as a source that measured nothing is",
    () =>
      Effect.gen(function* () {
        const { owner, first, continueFrom } = yield* longSource();
        const unmeasured = yield* continueFrom(first.id, {
          model: SMALL_WINDOW.model,
          effort: "low",
        });
        // The runner's events record what Claude Code read, and nothing of instructions the CLI composed.
        yield* recordAgentStep(owner, first.id, {
          inputTokens: LONG_TURNS * 2_600,
          outputTokens: 500,
          systemPromptTokens: 0,
          toolDefinitionTokens: 0,
          briefTokens: 100,
          at: 1_000,
        });
        const native = yield* continueFrom(first.id, { model: SMALL_WINDOW.model, effort: "low" });

        assert.ok((unmeasured.from?.steps ?? LONG_TURNS) < LONG_TURNS);
        assert.equal(native.from?.steps, unmeasured.from?.steps);
      }),
  );

  it.effect(
    "a continue of a continue carries the first source's kept steps ahead of its own within the new agent's window",
    () =>
      Effect.gen(function* () {
        const { owner, eve, first, continueFrom } = yield* longSource();
        const second = yield* continueFrom(first.id);
        const secondSteps = openedParts(eve).parts.replay?.steps ?? [];

        const secondStored = Option.getOrThrow(yield* readAgent(owner, second.id));
        yield* transcriptRow(secondStored, 2, MESSAGE_ROLE.ASSISTANT, [
          text(`Picked it up. ${"y".repeat(5_000)}`),
        ]);
        const third = yield* continueFrom(second.id);
        const thirdSteps = openedParts(eve).parts.replay?.steps ?? [];

        assert.equal(third.from?.totalSteps, LONG_TURNS + 1);
        assert.equal(third.from?.steps, thirdSteps.length);
        assert.match(thirdSteps.at(-1)?.summary ?? "", /^Said: Picked it up\./u);
        assert.match(thirdSteps.at(-2)?.summary ?? "", /^Said: Step 29\./u);
        assert.notEqual(
          thirdSteps[0]?.summary,
          secondSteps[0]?.summary,
          "the chain's oldest kept step went to make room for the new one",
        );
      }),
  );
});

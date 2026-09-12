/**
 * One case per trust constraint the action pipeline holds, each named by the
 * sentence it keeps. A failure here is not a refactoring nit: it is a
 * guarantee `CLAUDE.md` states in as many words having stopped being true.
 */

import assert from "node:assert/strict";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  normalizeSession,
  type ObservedWorkspaceProject,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  WORKSPACE_TASK_SUPPORT,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { test } from "vitest";
import { ACTION_KIND, type ActionKind, type ActionRequest } from "./action-kinds.js";
import {
  ACTION_REFUSAL,
  type AdmitContext,
  admitEffect,
  type Refusal,
  type ValidatedAction,
} from "./admit.js";
import { maximumRememberedFacts } from "./memory.js";

const NOW = 1_800_000_000_000;

const IDENTITY = { provider_id: "conductor", provider_session_id: "chat-1" };

/** One session advertising every action its provider could document for it. */
function offering(): Session {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "chat-1",
      title: "Conductor: luke",
      status: SESSION_STATUS.WAITING,
      lastActivityAt: NOW,
      location: SESSION_LOCATION.CLOUD,
      detail: { link: "https://app.conductor.build/sessions/chat-1" },
      advertises: [
        { kind: ACTION_KIND.MESSAGE },
        {
          kind: ACTION_KIND.CONTROL,
          id: "cancel-run",
          label: "Stop this run",
          controlKind: SESSION_CONTROL_KIND.STOP,
        },
        { kind: ACTION_KIND.ADD_AGENT, agents: ["codex"] },
        { kind: ACTION_KIND.RENAME_SESSION },
        { kind: ACTION_KIND.RENAME_WORKSPACE, target: "workspace-1" },
      ],
    },
  );
}

/** The same session with nothing advertised: a local chat its provider documents no way into. */
function silent(): Session {
  return normalizeSession(
    { id: "claude-code", displayName: "Claude Code" },
    {
      providerSessionId: "chat-1",
      title: "Claude Code: luke",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: NOW,
      location: SESSION_LOCATION.LOCAL,
    },
  );
}

const LISTED_PROJECT: ObservedWorkspaceProject = {
  providerId: "conductor",
  providerName: "Conductor",
  providerProjectId: "luke",
  repository: "luke",
  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
};

/**
 * A context whose seams count what admission actually reached, so a test can
 * say not only what was answered but what was read to answer it.
 */
function context(
  overrides: Partial<AdmitContext> & { sessions?: readonly Session[] } = {},
): AdmitContext & { rosterReads: () => number; effects: () => number } {
  let rosterReads = 0;
  const sessions = overrides.sessions ?? [offering()];
  const built: AdmitContext = {
    origin: RUN_ORIGIN.USER,
    roster: {
      read: () =>
        Effect.sync(() => {
          rosterReads += 1;
          return sessions;
        }),
    },
    projects: {
      read: () => Effect.succeed([LISTED_PROJECT]),
      defaults: () => Effect.succeed({}),
      agentModels: () => [],
    },
    ...overrides,
  };
  return { ...built, rosterReads: () => rosterReads, effects: () => 0 };
}

const FIELDS = {
  [ACTION_KIND.MESSAGE]: { ...IDENTITY, text: "go ahead" },
  [ACTION_KIND.CONTROL]: { ...IDENTITY, control_id: "cancel-run" },
  [ACTION_KIND.OPEN]: { ...IDENTITY },
  [ACTION_KIND.CREATE_WORKSPACE]: { provider_id: "conductor", project_id: "luke" },
  [ACTION_KIND.ADD_AGENT]: { ...IDENTITY, agent: "codex" },
  [ACTION_KIND.RENAME_WORKSPACE]: { ...IDENTITY, name: "new name" },
  [ACTION_KIND.RENAME_SESSION]: { ...IDENTITY, name: "new name" },
  [ACTION_KIND.SETTING]: { setting_id: "voice_captions", value: "on" },
  [ACTION_KIND.PANEL]: { tab: "sessions" },
  [ACTION_KIND.FEEDBACK]: { kind: "feedback" },
  [ACTION_KIND.UPDATE]: { action: "check" },
  [ACTION_KIND.REMEMBER]: { words: "prefers concise answers" },
  [ACTION_KIND.FORGET]: { id: "fact-one" },
} satisfies Record<ActionKind, WireRecord>;

const SESSION_KINDS = [
  ACTION_KIND.MESSAGE,
  ACTION_KIND.CONTROL,
  ACTION_KIND.OPEN,
  ACTION_KIND.ADD_AGENT,
  ACTION_KIND.RENAME_WORKSPACE,
  ACTION_KIND.RENAME_SESSION,
] as const;

// SAFETY: the table above is keyed by every action kind and by nothing else.
const EVERY_KIND = Object.keys(FIELDS) as readonly ActionKind[];

/**
 * The gauntlet's decision as the one value these cases read: what
 * `admitEffect` succeeded with, or the refusal it failed with as the record
 * the action journal takes. A roster read that fails is left to reject, which
 * is what `admit-effect.test.ts` holds it to.
 */
function decide<Kind extends ActionKind>(
  request: ActionRequest<Kind>,
  context: AdmitContext,
): Promise<ValidatedAction<Kind> | Refusal> {
  return Effect.runPromise(
    Effect.catchAll(
      admitEffect(request, context),
      (refusal): Effect.Effect<ValidatedAction<Kind> | Refusal> =>
        Effect.succeed({ status: ACTION_RESULT_STATUS.REJECTED, reason: refusal.reason }),
    ),
  );
}

function refused(result: ValidatedAction | Refusal): string {
  assert.equal(result.kind, undefined, "expected a refusal");
  assert.ok(result.kind === undefined);
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  return result.reason;
}

test("each validated against the observed roster before an adapter sees it", async () => {
  const elsewhere = context({ sessions: [] });
  for (const kind of SESSION_KINDS) {
    const answer = await decide({ kind, fields: FIELDS[kind] }, elsewhere);
    assert.equal(refused(answer), ACTION_REFUSAL.NO_SESSION, kind);
  }
  assert.equal(elsewhere.rosterReads(), SESSION_KINDS.length);
});

test("a fresh roster read precedes it, and admission reads it once per action", async () => {
  for (const kind of SESSION_KINDS) {
    const standing = context();
    assert.notEqual((await decide({ kind, fields: FIELDS[kind] }, standing)).kind, undefined, kind);
    assert.equal(standing.rosterReads(), 1, kind);
  }
});

test("its target has to be one the roster holds", async () => {
  // The same session id under another provider is another session, and names nothing.
  const answer = await decide(
    { kind: ACTION_KIND.MESSAGE, fields: { ...FIELDS[ACTION_KIND.MESSAGE], provider_id: "codex" } },
    context(),
  );
  assert.equal(refused(answer), ACTION_REFUSAL.NO_SESSION);
});

test("a cancellation or a revoked run refuses it", async () => {
  for (const kind of EVERY_KIND) {
    const revoked = context({ guard: { isRevoked: () => true } });
    assert.equal(
      refused(await decide({ kind, fields: FIELDS[kind] }, revoked)),
      ACTION_REFUSAL.TURN_OVER,
      kind,
    );
    assert.equal(revoked.rosterReads(), 0, kind);
  }
});

test("a turn that ends while the roster is read refuses rather than dispatching", async () => {
  let over = false;
  const controller = new AbortController();
  const answer = await decide(
    { kind: ACTION_KIND.MESSAGE, fields: FIELDS[ACTION_KIND.MESSAGE] },
    {
      origin: RUN_ORIGIN.USER,
      guard: { isRevoked: () => over, signal: controller.signal },
      roster: {
        read: () =>
          Effect.sync(() => {
            over = true;
            return [offering()];
          }),
      },
    },
  );
  assert.equal(refused(answer), ACTION_REFUSAL.TURN_OVER);
});

test("a read still out when the signal fires answers nothing, and the action refuses", async () => {
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const held = new Promise<readonly Session[]>((resolve) => {
    release = () => resolve([offering()]);
  });
  const pending = decide(
    { kind: ACTION_KIND.MESSAGE, fields: FIELDS[ACTION_KIND.MESSAGE] },
    {
      origin: RUN_ORIGIN.USER,
      guard: { isRevoked: () => controller.signal.aborted, signal: controller.signal },
      roster: { read: () => Effect.promise(() => held) },
    },
  );
  controller.abort();
  assert.equal(refused(await pending), ACTION_REFUSAL.TURN_OVER);
  release?.();
});

test("a control its provider advertised for it, and never the caller's copy", async () => {
  const roster = [offering()];
  const admitted = await decide(
    { kind: ACTION_KIND.CONTROL, fields: FIELDS[ACTION_KIND.CONTROL] },
    context({ sessions: roster }),
  );
  assert.equal(admitted.kind, ACTION_KIND.CONTROL);
  assert.ok(admitted.kind === ACTION_KIND.CONTROL);
  const advertised = roster[0]?.advertises.find(
    (advertised) => advertised.kind === ACTION_KIND.CONTROL,
  );
  assert.deepEqual(admitted.control, advertised);
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.CONTROL, fields: { ...IDENTITY, control_id: "terminate" } },
        context(),
      ),
    ),
    ACTION_REFUSAL.NO_CONTROL,
  );
});

test("a session whose current state is documented for none advertises nothing and is offered nothing", async () => {
  const local = silent();
  const quiet = context({ sessions: [local] });
  const named = { provider_id: local.providerId, provider_session_id: local.providerSessionId };
  for (const kind of SESSION_KINDS) {
    if (kind === ACTION_KIND.OPEN) continue;
    assert.notEqual(
      refused(await decide({ kind, fields: { ...FIELDS[kind], ...named } }, quiet)),
      "",
      kind,
    );
  }
});

test("local sessions have no such endpoint and stay entirely read-only", async () => {
  const local = silent();
  const observed = context({ sessions: [local] });
  const named = { provider_id: local.providerId, provider_session_id: local.providerSessionId };
  for (const kind of SESSION_KINDS) {
    if (kind === ACTION_KIND.OPEN) continue;
    assert.equal(
      (await decide({ kind, fields: { ...FIELDS[kind], ...named } }, observed)).kind,
      undefined,
      kind,
    );
  }
  // An open is not a write, and a session reporting no address is offered nowhere to open.
  assert.equal(
    refused(await decide({ kind: ACTION_KIND.OPEN, fields: named }, observed)),
    ACTION_REFUSAL.NO_ADDRESS,
  );
});

test("the developer's own text, bounded and refused rather than cut", async () => {
  const atBound = "a".repeat(maximumSessionMessageLength);
  const admitted = await decide(
    { kind: ACTION_KIND.MESSAGE, fields: { ...IDENTITY, text: atBound } },
    context(),
  );
  assert.ok(admitted.kind === ACTION_KIND.MESSAGE);
  assert.equal(admitted.text, atBound);
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.MESSAGE, fields: { ...IDENTITY, text: `${atBound}a` } },
        context(),
      ),
    ),
    ACTION_REFUSAL.MESSAGE_BOUND,
  );
  const name = "n".repeat(maximumWorkspaceNameLength + 1);
  for (const kind of [ACTION_KIND.RENAME_WORKSPACE, ACTION_KIND.RENAME_SESSION] as const) {
    assert.equal(
      (await decide({ kind, fields: { ...IDENTITY, name } }, context())).kind,
      undefined,
    );
  }
});

test("lands only in a project its provider reported on the latest observation pass", async () => {
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.CREATE_WORKSPACE, fields: { project_id: "/Users/me/other" } },
        context(),
      ),
    ),
    ACTION_REFUSAL.NO_PROJECT,
  );
  const admitted = await decide(
    { kind: ACTION_KIND.CREATE_WORKSPACE, fields: { project_id: "luke" } },
    context(),
  );
  assert.ok(admitted.kind === ACTION_KIND.CREATE_WORKSPACE);
  // Every identifier the action carries is the listed project's, never the ask's.
  assert.equal(admitted.providerId, LISTED_PROJECT.providerId);
  assert.equal(admitted.providerProjectId, LISTED_PROJECT.providerProjectId);
  // A target the ask invents for a project listed without one names no host
  // to pick, so it neither hides the project nor rides the action.
  const targeted = await decide(
    { kind: ACTION_KIND.CREATE_WORKSPACE, fields: { project_id: "luke", target_id: "default" } },
    context(),
  );
  assert.ok(targeted.kind === ACTION_KIND.CREATE_WORKSPACE);
  assert.equal(targeted.providerProjectId, LISTED_PROJECT.providerProjectId);
  assert.equal(targeted.providerTargetId, undefined);
});

test("each project says whether it takes a task, needs one, or takes none", async () => {
  const withSupport = (taskSupport: ObservedWorkspaceProject["taskSupport"]) =>
    context({
      projects: {
        read: () => Effect.succeed([{ ...LISTED_PROJECT, taskSupport }]),
        defaults: () => Effect.succeed({}),
        agentModels: () => [],
      },
    });
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.CREATE_WORKSPACE, fields: { project_id: "luke", task: "start" } },
        withSupport(WORKSPACE_TASK_SUPPORT.NONE),
      ),
    ),
    ACTION_REFUSAL.NO_TASK_TAKEN,
  );
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.CREATE_WORKSPACE, fields: { project_id: "luke" } },
        withSupport(WORKSPACE_TASK_SUPPORT.REQUIRED),
      ),
    ),
    ACTION_REFUSAL.TASK_REQUIRED,
  );
});

test("as one of the agent kinds that row's latest observation listed", async () => {
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.ADD_AGENT, fields: { ...IDENTITY, agent: "opencode" } },
        context(),
      ),
    ),
    ACTION_REFUSAL.NO_SESSION_AGENT,
  );
  const admitted = await decide(
    { kind: ACTION_KIND.ADD_AGENT, fields: FIELDS[ACTION_KIND.ADD_AGENT] },
    context(),
  );
  assert.ok(admitted.kind === ACTION_KIND.ADD_AGENT);
  assert.equal(admitted.agent, "codex");
});

test("who opened a turn is recorded on the action and is never by itself a permission", async () => {
  const answers = await Promise.all(
    Object.values(RUN_ORIGIN).map(async (origin) => {
      const admitted = await decide(
        { kind: ACTION_KIND.MESSAGE, fields: FIELDS[ACTION_KIND.MESSAGE] },
        { ...context(), origin },
      );
      assert.ok(admitted.kind === ACTION_KIND.MESSAGE);
      assert.equal(admitted.origin, origin);
      const { origin: _origin, ...payload } = admitted;
      return payload;
    }),
  );
  for (const answer of answers) assert.deepEqual(answer, answers[0]);
});

test("a setting the guide does not carry is one the conversation cannot change", async () => {
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.SETTING, fields: FIELDS[ACTION_KIND.SETTING] },
        { ...context(), guide: EMPTY_APP_GUIDE },
      ),
    ),
    ACTION_REFUSAL.NO_SETTING,
  );
  // A run that reports nothing about itself changes nothing about itself.
  assert.equal(
    refused(
      await decide({ kind: ACTION_KIND.SETTING, fields: FIELDS[ACTION_KIND.SETTING] }, context()),
    ),
    ACTION_REFUSAL.NO_SETTING,
  );
  assert.equal(
    refused(
      await decide({ kind: ACTION_KIND.UPDATE, fields: FIELDS[ACTION_KIND.UPDATE] }, context()),
    ),
    ACTION_REFUSAL.NO_UPDATE_REPORT,
  );
});

test("only an id from the remembered list can be named, and the cap refuses rather than evicts", async () => {
  const held = [{ id: "fact-one", words: "prefers concise answers" }];
  const notebook = context({ rememberedFacts: held });
  assert.equal(
    refused(await decide({ kind: ACTION_KIND.FORGET, fields: { id: "fact-two" } }, notebook)),
    ACTION_REFUSAL.NO_SUCH_FACT,
  );
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.REMEMBER, fields: { words: "x", replaces: "fact-two" } },
        notebook,
      ),
    ),
    ACTION_REFUSAL.NO_SUCH_FACT,
  );
  const full = Array.from({ length: maximumRememberedFacts }, (_, index) => ({
    id: `fact-${index}`,
    words: `something ${index}`,
  }));
  assert.equal(
    refused(
      await decide(
        { kind: ACTION_KIND.REMEMBER, fields: FIELDS[ACTION_KIND.REMEMBER] },
        context({ rememberedFacts: full }),
      ),
    ),
    ACTION_REFUSAL.MEMORY_FULL,
  );
});

test("opening a session is not a write: the action carries an identity, never an address", async () => {
  const admitted = await decide(
    { kind: ACTION_KIND.OPEN, fields: FIELDS[ACTION_KIND.OPEN] },
    context(),
  );
  assert.ok(admitted.kind === ACTION_KIND.OPEN);
  assert.deepEqual(Object.keys(admitted).sort(), ["identity", "kind", "origin"]);
});

/**
 * Which observed state each action is admitted against, and nothing wider. Only
 * an action whose target the roster holds reads the roster, and only a creation
 * reads the offered projects — an intake that observes lazily has to be held
 * to observing for the actions that need it, since a read that quietly stops
 * happening is an action admitted against a stale picture.
 */
const READS = {
  [ACTION_KIND.MESSAGE]: ["roster"],
  [ACTION_KIND.CONTROL]: ["roster"],
  [ACTION_KIND.OPEN]: ["roster"],
  [ACTION_KIND.CREATE_WORKSPACE]: ["projects", "defaults"],
  [ACTION_KIND.ADD_AGENT]: ["roster"],
  [ACTION_KIND.RENAME_WORKSPACE]: ["roster"],
  [ACTION_KIND.RENAME_SESSION]: ["roster"],
  [ACTION_KIND.SETTING]: [],
  [ACTION_KIND.PANEL]: ["roster"],
  [ACTION_KIND.FEEDBACK]: [],
  [ACTION_KIND.UPDATE]: [],
  [ACTION_KIND.REMEMBER]: [],
  [ACTION_KIND.FORGET]: [],
} satisfies Record<ActionKind, readonly ("roster" | "projects" | "defaults")[]>;

test("each action is admitted against the observed state it names, and against nothing wider", async () => {
  for (const kind of EVERY_KIND) {
    const reached: string[] = [];
    await decide(
      { kind, fields: FIELDS[kind] },
      {
        origin: RUN_ORIGIN.USER,
        roster: {
          read: () =>
            Effect.sync(() => {
              reached.push("roster");
              return [offering()];
            }),
        },
        projects: {
          read: () =>
            Effect.sync(() => {
              reached.push("projects");
              return [LISTED_PROJECT];
            }),
          defaults: () =>
            Effect.sync(() => {
              reached.push("defaults");
              return {};
            }),
          agentModels: () => [],
        },
        guide: EMPTY_APP_GUIDE,
        rememberedFacts: [{ id: "fact-one", words: "prefers concise answers" }],
      },
    );
    // Sorted, because which of a creation's two reads runs first is admission's
    // own business; that both run, once each, is not.
    assert.deepEqual([...reached].sort(), [...READS[kind]].sort(), kind);
  }
});

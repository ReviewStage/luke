import assert from "node:assert/strict";
import test from "node:test";
import {
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionLocation,
  type SessionProvider,
  SessionRoster,
} from "@sidecar/session";
import { maximumSessionLinkLength, supportsSessionControl } from "./session.js";

const codex: SessionProvider = { id: "codex", displayName: "Codex" };
const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const TEST_CONTROL = {
  OPEN: "open",
  INTERRUPT: "interrupt",
} as const;
const TEST_CONTROL_WITH_WHITESPACE = " open ";
const TEST_CONDUCTOR_LINK = "https://app.conductor.build/sessions/session-1";

function observation(
  providerSessionId: string,
  lastActivityAt: number,
  overrides: Partial<ProviderSessionObservation> = {},
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: "Implement the shared session core",
    status: SESSION_STATUS.WORKING,
    lastActivityAt,
    ...overrides,
  };
}

/** One provider's pass with a single session, answering the session as the roster holds it. */
function observe(
  roster: SessionRoster,
  provider: SessionProvider,
  observed: ProviderSessionObservation,
): Session {
  const [session] = roster.replaceProvider(provider, [observed]);
  assert.ok(session);
  return session;
}

test("normalizes provider observations without conflating provider-local identities", () => {
  const roster = new SessionRoster();
  const session = observe(
    roster,
    codex,
    observation("run:42", 100, {
      title: "  Implement the shared session core  ",
      parentProviderSessionId: "  run:parent  ",
      controls: [{ id: TEST_CONTROL_WITH_WHITESPACE, label: " Open workspace " }],
    }),
  );
  roster.replaceProvider(claude, [observation("run:42", 90)]);

  assert.deepEqual(
    { providerId: session.providerId, providerSessionId: session.providerSessionId },
    { providerId: codex.id, providerSessionId: "run:42" },
  );
  assert.equal(session.title, "Implement the shared session core");
  assert.equal(session.parentProviderSessionId, "run:parent");
  assert.deepEqual(session.controls, [{ id: TEST_CONTROL.OPEN, label: "Open workspace" }]);
  assert.equal(supportsSessionControl(session, TEST_CONTROL.OPEN), true);
  assert.equal(supportsSessionControl(session, TEST_CONTROL.INTERRUPT), false);
  assert.equal(roster.list().length, 2);
});

test("a workspace grouping is bounded, and one without an id is dropped whole", () => {
  const roster = new SessionRoster();
  const [grouped, unidentified, ungrouped] = roster.replaceProvider(codex, [
    observation("run:grouped", 300, {
      workspace: { providerWorkspaceId: "  workspace-1  ", name: "  lisbon-v2  " },
    }),
    // A workspace no sibling could ever be matched to groups nothing.
    observation("run:unidentified", 200, {
      workspace: { providerWorkspaceId: "   ", name: "lisbon-v2" },
    }),
    observation("run:ungrouped", 100),
  ]);

  assert.deepEqual(grouped?.workspace, { providerWorkspaceId: "workspace-1", name: "lisbon-v2" });
  assert.equal(unidentified?.workspace, undefined);
  assert.equal(ungrouped?.workspace, undefined);
});

test("keeps several bounded app associations without changing the agent identity", () => {
  const roster = new SessionRoster();
  const session = observe(
    roster,
    codex,
    observation("run:applications", 100, {
      applications: [
        {
          id: SESSION_APPLICATION_ID.SUPERSET,
          displayName: " Superset ",
          scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
          link: "file:///tmp/not-openable",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Conductor",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
        {
          id: SESSION_APPLICATION_ID.CHATGPT,
          displayName: "ChatGPT",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
          link: "codex://threads/run%3Aapplications",
        },
        {
          id: SESSION_APPLICATION_ID.CONDUCTOR,
          displayName: "Duplicate",
          scope: SESSION_APPLICATION_SCOPE.SESSION,
        },
      ],
    }),
  );

  assert.equal(session.providerId, codex.id);
  assert.deepEqual(session.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: "codex://threads/run%3Aapplications",
    },
    {
      id: SESSION_APPLICATION_ID.CONDUCTOR,
      displayName: "Conductor",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
    },
    {
      id: SESSION_APPLICATION_ID.SUPERSET,
      displayName: "Superset",
      scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
    },
  ]);
});

test("a session takes messages only when its adapter said so explicitly", () => {
  const roster = new SessionRoster();
  const identity = { providerId: codex.id, providerSessionId: "run:message" };

  roster.replaceProvider(codex, [observation("run:message", 100)]);
  assert.equal(roster.get(identity)?.canReceiveMessage, false);

  roster.replaceProvider(codex, [observation("run:message", 100, { canReceiveMessage: true })]);
  assert.equal(roster.get(identity)?.canReceiveMessage, true);
});

test("the agents a session can start are the latest pass's word", () => {
  const roster = new SessionRoster();
  const identity = { providerId: codex.id, providerSessionId: "run:spawn" };

  roster.replaceProvider(codex, [observation("run:spawn", 100)]);
  assert.deepEqual(roster.get(identity)?.spawnableAgents, []);

  roster.replaceProvider(codex, [
    observation("run:spawn", 100, { spawnableAgents: ["claude", "cursor"] }),
  ]);
  assert.deepEqual(roster.get(identity)?.spawnableAgents, ["claude", "cursor"]);
});

test("keeps only the addresses Luke would open, and never a shortened one", () => {
  const roster = new SessionRoster();
  const linkFor = (link: string) =>
    observe(roster, codex, observation("run:link", 100, { detail: { link } })).detail.link;

  for (const link of [
    "https://cursor.com/agents?id=bc_1",
    "codex://threads/019ff315-8735-7382-9fbe-16b0ea8ad990",
    "conductor://workspace?session=session-working",
    "superset://v2-workspace/019ff315-8735-7382-9fbe-16b0ea8ad990",
  ]) {
    assert.equal(linkFor(link), link, `${link} is a session's own address`);
  }
  assert.equal(linkFor("  https://app.conductor.build/sessions/session-1  "), TEST_CONDUCTOR_LINK);

  // A scheme outside the set never becomes a session's address, so nothing
  // downstream has to ask a second time whether an address is safe to open.
  for (const link of [
    "http://cursor.com/agents?id=bc_1",
    "file:///Users/dean/.claude/projects/luke/session.jsonl",
    "javascript:void 0",
    "/Users/dean/luke",
    "not a url",
    "",
  ]) {
    assert.equal(linkFor(link), undefined, `${link} is not an address Luke may open`);
  }

  // A link past the bound is dropped rather than cut: every other field is
  // shortened to fit a row, but a shortened address is a different address.
  assert.equal(linkFor(`https://example.com/${"a".repeat(maximumSessionLinkLength)}`), undefined);
});

test("a change is held to the web alone, and never a shortened one", () => {
  const roster = new SessionRoster();
  const changeFor = (change: string) =>
    observe(roster, codex, observation("run:change", 100, { detail: { change } })).detail.change;

  // The pull-request chip acts on this field the way pressing a row acts on
  // the link, so the same rule guards it — narrowed to https because every
  // pull request a provider reports lives on the web.
  assert.equal(
    changeFor("https://github.com/example/luke/pull/7"),
    "https://github.com/example/luke/pull/7",
  );
  for (const change of [
    "codex://threads/019ff315-8735-7382-9fbe-16b0ea8ad990",
    "file:///Users/dean/luke/pull.diff",
    "javascript:void 0",
    "not a url",
    "",
  ]) {
    assert.equal(changeFor(change), undefined, `${change} is not a change Luke may open`);
  }
  assert.equal(changeFor(`https://example.com/${"a".repeat(maximumSessionLinkLength)}`), undefined);
});

test("a session runs on this machine unless its provider observed it elsewhere", () => {
  const roster = new SessionRoster();
  const [remote, local] = roster.replaceProvider(codex, [
    observation("local", 100),
    observation("remote", 200, { location: SESSION_LOCATION.CLOUD }),
  ]);

  assert.equal(local?.location, SESSION_LOCATION.LOCAL);
  assert.equal(remote?.location, SESSION_LOCATION.CLOUD);
  // A location a later build adds is rejected rather than shown as local.
  assert.throws(
    () =>
      roster.replaceProvider(codex, [
        // SAFETY: test deliberately supplies an out-of-vocabulary location to prove rejection.
        observation("elsewhere", 100, { location: "orbit" as SessionLocation }),
      ]),
    /Unknown session location: orbit/,
  );
});

test("refresh replaces one adapter's sessions whole and leaves other providers untouched", async () => {
  const roster = new SessionRoster();
  roster.replaceProvider(codex, [observation("stale", 10), observation("active", 20)]);
  roster.replaceProvider(claude, [observation("review", 30, { status: SESSION_STATUS.WAITING })]);

  await roster.refresh({
    provider: codex,
    observe: async () => [observation("active", 50), observation("new", 60)],
  });

  // The roster is the latest pass: a session the provider stopped reporting
  // is gone, with nothing kept back for it.
  assert.deepEqual(
    roster.list().map(({ providerId, providerSessionId }) => ({ providerId, providerSessionId })),
    [
      { providerId: codex.id, providerSessionId: "new" },
      { providerId: codex.id, providerSessionId: "active" },
      { providerId: claude.id, providerSessionId: "review" },
    ],
  );
  assert.equal(
    roster.get({ providerId: "claude-code", providerSessionId: "review" })?.status,
    SESSION_STATUS.WAITING,
  );
  assert.equal(roster.get({ providerId: "codex", providerSessionId: "stale" }), undefined);
});

test("a refresh may reshape the observation before it lands, per provider", async () => {
  const roster = new SessionRoster();
  await roster.refresh(
    { provider: codex, observe: async () => [observation("run:1", 10)] },
    (providerId, observations) =>
      observations.map((observed) => ({ ...observed, title: `${providerId}: ${observed.title}` })),
  );
  assert.equal(
    roster.get({ providerId: codex.id, providerSessionId: "run:1" })?.title,
    "codex: Implement the shared session core",
  );
});

test("every pass reaches the listeners, moved or not", () => {
  const roster = new SessionRoster();
  const heard: number[] = [];
  const unsubscribe = roster.subscribe((sessions) => {
    heard.push(sessions.length);
  });

  roster.replaceProvider(codex, [observation("active", 10)]);
  roster.replaceProvider(codex, [observation("active", 10)]);
  roster.replaceProvider(codex, []);
  unsubscribe();
  roster.replaceProvider(codex, [observation("active", 10)]);

  // Nothing here decides whether anything moved; the renderer draws identical
  // props as the same picture, and the brain notices news against its memory.
  assert.deepEqual(heard, [1, 1, 0]);
  assert.equal(roster.list().length, 1);
});

test("a malformed provider snapshot leaves the previous roster intact", () => {
  const roster = new SessionRoster();
  roster.replaceProvider(codex, [observation("active", 10)]);

  assert.throws(
    () =>
      roster.replaceProvider(codex, [observation("duplicate", 20), observation("duplicate", 30)]),
    /Duplicate session observation: duplicate/,
  );
  assert.equal(roster.list().length, 1);
  assert.equal(
    roster.get({ providerId: "codex", providerSessionId: "active" })?.title,
    "Implement the shared session core",
  );
  assert.throws(
    () => roster.replaceProvider({ id: " ", displayName: "Invalid" }, [observation("ignored", 20)]),
    /provider id must not be empty/,
  );
});

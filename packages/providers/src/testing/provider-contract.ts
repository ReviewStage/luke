import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ActionKind,
  type ActionRequest,
  type AdmitContext,
  admitEffect,
  type Refusal,
  type ValidatedAction,
} from "@sidecar/actions";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import {
  ACTION_KIND,
  ACTION_RESULT_STATUS,
  type ActionInput,
  type AdvertisedActionKind,
  type AdvertisedControl,
  advertisedActionFor,
  advertisedControls,
  dispatchAction,
  maximumSessionMessageLength,
  normalizeSession,
  type ProviderActionResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceResult,
  SESSION_STATUS,
  type SessionProviderPlugin,
  type WorkspaceProject,
} from "@sidecar/session";
import type { Admitted } from "@sidecar/wire";
import {
  admittedForTest,
  type FakeCloudApi,
  HTTP_STATUS,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  recordedRoutes,
  runTest,
  temporaryDirectory,
} from "@sidecar/wire/testing";
import { Effect } from "effect";
import { type TestContext, test } from "vitest";
import {
  assertGoldenJson,
  assertGoldenText,
  homeManifest,
  providerFixtureRoot,
  recordedApi,
  seedHome,
} from "./fixture-recording.js";

/** How this provider is observed at all, which decides which cases run. */
export const PROVIDER_OBSERVATION = {
  /** A home on disk: no credential, no process, no network. */
  FILES: "files",
  /** A user-supplied API key over HTTP. */
  KEY: "key",
} as const;

type ProviderObservation = (typeof PROVIDER_OBSERVATION)[keyof typeof PROVIDER_OBSERVATION];

/** Everything a provider's plugin is built from inside one contract case. */
interface ProviderFixtureInput {
  /** A temporary directory seeded from `home/`; the provider's home for this case. */
  readonly home: string;
  readonly now: () => number;
  readonly minimumRefreshIntervalMs: number;
  /** Answers `undefined` for the no-key cases, and throws for the unreadable one. */
  readonly readApiKey: () => Promise<string | undefined>;
  /**
   * The fake backing this fixture's recorded `api/` routes. Every provider is
   * handed one, whatever it is observed by: it throws for a request the
   * fixture never recorded, so a provider that reaches somewhere new fails
   * loudly rather than silently.
   */
  readonly api: FakeCloudApi;
  /** Where the observation hook's spool stands for this case, or nowhere. */
  readonly hookEventsDirectory: () => string | undefined;
  /**
   * One of this fixture's `db/<name>.sql` scripts, with `{{home}}` replaced by
   * this case's own home: a provider that records absolute paths in its
   * database cannot have them committed, and the home is the only value a
   * script may name.
   */
  readonly sql: (name: string) => Promise<string>;
}

export type ProviderPluginFactory = (
  input: ProviderFixtureInput,
) => SessionProviderPlugin | Promise<SessionProviderPlugin>;

export interface ProviderFixtures {
  /** The provider id, which is also the fixture directory's name. */
  readonly providerId: string;
  readonly observation: ProviderObservation;
  /** The instant every case runs at, so a golden roster is deterministic. */
  readonly now: number;
  /** The session the actions are asked of; it must appear in `golden/roster.json`. */
  readonly sessionId: string;
  /** A session id no pass reports, for the unobserved-target case. */
  readonly absentSessionId: string;
  /** The action kinds the golden roster advertises for `sessionId`. */
  readonly advertised: readonly AdvertisedActionKind[];
  /** The action kinds it does not; every one must answer unsupported. */
  readonly unadvertised: readonly AdvertisedActionKind[];
  /** Set when this build documents reading this provider's transcript. */
  readonly transcript?: {
    readonly sessionId: string;
    /** An observed session whose stored shape this build renders nothing from. */
    readonly unrenderableSessionId?: string;
    /**
     * Set for a cloud provider whose transcript read is its documented
     * messages endpoint: the read reaches the provider, and only that route.
     */
    readonly throughMessagesEndpoint?: boolean;
  };
  /** Set when this provider documents a conversation read. */
  readonly conversation?: { readonly sessionId: string };
  /** Set for a hooked provider: every token its own spool may hold. */
  readonly hookSpool?: { readonly events: readonly string[] };
  /** A project id no pass reported, for the creation case. */
  readonly absentProjectId: string;
  /**
   * A control the golden roster advertises with a target of its own, for the
   * case that rewrites one. A provider whose controls all action on the session
   * itself names none.
   */
  readonly targetedControlId?: string;
}

/**
 * Every kind an observation can advertise. A provider declares its answer for
 * each, so a kind added to the vocabulary fails every contract until each
 * provider says whether it carries it.
 */
const ADVERTISED_ACTION_KINDS = Object.values({
  [ACTION_KIND.MESSAGE]: ACTION_KIND.MESSAGE,
  [ACTION_KIND.CONTROL]: ACTION_KIND.CONTROL,
  [ACTION_KIND.ADD_AGENT]: ACTION_KIND.ADD_AGENT,
  [ACTION_KIND.RENAME_SESSION]: ACTION_KIND.RENAME_SESSION,
  [ACTION_KIND.RENAME_WORKSPACE]: ACTION_KIND.RENAME_WORKSPACE,
} as const satisfies Record<AdvertisedActionKind, AdvertisedActionKind>);

/**
 * The roster and the request as admission reads them, over this provider's own
 * recorded pass. The two cases below hold `admitEffect()` to a sentence rather
 * than the adapter, because admission is where the sentence now lives — and
 * they run per provider so each provider's own advertisement shape is what is
 * read.
 */
function admissionOver(plugin: SessionProviderPlugin): AdmitContext {
  return {
    origin: RUN_ORIGIN.USER,
    roster: {
      read: () =>
        Effect.succeed(plugin.latest().map((one) => normalizeSession(plugin.provider, one))),
    },
  };
}

/**
 * The gauntlet's decision as one value: what it minted, or the refusal it
 * failed with in the shape the action journal records. A case here reads both
 * the same, because what it is holding admission to is the sentence.
 */
function decide(
  request: ActionRequest<ActionKind>,
  context: AdmitContext,
): Promise<ValidatedAction | Refusal> {
  return runTest(
    Effect.catchAll(
      admitEffect(request, context),
      (refusal): Effect.Effect<ValidatedAction | Refusal> =>
        Effect.succeed({ status: ACTION_RESULT_STATUS.REJECTED, reason: refusal.reason }),
    ),
  );
}

function admissionRequest(
  plugin: SessionProviderPlugin,
  kind: AdvertisedActionKind,
  providerSessionId: string,
  overrides: ActionOverrides = {},
): ActionRequest<ActionKind> {
  const identity = {
    provider_id: plugin.provider.id,
    provider_session_id: providerSessionId,
  };
  switch (kind) {
    case ACTION_KIND.MESSAGE:
      return {
        kind: ACTION_KIND.MESSAGE,
        fields: { ...identity, text: overrides.text ?? UNSUPPORTED_MESSAGE_TEXT },
      };
    case ACTION_KIND.CONTROL:
      return {
        kind: ACTION_KIND.CONTROL,
        fields: {
          ...identity,
          control_id: overrides.control?.id ?? "contract-unadvertised-control",
        },
      };
    case ACTION_KIND.ADD_AGENT:
      return {
        kind: ACTION_KIND.ADD_AGENT,
        fields: { ...identity, agent: overrides.agent ?? "contract-unadvertised-agent" },
      };
    case ACTION_KIND.RENAME_SESSION:
      return { kind: ACTION_KIND.RENAME_SESSION, fields: { ...identity, name: "contract" } };
    case ACTION_KIND.RENAME_WORKSPACE:
      return { kind: ACTION_KIND.RENAME_WORKSPACE, fields: { ...identity, name: "contract" } };
  }
}

const CONTRACT_API_KEY = "contract-initial-key";
const REPLACEMENT_API_KEY = "contract-replacement-key";
const REFRESH_INTERVAL_MS = 15_000;
/** The one body key a POSTed read document rides under. */
const READ_DOCUMENT_FIELD = "query";
const UNSUPPORTED_MESSAGE_TEXT = "This message must never reach a provider.";

function observationFor(
  plugin: SessionProviderPlugin,
  providerSessionId: string,
): ProviderSessionObservation {
  return (
    plugin.latest().find((candidate) => candidate.providerSessionId === providerSessionId) ?? {
      providerSessionId,
      title: "unobserved",
      status: SESSION_STATUS.UNKNOWN,
      lastActivityAt: 0,
    }
  );
}

const UNSUPPORTED: ProviderActionResult = {
  status: ACTION_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider names no such action.",
};

/**
 * Asks one action of a plugin the way its dispatcher will, over the target's own
 * observation, with an admitted input because that is the only kind a plugin
 * action takes. Whether the ask may run at all is admission's answer, asked
 * separately below; what this exercises is what the provider does with one.
 */
async function askAction(
  plugin: SessionProviderPlugin,
  kind: AdvertisedActionKind,
  providerSessionId: string,
  overrides: ActionOverrides = {},
): Promise<ProviderActionResult | ProviderWorkspaceResult> {
  const observation = observationFor(plugin, providerSessionId);
  const input = <Request>(request: Request): Admitted<ActionInput<Request>> =>
    admittedForTest({ request, observation });
  switch (kind) {
    case ACTION_KIND.MESSAGE:
      return (
        (await plugin.actions?.message?.(
          input({ text: overrides.text ?? UNSUPPORTED_MESSAGE_TEXT }),
        )) ?? UNSUPPORTED
      );
    case ACTION_KIND.CONTROL: {
      const control = overrides.control ?? {
        kind: ACTION_KIND.CONTROL,
        id: "contract-unadvertised-control",
        label: "Never advertised",
      };
      return (await plugin.actions?.control?.(input({ control }))) ?? UNSUPPORTED;
    }
    case ACTION_KIND.ADD_AGENT: {
      // The dispatcher resolves the target from the advertisement, so the
      // suite hands over exactly what the advertisement named.
      const advertised = observation && advertisedActionFor(observation, ACTION_KIND.ADD_AGENT);
      return (
        (await plugin.actions?.spawnAgent?.(
          input({
            spawnTarget: advertised?.target ?? providerSessionId,
            agent: overrides.agent ?? "contract-unadvertised-agent",
          }),
        )) ?? UNSUPPORTED
      );
    }
    case ACTION_KIND.RENAME_SESSION:
      return (await plugin.actions?.renameSession?.(input({ name: "contract" }))) ?? UNSUPPORTED;
    case ACTION_KIND.RENAME_WORKSPACE: {
      const advertised =
        observation && advertisedActionFor(observation, ACTION_KIND.RENAME_WORKSPACE);
      return (
        (await plugin.actions?.renameWorkspace?.(
          input({ renameTarget: advertised?.target ?? providerSessionId, name: "contract" }),
        )) ?? UNSUPPORTED
      );
    }
  }
}

/** What an action's request carries from the observation's own advertisement. */
interface ActionOverrides {
  control?: AdvertisedControl;
  text?: string;
  agent?: string;
}

/** The advertisement one action kind stands on for the fixture's own session. */
function advertisementFor(
  plugin: SessionProviderPlugin,
  fixtures: ProviderFixtures,
  kind: AdvertisedActionKind,
): ActionOverrides {
  const observation = observationFor(plugin, fixtures.sessionId);
  if (kind === ACTION_KIND.CONTROL) {
    const control = advertisedControls(observation)[0];
    return control ? { control } : {};
  }
  if (kind === ACTION_KIND.ADD_AGENT) {
    const agent = advertisedActionFor(observation, ACTION_KIND.ADD_AGENT)?.agents[0];
    return agent ? { agent } : {};
  }
  return {};
}

interface ContractCase {
  readonly plugin: SessionProviderPlugin;
  readonly home: string;
  readonly api: FakeCloudApi;
  readonly setApiKey: (apiKey: string | undefined) => void;
  readonly setNow: (now: number) => void;
}

interface CaseOptions {
  readonly readApiKey?: () => Promise<string | undefined>;
  readonly minimumRefreshIntervalMs?: number;
  readonly hookEventsDirectory?: () => string | undefined;
}

/**
 * One executable statement of what every provider must do. Each case names,
 * verbatim, the sentence of the root guide it holds a provider to; a case
 * whose sentence does not apply to a provider's way of being observed does not
 * run for it, and every provider declares an answer for every action kind.
 */
export function describeProviderContract(
  factory: ProviderPluginFactory,
  fixtures: ProviderFixtures,
): void {
  const root = providerFixtureRoot(fixtures.providerId);
  const golden = (name: string) => path.join(root, "golden", name);
  const observedByKey = fixtures.observation === PROVIDER_OBSERVATION.KEY;
  const named = (title: string) => `${fixtures.providerId}: ${title}`;

  for (const kind of ADVERTISED_ACTION_KINDS) {
    const declared =
      Number(fixtures.advertised.includes(kind)) + Number(fixtures.unadvertised.includes(kind));
    assert.equal(
      declared,
      1,
      `${fixtures.providerId} must declare exactly one answer for the ${kind} action`,
    );
  }

  async function contractCase(t: TestContext, options: CaseOptions = {}): Promise<ContractCase> {
    const home = await temporaryDirectory(t, `luke-contract-${fixtures.providerId}`);
    let now = fixtures.now;
    let apiKey: string | undefined = CONTRACT_API_KEY;
    await seedHome(root, home, now);
    const api = await recordedApi(root);
    const plugin = await factory({
      home,
      now: () => now,
      minimumRefreshIntervalMs: options.minimumRefreshIntervalMs ?? 0,
      readApiKey: options.readApiKey ?? (async () => apiKey),
      api,
      hookEventsDirectory: options.hookEventsDirectory ?? (() => undefined),
      sql: async (name) =>
        (await fs.readFile(path.join(root, "db", `${name}.sql`), "utf8")).replaceAll(
          "{{home}}",
          home,
        ),
    });
    return {
      plugin,
      home,
      api,
      setApiKey: (replacement) => {
        apiKey = replacement;
      },
      setNow: (replacement) => {
        now = replacement;
      },
    };
  }

  // "Never write provider transcripts or session-state files. Reading them is
  // what Luke is for; writing to them is never."
  test(
    named("an observation pass leaves the provider's own files exactly as it found them"),
    async (t) => {
      const { plugin, home } = await contractCase(t);

      const before = await homeManifest(home);
      await plugin.observe();
      await plugin.observe();

      assert.deepEqual(await homeManifest(home), before);
    },
  );

  // "Product behavior must not require provider MCP, plugins, hooks, wrappers,
  // credentials, or live sessions." A provider observed without a key reaches
  // no network at all; the recorded fake throws for a route the fixture never
  // recorded, so reaching the assertion is already the fixed-set check.
  if (!observedByKey) {
    test(named("an observation pass reaches no network"), async (t) => {
      const { plugin, api } = await contractCase(t);

      await plugin.observe();

      assert.deepEqual(api.requests(), []);
    });
  }

  // "Observation passes stay read-only by construction; where a provider's
  // documented read answers only a POSTed query …, observation sends a read
  // document fixed by the build, and nothing enters that document's text but
  // identifiers the same pass reported, each validated against the shape its
  // provider documents."
  if (observedByKey) {
    test(named("an observation pass issues only the reads the build fixed"), async (t) => {
      const { plugin, api } = await contractCase(t);

      const reported = new Set((await plugin.observe()).map((one) => one.providerSessionId));

      for (const request of api.requests()) {
        if (request.method === "GET") continue;
        assert.equal(request.method, "POST", "a read rode a method the build never fixed");
        const body: JsonValue = JSON.parse(request.body ?? "{}");
        if (!isJsonObject(body)) {
          assert.fail("a POSTed read carried no document at all");
          return;
        }
        const readDocument: JsonObject = body;
        assert.deepEqual(
          Object.keys(readDocument),
          [READ_DOCUMENT_FIELD],
          "a POSTed read carried more than a document",
        );
        const document = String(readDocument[READ_DOCUMENT_FIELD]);
        for (const quoted of document.matchAll(/'([^']*)'/g)) {
          assert.ok(
            reported.has(quoted[1] ?? ""),
            `the read document named ${quoted[1]}, which this pass never reported`,
          );
        }
      }
      await assertGoldenJson(golden("requests.json"), recordedRoutes(api.requests()));
    });
  }

  // "No declaration may advertise a capability the adapter does not already
  // implement under the documented provider endpoint" — and its converse: an
  // action a provider never advertised has no route, so it reaches nothing even
  // when the ask arrives admitted.
  test(named("refuses every action this provider's observation does not advertise"), async (t) => {
    const { plugin, api } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;

    for (const kind of fixtures.unadvertised) {
      const result = await askAction(plugin, kind, fixtures.sessionId);
      assert.equal(
        result.status,
        ACTION_RESULT_STATUS.UNSUPPORTED,
        `the ${kind} action was not refused`,
      );
    }

    assert.equal(api.requests().length, requestsAfterPass);
  });

  // "its target has to be one the roster holds"
  test(named("admits no advertised action aimed at a session no pass reported"), async (t) => {
    const { plugin, api } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;

    for (const kind of fixtures.advertised) {
      const admitted = await decide(
        admissionRequest(plugin, kind, fixtures.absentSessionId, {
          ...advertisementFor(plugin, fixtures, kind),
        }),
        admissionOver(plugin),
      );
      assert.equal(
        admitted.kind,
        undefined,
        `the ${kind} action was admitted for an absent session`,
      );
    }

    assert.equal(api.requests().length, requestsAfterPass);
  });

  if (fixtures.targetedControlId) {
    test(
      named("acts on the target its own observation advertised, never the caller's"),
      async (t) => {
        const { plugin, api } = await contractCase(t);
        await plugin.observe();
        const observation = observationFor(plugin, fixtures.sessionId);
        const targeted = advertisedControls(observation).find(
          (control) => control.id === fixtures.targetedControlId,
        );
        assert.ok(
          targeted?.target,
          "the fixture names a targeted control the roster does not advertise",
        );
        const requestsAfterPass = api.requests().length;

        // Asked the one way an action reaches a provider at all: `dispatchAction`
        // resolves the advertised entry from the plugin's own latest roster,
        // so the caller's rewritten copy never becomes a route.
        await dispatchAction(
          plugin,
          "control",
          admittedForTest({
            providerSessionId: fixtures.sessionId,
            control: { ...targeted, target: "contract-rewritten-target" },
          }),
        );

        const issued = recordedRoutes(api.requests()).slice(requestsAfterPass);
        assert.ok(issued.length > 0, "the control issued no request at all");
        for (const route of issued) {
          assert.ok(
            !route.includes("contract-rewritten-target"),
            `a rewritten target reached the provider: ${route}`,
          );
          assert.ok(
            route.includes(targeted.target ?? ""),
            `the control did not act on its advertised target: ${route}`,
          );
        }
      },
    );
  }

  // "a rejection carries a reason the user can act on, never the message
  // itself" — and no message outside its bound ever becomes a request.
  if (fixtures.advertised.includes(ACTION_KIND.MESSAGE)) {
    test(named("admits no empty or over-long message, and names none of it"), async (t) => {
      const { plugin, api } = await contractCase(t);
      await plugin.observe();
      const requestsAfterPass = api.requests().length;
      const overLong = "l".repeat(maximumSessionMessageLength + 1);

      for (const text of ["", "   ", overLong]) {
        const admitted = await decide(
          admissionRequest(plugin, ACTION_KIND.MESSAGE, fixtures.sessionId, { text }),
          admissionOver(plugin),
        );
        assert.equal(admitted.kind, undefined, "an unbounded message was admitted");
        const reason = "reason" in admitted ? admitted.reason : "";
        assert.ok(!reason.includes(overLong.slice(0, 40)), "the refusal quoted the message");
        assert.ok(reason.length > 0, "the refusal carried no reason to act on");
      }

      assert.equal(api.requests().length, requestsAfterPass);
    });
  }

  // "A provider whose sessions exist only in a cloud service may read a
  // user-supplied API key, but it must observe nothing until the user supplies
  // one and must leave every other provider working without it."
  if (observedByKey) {
    test(named("observes nothing, and asks nothing, without a key"), async (t) => {
      const { plugin, api } = await contractCase(t, { readApiKey: async () => undefined });

      assert.deepEqual(await plugin.observe(), []);
      assert.deepEqual(api.requests(), []);
      for (const kind of fixtures.advertised) {
        await askAction(plugin, kind, fixtures.sessionId);
      }
      assert.deepEqual(api.requests(), []);
    });

    test(named("observes nothing when the credential cannot be read at all"), async (t) => {
      const { plugin, api } = await contractCase(t, {
        readApiKey: async () => {
          throw new Error("settings are unreadable");
        },
      });

      assert.deepEqual(await plugin.observe(), []);
      assert.deepEqual(api.requests(), []);
    });

    test(named("reads again at once under a credential the user just replaced"), async (t) => {
      const contract = await contractCase(t, { minimumRefreshIntervalMs: 60_000 });

      await contract.plugin.observe();
      const requestsAfterFirstPass = contract.api.requests().length;
      contract.setApiKey(REPLACEMENT_API_KEY);
      const observed = await contract.plugin.observe();

      assert.ok(contract.api.requests().length > requestsAfterFirstPass);
      assert.ok(observed.length > 0);
      assert.equal(contract.api.credentials().at(-1), REPLACEMENT_API_KEY);
    });

    test(
      named("keeps what it read through a failure that ran, and drops it when refused"),
      async (t) => {
        const contract = await contractCase(t);

        const observed = await contract.plugin.observe();
        contract.api.fail(HTTP_STATUS.SERVER_ERROR);
        const duringOutage = await contract.plugin.observe();
        contract.api.fail(HTTP_STATUS.UNAUTHORIZED);
        const afterRefusal = await contract.plugin.observe();

        assert.ok(observed.length > 0);
        assert.deepEqual(duringOutage, observed);
        assert.deepEqual(afterRefusal, []);
      },
    );

    test(named("asks nothing again inside its own refresh interval"), async (t) => {
      const contract = await contractCase(t, { minimumRefreshIntervalMs: REFRESH_INTERVAL_MS });

      const first = await contract.plugin.observe();
      const requestsAfterFirstPass = contract.api.requests().length;
      contract.setNow(fixtures.now + REFRESH_INTERVAL_MS / 3);
      const throttled = await contract.plugin.observe();

      assert.deepEqual(throttled, first);
      assert.equal(contract.api.requests().length, requestsAfterFirstPass);
    });
  }

  // "The read performs nothing and answers only for a session whose provider's
  // transcript this build documents reading: a local provider's own file, or
  // a cloud provider's documented messages endpoint (Conductor today), which
  // the read reaches and nothing else does."
  test(named("reads a transcript only where this build documents reading one"), async (t) => {
    const { plugin, api } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;

    const read = await plugin.reads?.transcript?.(
      fixtures.transcript?.sessionId ?? fixtures.sessionId,
    );

    if (fixtures.transcript) {
      assert.equal(read?.status, ACTION_RESULT_STATUS.ACCEPTED);
      const transcript = read && "transcript" in read ? read.transcript : "";
      await assertGoldenText(golden("transcript.txt"), transcript);
    } else {
      assert.ok(
        read === undefined || read.status === ACTION_RESULT_STATUS.UNSUPPORTED,
        "a session whose transcript this build does not read answered with one",
      );
    }
    if (fixtures.transcript?.throughMessagesEndpoint) {
      const routes = recordedRoutes(api.requests().slice(requestsAfterPass));
      assert.ok(routes.length > 0, "the transcript read reached no messages endpoint");
      for (const route of routes) {
        assert.ok(route.includes("/messages"), `a transcript read reached ${route}`);
      }
    } else {
      assert.equal(api.requests().length, requestsAfterPass);
    }
  });

  // "The read renders only what the provider actually wrote down, and a
  // provider whose stored shape this build cannot render faithfully keeps the
  // honest refusal instead."
  if (fixtures.transcript?.unrenderableSessionId) {
    test(named("refuses a stored shape it cannot render, rather than guessing"), async (t) => {
      const { plugin } = await contractCase(t);
      await plugin.observe();

      const read = await plugin.reads?.transcript?.(
        fixtures.transcript?.unrenderableSessionId ?? "",
      );

      assert.equal(read?.status, ACTION_RESULT_STATUS.REJECTED);
    });
  }

  // "a message whose author the stored shape does not name is dropped rather
  // than guessed at… it never rides an observation pass, it can express
  // nothing but a read."
  if (fixtures.conversation) {
    test(named("answers a conversation read with attributed messages alone"), async (t) => {
      const { plugin, api } = await contractCase(t);
      await plugin.observe();
      const passRoutes = recordedRoutes(api.requests());

      const read = await plugin.reads?.conversation?.({
        request: {},
        observation: observationFor(plugin, fixtures.conversation?.sessionId ?? ""),
      });

      assert.ok(read, "the conversation read answered nothing at all");
      assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
      await assertGoldenJson(golden("conversation.json"), read);
      for (const route of passRoutes) {
        assert.ok(
          !route.includes("/messages"),
          `an observation pass read a conversation: ${route}`,
        );
      }
    });

    // "The two cursors are different asks — a scroll up and a poll — so a
    // request naming both is refused rather than guessed at."
    test(named("refuses a conversation read that names both cursors"), async (t) => {
      const { plugin } = await contractCase(t);
      await plugin.observe();

      const read = await plugin.reads?.conversation?.({
        request: { afterMessageId: "message-1", beforeOffset: 20 },
        observation: observationFor(plugin, fixtures.conversation?.sessionId ?? ""),
      });

      assert.equal(read?.status, ACTION_RESULT_STATUS.REJECTED);
    });
  }

  // "everything the hook sharpens still observes from the transcripts alone
  // wherever the hook is absent…"
  if (fixtures.hookSpool) {
    test(
      named("observes the same sessions with no hook, an empty spool, or a foreign token"),
      async (t) => {
        const withoutHook = await contractCase(t);
        const expected = (await withoutHook.plugin.observe()).map((one) => one.providerSessionId);

        for (const spooled of [undefined, "{}", '{"event":"contract-unknown-token"}']) {
          const spool = await temporaryDirectory(t, "luke-contract-spool");
          if (spooled !== undefined) {
            await fs.writeFile(path.join(spool, `${fixtures.sessionId}.json`), spooled);
          }
          const contract = await contractCase(t, { hookEventsDirectory: () => spool });

          const observed = await contract.plugin.observe();

          assert.deepEqual(
            observed.map((one) => one.providerSessionId),
            expected,
            `a spool holding ${spooled ?? "nothing"} changed the set of sessions observed`,
          );
        }
      },
    );
  }

  // "The adapter seam remains the authority for actions." One pass, one roster,
  // and the same roster again when nothing moved.
  test(named("observes exactly the recorded roster, and the same roster twice"), async (t) => {
    const { plugin } = await contractCase(t);

    const observed = await plugin.observe();
    const again = await plugin.observe();

    const normalized = [...observed]
      .map((one) => normalizeSession(plugin.provider, one))
      .sort((first, second) => first.providerSessionId.localeCompare(second.providerSessionId));
    await assertGoldenJson(golden("roster.json"), normalized);
    assert.deepEqual(again, observed);
    assert.deepEqual(plugin.latest(), observed);
  });

  // "lands only in a project its provider reported on the latest observation
  // pass and documents a creation endpoint for; the ask names a reported
  // project, never a repository URL or path of its own."
  test(named("offers exactly the projects its latest pass reported"), async (t) => {
    const { plugin, api } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;

    const projects: readonly WorkspaceProject[] = plugin.projects?.() ?? [];
    await assertGoldenJson(golden("projects.json"), projects);
    // Asked the one way an action reaches a provider at all, so what refuses an
    // unreported project is the same resolution production runs.
    const created = await dispatchAction(
      plugin,
      "createWorkspace",
      admittedForTest({
        providerProjectId: fixtures.absentProjectId,
        task: "This creation must never reach a provider.",
      }),
    );

    assert.notEqual(
      created.status,
      ACTION_RESULT_STATUS.ACCEPTED,
      "a creation landed in a project no pass reported",
    );
    assert.equal(api.requests().length, requestsAfterPass);
  });
}

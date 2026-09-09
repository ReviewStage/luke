import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACT_KIND,
  ACT_RESULT_STATUS,
  type ActInput,
  type AdvertisedActKind,
  type AdvertisedControl,
  advertisedActFor,
  advertisedControls,
  CLI_CONNECTION,
  maximumSessionMessageLength,
  normalizeSession,
  type ProviderActResult,
  type ProviderConversationResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceResult,
  SESSION_STATUS,
  type Session,
  type SessionProviderPlugin,
  type WorkspaceProject,
} from "@sidecar/session";
import {
  type FakeCloudApi,
  type FakeCloudRoute,
  fakeCloudApi,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  recordedRoutes,
  temporaryDirectory,
} from "@sidecar/wire/testing";
import { CLI_FAILURE, CliCommandError, type CliRun } from "../shared/cli-session-adapter.js";

/** How this provider is observed at all, which decides which cases run. */
export const PROVIDER_OBSERVATION = {
  /** A home on disk: no credential, no process, no network. */
  FILES: "files",
  /** A user-supplied API key over HTTP. */
  KEY: "key",
  /** The provider's own binary, under the login it already holds. */
  CLI: "cli",
} as const;

export type ProviderObservation = (typeof PROVIDER_OBSERVATION)[keyof typeof PROVIDER_OBSERVATION];

/** Everything a provider's plugin is built from inside one contract case. */
export interface ProviderFixtureInput {
  /** A temporary directory seeded from `home/`; the provider's home for this case. */
  readonly home: string;
  readonly now: () => number;
  readonly minimumRefreshIntervalMs: number;
  /** Answers `undefined` for the no-key cases, and throws for the unreadable one. */
  readonly readApiKey: () => Promise<string | undefined>;
  /** The fake backing this fixture's `api/` routes, for a key-observed provider. */
  readonly api?: FakeCloudApi;
  /** The fake backing this fixture's `cli/` files, for a CLI-observed provider. */
  readonly run?: CliRun;
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
  /** The session the acts are asked of; it must appear in `golden/roster.json`. */
  readonly sessionId: string;
  /** A session id no pass reports, for the unobserved-target case. */
  readonly absentSessionId: string;
  /** The act kinds the golden roster advertises for `sessionId`. */
  readonly advertised: readonly AdvertisedActKind[];
  /** The act kinds it does not; every one must answer unsupported. */
  readonly unadvertised: readonly AdvertisedActKind[];
  /** Set when this build documents reading this provider's transcript. */
  readonly transcript?: {
    readonly sessionId: string;
    /** An observed session whose stored shape this build renders nothing from. */
    readonly unrenderableSessionId?: string;
  };
  /** Set when this provider documents a conversation read. */
  readonly conversation?: { readonly sessionId: string };
  /** Set for a hooked provider: the tokens its spool may hold. */
  readonly hookSpool?: { readonly events: readonly string[] };
  /** A project id no pass reported, for the creation case. */
  readonly absentProjectId: string;
  /** Set for a CLI-observed provider: the read that answers by exit code alone. */
  readonly cli?: { readonly loginProbeArgv: readonly string[] };
  /**
   * A control the golden roster advertises with a target of its own, for the
   * case that rewrites one. A provider whose controls all act on the session
   * itself names none.
   */
  readonly targetedControlId?: string;
}

/**
 * Every kind an observation can advertise. A provider declares its answer for
 * each, so a kind added to the vocabulary fails every contract until each
 * provider says whether it carries it.
 */
const ADVERTISED_ACT_KINDS = Object.values({
  [ACT_KIND.MESSAGE]: ACT_KIND.MESSAGE,
  [ACT_KIND.CONTROL]: ACT_KIND.CONTROL,
  [ACT_KIND.ADD_AGENT]: ACT_KIND.ADD_AGENT,
  [ACT_KIND.RENAME_SESSION]: ACT_KIND.RENAME_SESSION,
  [ACT_KIND.RENAME_WORKSPACE]: ACT_KIND.RENAME_WORKSPACE,
} as const satisfies Record<AdvertisedActKind, AdvertisedActKind>);

const CONTRACT_API_KEY = "contract-initial-key";
const REPLACEMENT_API_KEY = "contract-replacement-key";
const REFRESH_INTERVAL_MS = 15_000;
/** The one body key a POSTed read document rides under. */
const READ_DOCUMENT_FIELD = "query";
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVER_ERROR = 500;
/** Every file the fixture copies lands here unless `mtimes.json` says otherwise. */
const DEFAULT_FIXTURE_AGE_MS = 60_000;
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

/** Where the recorded provider fixtures live, beside the session vocabulary. */
export function providerFixtureRoot(providerId: string): string {
  return path.join(
    fileURLToPath(import.meta.url),
    "../../../..",
    "session/fixtures/providers",
    providerId,
  );
}

/**
 * Everything the suite records as a golden answer: what a pass observed, what
 * it offered to create in, the routes it issued, and one conversation read.
 */
type GoldenAnswer =
  | readonly Session[]
  | readonly WorkspaceProject[]
  | readonly string[]
  | ProviderConversationResult;

/** The same value with every object's keys in one order, at every depth. */
function sortedValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isJsonObject(value)) return value;
  const record: JsonObject = value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortedValue(record[key] ?? null)]),
  );
}

function sortedJson(value: JsonValue): string {
  return `${JSON.stringify(sortedValue(value), undefined, 2)}\n`;
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, "utf8").catch(() => undefined);
}

/**
 * Compares one answer with the recorded one, or records it. A golden is
 * committed in exactly the shape `sortedJson` writes, so a hand edit reads as
 * drift rather than passing quietly.
 */
async function assertGoldenJson(goldenPath: string, actual: GoldenAnswer): Promise<void> {
  // SAFETY: every member of `GoldenAnswer` is assembled from wire records and
  // bounded scalars, so a round trip through JSON reproduces it exactly.
  const serialized = sortedJson(JSON.parse(JSON.stringify(actual)) as JsonValue);
  if (UPDATE_FIXTURES) {
    await fs.mkdir(path.dirname(goldenPath), { recursive: true });
    await fs.writeFile(goldenPath, serialized);
    return;
  }
  const recorded = await readOptionalFile(goldenPath);
  assert.ok(recorded !== undefined, `no golden recorded at ${goldenPath}`);
  assert.deepEqual(JSON.parse(serialized), JSON.parse(recorded));
  assert.equal(serialized, recorded, `${goldenPath} is not in the canonical golden formatting`);
}

async function assertGoldenText(goldenPath: string, actual: string): Promise<void> {
  const serialized = actual.endsWith("\n") ? actual : `${actual}\n`;
  if (UPDATE_FIXTURES) {
    await fs.mkdir(path.dirname(goldenPath), { recursive: true });
    await fs.writeFile(goldenPath, serialized);
    return;
  }
  const recorded = await readOptionalFile(goldenPath);
  assert.ok(recorded !== undefined, `no golden recorded at ${goldenPath}`);
  assert.equal(serialized, recorded);
}

/** Every file under a seeded home, with what it held and when it was written. */
async function homeManifest(root: string): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const [stats, bytes] = await Promise.all([fs.stat(entryPath), fs.readFile(entryPath)]);
      manifest[path.relative(root, entryPath)] =
        `${stats.size}:${stats.mtimeMs}:${createHash("sha256").update(bytes).digest("hex")}`;
    }
  };
  await walk(root);
  return manifest;
}

async function seedHome(root: string, home: string, now: number): Promise<void> {
  const source = path.join(root, "home");
  const seeded = await fs.stat(source).catch(() => undefined);
  if (!seeded) return;
  await fs.cp(source, home, { recursive: true, dereference: false });
  // Git records no mtimes, and several providers place a session in time by
  // the file's own clock, so every seeded file is dated against the fixture's
  // own instant rather than against whenever the checkout happened.
  const seconds = (now - DEFAULT_FIXTURE_AGE_MS) / 1000;
  for (const relativePath of Object.keys(await homeManifest(home))) {
    await fs.utimes(path.join(home, relativePath), seconds, seconds);
  }
}

interface RecordedApiFile {
  readonly route: string;
  readonly status?: number;
  /**
   * Set for an endpoint the provider documents as paged: the body's `data`
   * holds the whole stored list and the route answers windows of it, so a
   * read that walks a transcript is answered the way the endpoint answers
   * rather than by one recorded page standing in for every offset.
   */
  readonly paged?: true;
  readonly body: JsonValue;
}

const PAGE_QUERY = { AFTER: "after", LIMIT: "limit", OFFSET: "offset" } as const;
const PAGE_FIELD = { DATA: "data", ID: "id" } as const;
const DEFAULT_RECORDED_PAGE_SIZE = 100;

/** One window of a recorded page, answered as the paged endpoints document it. */
function pagedAnswer(stored: readonly JsonValue[], searchParams: URLSearchParams): JsonValue {
  const after = searchParams.get(PAGE_QUERY.AFTER);
  const limit = Number(searchParams.get(PAGE_QUERY.LIMIT) ?? DEFAULT_RECORDED_PAGE_SIZE);
  let offset = Number(searchParams.get(PAGE_QUERY.OFFSET) ?? 0);
  if (after !== null) {
    const index = stored.findIndex(
      (entry) => isJsonObject(entry) && entry[PAGE_FIELD.ID] === after,
    );
    // The real store refuses a cursor it never issued.
    if (index < 0) return { data: [], offset: 0, hasMore: false };
    offset = index + 1;
  }
  const data = stored.slice(offset, offset + limit);
  return { data, offset, hasMore: offset + data.length < stored.length };
}

function routeSlug(route: string): string {
  const [method, pathname] = route.split(" ");
  return `${(method ?? "").toLowerCase()}${(pathname ?? "").replaceAll("/", "-")}`;
}

async function readDirectoryFiles(directory: string): Promise<readonly string[]> {
  return (await fs.readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json"));
}

async function recordedApi(root: string): Promise<FakeCloudApi> {
  const directory = path.join(root, "api");
  const routes: Record<string, FakeCloudRoute> = {};
  for (const name of await readDirectoryFiles(directory)) {
    // SAFETY: every file under a fixture's `api/` is recorded by hand in this
    // shape, and the route assertion below is what proves the file is one.
    const file = JSON.parse(
      await fs.readFile(path.join(directory, name), "utf8"),
    ) as RecordedApiFile;
    assert.equal(
      `${routeSlug(file.route)}.json`,
      name,
      `${name} records the route ${file.route}, which slugs to another name`,
    );
    const recorded: JsonValue = file.body;
    const held = isJsonObject(recorded) ? recorded[PAGE_FIELD.DATA] : undefined;
    const stored = file.paged === true && Array.isArray(held) ? held : undefined;
    routes[file.route] = {
      answer: stored ? (request) => pagedAnswer(stored, request.searchParams) : () => file.body,
      ...(file.status === undefined ? undefined : { status: file.status }),
    };
  }
  return fakeCloudApi(routes);
}

/** The argv a recorded CLI answer is filed under: its words before the first flag. */
function invocationSlug(argv: readonly string[]): string {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  return words.join("-");
}

const SHELL_METACHARACTERS = /[;&|`$><\n(){}]/;

interface RecordedCli {
  readonly run: CliRun;
  invocations(): readonly (readonly string[])[];
  /** Answer the login probe with a refusal, the way a signed-out CLI does. */
  signOut(): void;
  /** Answer as a machine where the binary is not installed at all. */
  uninstall(): void;
  /** Answer every read with a failure that ran, the way a flaky command does. */
  fail(): void;
  heal(): void;
}

async function recordedCli(root: string, loginProbeSlug: string): Promise<RecordedCli> {
  const directory = path.join(root, "cli");
  const answers = new Map<string, string>();
  for (const name of await readDirectoryFiles(directory)) {
    answers.set(
      name.slice(0, -".json".length),
      await fs.readFile(path.join(directory, name), "utf8"),
    );
  }
  const invocations: (readonly string[])[] = [];
  let signedOut = false;
  let uninstalled = false;
  let failing = false;
  return {
    run: async (_binary, argv) => {
      invocations.push(argv);
      if (uninstalled) throw new CliCommandError(CLI_FAILURE.UNAVAILABLE, "no binary");
      const slug = invocationSlug(argv);
      if (slug === loginProbeSlug) return { exitCode: signedOut ? 1 : 0, stdout: "" };
      if (failing) return { exitCode: 1, stdout: "" };
      const stdout = answers.get(slug);
      if (stdout === undefined) {
        throw new Error(`the fixture records no CLI answer for ${slug} (${argv.join(" ")})`);
      }
      return { exitCode: 0, stdout };
    },
    invocations: () => invocations,
    signOut: () => {
      signedOut = true;
    },
    uninstall: () => {
      uninstalled = true;
    },
    fail: () => {
      failing = true;
    },
    heal: () => {
      failing = false;
    },
  };
}

/** A run no case has wired, so a provider that reached for one fails loudly. */
const forbiddenRun: CliRun = async (binary, argv) => {
  throw new Error(`observation spawned ${binary} ${argv.join(" ")}`);
};

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

const UNSUPPORTED: ProviderActResult = {
  status: ACT_RESULT_STATUS.UNSUPPORTED,
  reason: "This provider names no such act.",
};

/**
 * Asks one act of a plugin the way its dispatcher will: the target's own
 * observation when the roster holds one, and the bare identity when it does
 * not — so the refusal for an unobserved session is the provider's own and
 * never this suite's.
 */
async function askAct(
  plugin: SessionProviderPlugin,
  kind: AdvertisedActKind,
  providerSessionId: string,
  overrides: ActOverrides = {},
): Promise<ProviderActResult | ProviderWorkspaceResult> {
  const observation = observationFor(plugin, providerSessionId);
  const input = <Request>(request: Request): ActInput<Request> => ({ request, observation });
  switch (kind) {
    case ACT_KIND.MESSAGE:
      return (
        (await plugin.acts?.message?.(
          input({ text: overrides.text ?? UNSUPPORTED_MESSAGE_TEXT }),
        )) ?? UNSUPPORTED
      );
    case ACT_KIND.CONTROL: {
      const control = overrides.control ?? {
        kind: ACT_KIND.CONTROL,
        id: "contract-unadvertised-control",
        label: "Never advertised",
      };
      return (await plugin.acts?.control?.(input({ control }))) ?? UNSUPPORTED;
    }
    case ACT_KIND.ADD_AGENT:
      return (
        (await plugin.acts?.spawnAgent?.(
          input({ agent: overrides.agent ?? "contract-unadvertised-agent" }),
        )) ?? UNSUPPORTED
      );
    case ACT_KIND.RENAME_SESSION:
      return (await plugin.acts?.renameSession?.(input({ name: "contract" }))) ?? UNSUPPORTED;
    case ACT_KIND.RENAME_WORKSPACE:
      return (await plugin.acts?.renameWorkspace?.(input({ name: "contract" }))) ?? UNSUPPORTED;
  }
}

/** What an act's request carries from the observation's own advertisement. */
interface ActOverrides {
  control?: AdvertisedControl;
  text?: string;
  agent?: string;
}

/** The advertisement one act kind stands on for the fixture's own session. */
function advertisementFor(
  plugin: SessionProviderPlugin,
  fixtures: ProviderFixtures,
  kind: AdvertisedActKind,
): ActOverrides {
  const observation = observationFor(plugin, fixtures.sessionId);
  if (kind === ACT_KIND.CONTROL) {
    const control = advertisedControls(observation)[0];
    return control ? { control } : {};
  }
  if (kind === ACT_KIND.ADD_AGENT) {
    const agent = advertisedActFor(observation, ACT_KIND.ADD_AGENT)?.agents[0];
    return agent ? { agent } : {};
  }
  return {};
}

interface ContractCase {
  readonly plugin: SessionProviderPlugin;
  readonly home: string;
  readonly api: FakeCloudApi;
  readonly cli: RecordedCli;
  readonly setApiKey: (apiKey: string | undefined) => void;
  readonly setNow: (now: number) => void;
}

interface CaseOptions {
  readonly readApiKey?: () => Promise<string | undefined>;
  readonly minimumRefreshIntervalMs?: number;
  readonly hookEventsDirectory?: () => string | undefined;
  /** A CLI-observed provider's login probe, so the fake answers it by exit code alone. */
  readonly loginProbeSlug?: string;
}

/**
 * One executable statement of what every provider must do. Each case names,
 * verbatim, the sentence of the root guide it holds a provider to; a case
 * whose sentence does not apply to a provider's way of being observed does not
 * run for it, and every provider declares an answer for every act kind.
 */
export function describeProviderContract(
  factory: ProviderPluginFactory,
  fixtures: ProviderFixtures,
): void {
  const root = providerFixtureRoot(fixtures.providerId);
  const golden = (name: string) => path.join(root, "golden", name);
  const observedByKey = fixtures.observation === PROVIDER_OBSERVATION.KEY;
  const observedByCli = fixtures.observation === PROVIDER_OBSERVATION.CLI;
  const named = (title: string) => `${fixtures.providerId}: ${title}`;

  for (const kind of ADVERTISED_ACT_KINDS) {
    const declared =
      Number(fixtures.advertised.includes(kind)) + Number(fixtures.unadvertised.includes(kind));
    assert.equal(
      declared,
      1,
      `${fixtures.providerId} must declare exactly one answer for the ${kind} act`,
    );
  }

  async function contractCase(t: TestContext, options: CaseOptions = {}): Promise<ContractCase> {
    const home = await temporaryDirectory(t, `luke-contract-${fixtures.providerId}`);
    let now = fixtures.now;
    let apiKey: string | undefined = CONTRACT_API_KEY;
    await seedHome(root, home, now);
    const api = await recordedApi(root);
    const cli = await recordedCli(root, invocationSlug(fixtures.cli?.loginProbeArgv ?? []));
    const plugin = await factory({
      home,
      now: () => now,
      minimumRefreshIntervalMs: options.minimumRefreshIntervalMs ?? 0,
      readApiKey: options.readApiKey ?? (async () => apiKey),
      ...(observedByKey ? { api } : undefined),
      ...(observedByCli ? { run: cli.run } : { run: forbiddenRun }),
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
      cli,
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

  // "No shell stands between Luke and the binary, nothing enters an
  // invocation's arguments beyond values the build fixed (or, for a paged
  // read, the bounded page cursor the same read's previous page handed back,
  // as a single token)…"
  test(named("an observation pass runs no invocation the build did not fix"), async (t) => {
    const { plugin, cli, api } = await contractCase(t);

    await plugin.observe();

    // The recorded fakes throw for an invocation or a route the fixture never
    // recorded, so reaching this point is already the fixed-set assertion.
    for (const argv of cli.invocations()) {
      for (const argument of argv) {
        assert.ok(
          !SHELL_METACHARACTERS.test(argument),
          `an invocation argument carried a shell metacharacter: ${argument}`,
        );
      }
    }
    if (!observedByKey) assert.deepEqual(api.requests(), []);
    if (!observedByCli) assert.deepEqual(cli.invocations(), []);
  });

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

  // "The one thing Luke may change about a session is what the user just asked
  // to send it … each validated against the observed roster, and against that
  // session's own advertisement of the acts its provider documents for it now,
  // before an adapter sees it."
  test(named("refuses every act this provider's observation does not advertise"), async (t) => {
    const { plugin, api, cli } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;
    const invocationsAfterPass = cli.invocations().length;

    for (const kind of fixtures.unadvertised) {
      const result = await askAct(plugin, kind, fixtures.sessionId);
      assert.equal(result.status, ACT_RESULT_STATUS.UNSUPPORTED, `the ${kind} act was not refused`);
    }

    assert.equal(api.requests().length, requestsAfterPass);
    assert.equal(cli.invocations().length, invocationsAfterPass);
  });

  test(named("refuses an advertised act asked of a session no pass reported"), async (t) => {
    const { plugin, api, cli } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;
    const invocationsAfterPass = cli.invocations().length;

    for (const kind of fixtures.advertised) {
      const result = await askAct(plugin, kind, fixtures.absentSessionId, {
        ...advertisementFor(plugin, fixtures, kind),
      });
      assert.equal(
        result.status,
        ACT_RESULT_STATUS.UNSUPPORTED,
        `the ${kind} act reached an unobserved session`,
      );
    }

    assert.equal(api.requests().length, requestsAfterPass);
    assert.equal(cli.invocations().length, invocationsAfterPass);
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

        await plugin.acts?.control?.({
          request: { control: { ...targeted, target: "contract-rewritten-target" } },
          observation,
        });

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
  if (fixtures.advertised.includes(ACT_KIND.MESSAGE)) {
    test(named("refuses an empty or over-long message without naming it"), async (t) => {
      const { plugin, api } = await contractCase(t);
      await plugin.observe();
      const requestsAfterPass = api.requests().length;
      const overLong = "l".repeat(maximumSessionMessageLength + 1);

      for (const text of ["", "   ", overLong]) {
        const result = await askAct(plugin, ACT_KIND.MESSAGE, fixtures.sessionId, { text });
        assert.equal(result.status, ACT_RESULT_STATUS.REJECTED);
        const reason = "reason" in result ? result.reason : "";
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
        await askAct(plugin, kind, fixtures.sessionId);
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
        contract.api.fail(HTTP_SERVER_ERROR);
        const duringOutage = await contract.plugin.observe();
        contract.api.fail(HTTP_UNAUTHORIZED);
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

  // "a machine whose CLI is absent or signed out is observed as having
  // nothing, the same answer a key-observed provider gives with no key…
  // signing the CLI out withdraws it on the next pass."
  if (observedByCli) {
    test(named("observes nothing on a machine whose CLI is signed out"), async (t) => {
      const contract = await contractCase(t);

      const observed = await contract.plugin.observe();
      contract.cli.signOut();
      contract.setNow(fixtures.now + REFRESH_INTERVAL_MS * 2);
      const afterSignOut = await contract.plugin.observe();
      const invocationsAfterSignOut = contract.cli.invocations().length;

      assert.ok(observed.length > 0);
      assert.deepEqual(afterSignOut, []);
      assert.equal(contract.plugin.connection?.(), CLI_CONNECTION.SIGNED_OUT);
      assert.deepEqual(
        contract.cli
          .invocations()
          .slice(invocationsAfterSignOut - 1)
          .flat(),
        [...(fixtures.cli?.loginProbeArgv ?? [])],
        "the list read ran under a login that no longer stands",
      );
    });

    test(named("observes nothing on a machine with no CLI at all"), async (t) => {
      const contract = await contractCase(t);
      contract.cli.uninstall();

      assert.deepEqual(await contract.plugin.observe(), []);
      assert.equal(contract.plugin.connection?.(), CLI_CONNECTION.CLI_MISSING);
    });

    test(named("keeps what it read through a command that ran and failed"), async (t) => {
      const contract = await contractCase(t);

      const observed = await contract.plugin.observe();
      contract.cli.fail();
      contract.setNow(fixtures.now + REFRESH_INTERVAL_MS * 2);
      const duringOutage = await contract.plugin.observe();

      assert.ok(observed.length > 0);
      assert.deepEqual(duringOutage, observed);
    });

    test(named("runs nothing again inside its own refresh interval"), async (t) => {
      const contract = await contractCase(t, { minimumRefreshIntervalMs: REFRESH_INTERVAL_MS });

      const first = await contract.plugin.observe();
      const invocationsAfterFirstPass = contract.cli.invocations().length;
      contract.setNow(fixtures.now + REFRESH_INTERVAL_MS / 3);
      const throttled = await contract.plugin.observe();

      assert.deepEqual(throttled, first);
      assert.equal(contract.cli.invocations().length, invocationsAfterFirstPass);
    });
  }

  // "The read performs nothing, reaches no provider, and answers only for a
  // local session whose provider's transcript this build documents reading …;
  // a cloud session's conversation lives with its provider and is never
  // fetched."
  test(named("reads a transcript only where this build documents reading one"), async (t) => {
    const { plugin, api, cli } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;
    const invocationsAfterPass = cli.invocations().length;

    const read = await plugin.reads?.transcript?.(
      fixtures.transcript?.sessionId ?? fixtures.sessionId,
    );

    if (fixtures.transcript) {
      assert.equal(read?.status, ACT_RESULT_STATUS.ACCEPTED);
      const transcript = read && "transcript" in read ? read.transcript : "";
      await assertGoldenText(golden("transcript.txt"), transcript);
    } else {
      assert.ok(
        read === undefined || read.status === ACT_RESULT_STATUS.UNSUPPORTED,
        "a session whose transcript this build does not read answered with one",
      );
    }
    assert.equal(api.requests().length, requestsAfterPass);
    assert.equal(cli.invocations().length, invocationsAfterPass);
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

      assert.equal(read?.status, ACT_RESULT_STATUS.REJECTED);
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
      assert.equal(read.status, ACT_RESULT_STATUS.ACCEPTED);
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

      assert.equal(read?.status, ACT_RESULT_STATUS.REJECTED);
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

  // "The adapter seam remains the authority for acts." One pass, one roster,
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
    const { plugin, api, cli } = await contractCase(t);
    await plugin.observe();
    const requestsAfterPass = api.requests().length;
    const invocationsAfterPass = cli.invocations().length;

    const projects: readonly WorkspaceProject[] = plugin.projects?.() ?? [];
    await assertGoldenJson(golden("projects.json"), projects);
    const created = await plugin.acts?.createWorkspace?.({
      project: {
        providerProjectId: fixtures.absentProjectId,
        repository: "unreported",
        taskSupport: "optional",
      },
      task: "This creation must never reach a provider.",
    });

    assert.ok(
      created === undefined || created.status !== ACT_RESULT_STATUS.ACCEPTED,
      "a creation landed in a project no pass reported",
    );
    assert.equal(api.requests().length, requestsAfterPass);
    assert.equal(cli.invocations().length, invocationsAfterPass);
  });
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderConversationResult, Session, WorkspaceProject } from "@sidecar/session";
import {
  type FakeCloudApi,
  type FakeCloudRoute,
  fakeCloudApi,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "@sidecar/wire/testing";
import { ADAPTER_FAILURE, AdapterFailure } from "../shared/adapter-failure.js";
import type { CliRun } from "../shared/cli-session-adapter.js";

/**
 * What a recorded provider fixture is, and how one is read back: the home a
 * case is seeded from, the routes and CLI answers it stands behind, and the
 * golden answers it is measured against. What a provider must *do* with them
 * is `provider-contract.ts`; nothing here knows a trust constraint.
 */

/** Every file the fixture copies is dated this far behind the fixture's own instant. */
const DEFAULT_FIXTURE_AGE_MS = 60_000;

/** Records the answers instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

/** Where the recorded provider fixtures live, beside the session vocabulary. */
export function providerFixtureRoot(providerId: string): string {
  // Four levels up from this module reaches `packages/`, where the recorded
  // fixtures sit beside the session vocabulary rather than inside this package:
  // Superset's own contract test reads the same tree.
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
export function sortedValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isJsonObject(value)) return value;
  const record: JsonObject = value;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortedValue(record[key] ?? null)]),
  );
}

export function sortedJson(value: JsonValue): string {
  return `${JSON.stringify(sortedValue(value), undefined, 2)}\n`;
}

export async function readOptionalFile(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, "utf8").catch(() => undefined);
}

/**
 * Compares one answer with the recorded one, or records it. A golden is
 * committed in exactly the shape `sortedJson` writes, so a hand edit reads as
 * drift rather than passing quietly.
 */
export async function assertGoldenJson(goldenPath: string, actual: GoldenAnswer): Promise<void> {
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

export async function assertGoldenText(goldenPath: string, actual: string): Promise<void> {
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
export async function homeManifest(root: string): Promise<Record<string, string>> {
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

export async function seedHome(root: string, home: string, now: number): Promise<void> {
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
export function pagedAnswer(
  stored: readonly JsonValue[],
  searchParams: URLSearchParams,
): JsonValue {
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

export function routeSlug(route: string): string {
  const [method, pathname] = route.split(" ");
  return `${(method ?? "").toLowerCase()}${(pathname ?? "").replaceAll("/", "-")}`;
}

export async function readDirectoryFiles(directory: string): Promise<readonly string[]> {
  return (await fs.readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json"));
}

export async function recordedApi(root: string): Promise<FakeCloudApi> {
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
export function invocationSlug(argv: readonly string[]): string {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  return words.join("-");
}

export const SHELL_METACHARACTERS = /[;&|`$><\n(){}]/;

export interface RecordedCli {
  readonly run: CliRun;
  invocations(): readonly (readonly string[])[];
  /** Answer the login probe with a refusal, the way a signed-out CLI does. */
  signOut(): void;
  /** Answer as a machine where the binary is not installed at all. */
  uninstall(): void;
  /** Answer every read with a failure that ran, the way a flaky command does. */
  fail(): void;
}

export async function recordedCli(
  root: string,
  loginProbeSlug: string | undefined,
): Promise<RecordedCli> {
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
      if (uninstalled) throw new AdapterFailure(ADAPTER_FAILURE.UNAVAILABLE, "no binary");
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
  };
}

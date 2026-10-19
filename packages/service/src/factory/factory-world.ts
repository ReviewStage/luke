/**
 * factory-world.ts -- one workspace's Factory world, composed live from its repository on GitHub, its coding agents' stored pull requests, and its Linear.
 *
 * The world is read whole on each ask and stored nowhere. Its repository is
 * the one most of the workspace's agents the read names work in, ties to
 * the one whose agent moved last; a workspace with none, or whose agents'
 * repository its installations no longer reach, draws the repository its
 * installations reach that GitHub saw change last; one that reaches none has
 * no world.
 *
 * - Zones are the repository's default branch, listed in one recursive tree
 *   read, as far as GitHub lists it (it cuts one past a hundred thousand
 *   entries or seven megabytes) and at most `MAX_TREE_ENTRIES` of it: each
 *   file counted, with its bytes, in the directory a pull request's area
 *   would name (`areaPathOf`), so an area always names the zone it landed
 *   in. The largest zones by bytes are kept. A kept zone's
 *   own `package.json` names it and the zones it depends on among the
 *   repository's own packages; every zone also depends on the nearest kept
 *   zone it sits inside, which is the whole of its edges where there is no
 *   manifest.
 * - Agents are the workspace's agents on that repository standing, and the
 *   archived ones whose pull request is still open, read as the sidebar
 *   reads them (`coder-host/status.ts`), their pull request as GitHub last
 *   answered the service (`coder-host/published.ts`).
 * - Shipped is those agents' pull requests, the archived ones' among them,
 *   merged within the lookback.
 * - Planned is the Linear issues the workspace's grant reaches that are still
 *   to do, the most pressing of Linear's widest page, each placed on the
 *   zones its plan's agents' pull requests touched; with no grant, or a
 *   Linear that did not answer, none.
 * - Defects is a slot nothing fills yet.
 *
 * GitHub is asked for a repository token, the tree, and at most
 * `FACTORY_WORLD_READ.MAX_MANIFESTS` manifests, and nothing per pull request,
 * since the agents' rows already keep what the world draws of each.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  awaitingLinesOfReached,
  latestTurnsOfReached,
  listWorldCodingAgents,
  type WorldCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { readAccountNames } from "@luke/database/models/workspace-store";
import type { StoredPullRequest } from "@luke/database/schemas/coding-agent";
import {
  CODING_AGENT_STATUS,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  FACTORY_WORLD_BOUNDS,
  type FactoryAgent,
  type FactoryPlanned,
  type FactoryPullRequest,
  type FactoryRepository,
  type FactoryShipped,
  type FactoryWorld,
  type FactoryZone,
  LINEAR_PRIORITY,
  type LinearPriority,
} from "@luke/features/factory-world-wire";
import { AREA_PATH, areaPathOf } from "@luke/features/pull-request-area";
import { Clock, Duration, Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { codingAgentActivityAt, codingAgentStatusOf } from "../agents/coder-host/status.js";
import {
  GitHubApp,
  type GitHubUnavailable,
  type GitHubWorkspaceReadFailure,
} from "../github/github-app.js";
import { readRepositoryFile } from "../github/repository-file.js";
import { GIT_ENTRY, readRepositoryFolder } from "../github/repository-folder.js";
import type { StoreFailure } from "../http/store-failure.js";
import type { WorkspaceLinearConnect } from "../integrations/integration-connect.js";
import {
  LinearReadFailure,
  plannedLinearIssues,
  throughWorkspaceLinear,
} from "../integrations/linear-issues.js";

/** How much one world read reads. */
const FACTORY_WORLD_READ = {
  /** How far back the shipped pull requests reach. */
  SHIPPED_LOOKBACK: Duration.days(7),
  /** The most agent rows one read takes from the store, newest started first. */
  MAX_AGENT_ROWS: 500,
  /** The most tree entries counted into zones; a repository with more is counted to here. */
  MAX_TREE_ENTRIES: 50_000,
  /** The most `package.json` files read for the zones' dependencies, the shallowest first. */
  MAX_MANIFESTS: 40,
  /** How many manifests are read at once. */
  MANIFEST_CONCURRENCY: 8,
  /**
   * The most Linear issues read to rank, Linear's largest page: Linear orders
   * a page by when an issue changed, never by priority, so the most pressing
   * are chosen from a page this wide rather than from the newest few alone.
   */
  MAX_LINEAR_ISSUES: 250,
} as const;

/** The file a zone's package is declared in. */
const MANIFEST_NAME = "package.json";

/** The dependency lists of a manifest that name another package a zone may be. */
const ManifestSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

type Manifest = typeof ManifestSchema.Type;

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(ManifestSchema));

/** The statuses under which an agent is at work, which the world names first. */
const WORKING_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** The pull request states under which it is still to merge or close. */
const OPEN_STATES: ReadonlySet<string> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/** Linear's priorities, the most pressing first and none set last. */
const PRIORITY_RANK = {
  [LINEAR_PRIORITY.URGENT]: 0,
  [LINEAR_PRIORITY.HIGH]: 1,
  [LINEAR_PRIORITY.MEDIUM]: 2,
  [LINEAR_PRIORITY.LOW]: 3,
  [LINEAR_PRIORITY.NONE]: 4,
} as const satisfies Record<LinearPriority, number>;

/** One tree entry as the zones count it: a file's path from the root and its bytes. */
interface TreeFile {
  readonly path: string;
  readonly bytes: number;
}

/** One zone as the tree counts it, before its edges are known. */
interface ZoneTally {
  readonly path: string;
  files: number;
  bytes: number;
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? AREA_PATH.ROOT : path.slice(0, cut);
}

/** How many directories deep a zone's path is, the root none. */
function depthOf(path: string): number {
  return path === AREA_PATH.ROOT ? 0 : path.split("/").length;
}

/** True where `path` sits somewhere inside `ancestor`, the root holding every other path. */
function isInside(path: string, ancestor: string): boolean {
  if (path === ancestor) return false;
  if (ancestor === AREA_PATH.ROOT) return true;
  return path.startsWith(ancestor) && path.charAt(ancestor.length) === "/";
}

/** The zone a path lands in among those kept: the zone at it, else the deepest it sits inside; none where it is no directory or lands in none. */
function zoneHolding(kept: readonly string[]): (path: string) => string | undefined {
  const deepestFirst = [...kept].sort(
    (left, right) => depthOf(right) - depthOf(left) || byText(left, right),
  );
  return (path) => {
    if (path === AREA_PATH.REST) return undefined;
    return deepestFirst.find((zone) => zone === path || isInside(path, zone));
  };
}

/** The deepest of the paths that `path` sits inside; none where it sits inside none. */
function containerOf(path: string, paths: readonly string[]): string | undefined {
  const holders = paths.filter((holder) => isInside(path, holder));
  return holders.sort((left, right) => depthOf(right) - depthOf(left))[0];
}

/** Every file's bytes counted into the zone it lands in, the largest zones first and at most the bound. */
function tallyZones(files: readonly TreeFile[]): ZoneTally[] {
  const byPath = new Map<string, ZoneTally>();
  for (const file of files) {
    const path = areaPathOf(file.path);
    const tally = byPath.get(path) ?? { path, files: 0, bytes: 0 };
    tally.files += 1;
    tally.bytes += file.bytes;
    byPath.set(path, tally);
  }
  return [...byPath.values()]
    .sort((left, right) => right.bytes - left.bytes || byText(left.path, right.path))
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_ZONES);
}

/**
 * The manifests worth reading: a kept zone's own `package.json`, one sitting
 * in the zone's directory itself rather than deeper inside it, the
 * shallowest first and at most the bound.
 */
function manifestPathsOf(files: readonly TreeFile[], zones: readonly ZoneTally[]): string[] {
  const kept = new Set(zones.map((zone) => zone.path));
  return files
    .map((file) => file.path)
    .filter((path) => path.split("/").pop() === MANIFEST_NAME)
    .filter((path) => kept.has(directoryOf(path)) && areaPathOf(path) === directoryOf(path))
    .sort((left, right) => depthOf(left) - depthOf(right) || byText(left, right))
    .slice(0, FACTORY_WORLD_READ.MAX_MANIFESTS);
}

/** Every package a manifest depends on, by name, from each of its lists. */
function dependencyNamesOf(manifest: Manifest): string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].flatMap((list) => (list === undefined ? [] : Object.keys(list)));
}

/**
 * The kept zones with their names and edges: a zone's package name where its
 * manifest gives one, else its directory's own name, the root the
 * repository's; and the zones it depends on, those its manifest names among
 * the zones' packages and the nearest zone it sits inside.
 */
function zonesOf(
  tallies: readonly ZoneTally[],
  manifests: ReadonlyMap<string, Manifest>,
  repository: FactoryRepository,
): FactoryZone[] {
  const paths = tallies.map((tally) => tally.path);
  const zoneOfPackage = new Map<string, string>();
  for (const [path, manifest] of manifests) {
    if (manifest.name !== undefined) zoneOfPackage.set(manifest.name, path);
  }
  return tallies.map((tally) => {
    const manifest = manifests.get(tally.path);
    const container = containerOf(tally.path, paths);
    const named = manifest === undefined ? [] : dependencyNamesOf(manifest);
    const dependsOn = new Set(named.flatMap((name) => zoneOfPackage.get(name) ?? []));
    if (container !== undefined) dependsOn.add(container);
    dependsOn.delete(tally.path);
    const ownName =
      tally.path === AREA_PATH.ROOT ? repository.fullName : tally.path.split("/").pop();
    return {
      path: tally.path,
      label: manifest?.name ?? ownName ?? tally.path,
      files: tally.files,
      bytes: tally.bytes,
      dependsOn: [...dependsOn].sort(byText),
    };
  });
}

/** A manifest read on the default branch, or none where it is not one: absent, unreadable, or GitHub did not answer. */
function readManifest(
  token: Redacted.Redacted,
  repository: FactoryRepository,
  path: string,
): Effect.Effect<Option.Option<Manifest>, never, HttpClient.HttpClient> {
  return readRepositoryFile(token, repository, repository.defaultBranch, path).pipe(
    Effect.map((file) => {
      if (!file.regular || file.content === undefined) return Option.none();
      return decodeManifest(new TextDecoder().decode(file.content));
    }),
    Effect.catchTag("GitHubUnavailable", (failure: GitHubUnavailable) =>
      Effect.as(Effect.logWarning("A world's manifest read failed", failure.reason), Option.none()),
    ),
  );
}

/** The repository's zones on its default branch: one tree read, and its kept zones' manifests. */
const readZones = Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  repository: FactoryRepository,
) {
  const tree = yield* readRepositoryFolder(token, repository, "", true);
  if (!tree.found) return [];
  // Note that a tree GitHub cut short is drawn as far as it listed, as a tree past our own bound is.
  if (tree.truncated) yield* Effect.logWarning("A world's tree was listed only in part");
  const files = tree.entries
    .slice(0, FACTORY_WORLD_READ.MAX_TREE_ENTRIES)
    .flatMap((entry) =>
      entry.type === GIT_ENTRY.BLOB ? [{ path: entry.name, bytes: entry.size ?? 0 }] : [],
    );
  const tallies = tallyZones(files);
  const manifestPaths = manifestPathsOf(files, tallies);
  const read = yield* Effect.forEach(
    manifestPaths,
    (path) =>
      Effect.map(readManifest(token, repository, path), (manifest) => [path, manifest] as const),
    { concurrency: FACTORY_WORLD_READ.MANIFEST_CONCURRENCY },
  );
  const manifests = new Map<string, Manifest>();
  for (const [path, manifest] of read) {
    if (Option.isSome(manifest)) manifests.set(directoryOf(path), manifest.value);
  }
  return zonesOf(tallies, manifests, repository);
});

/** One agent as the world reads it, with what orders and filters it. */
interface ReadAgent {
  readonly held: WorldCodingAgent;
  readonly line: FactoryAgent;
  readonly working: boolean;
}

/** The pull request a row keeps, as the world draws it: the wire's fields and its areas, none where it kept none. */
function pullRequestOf(published: StoredPullRequest): FactoryPullRequest {
  const { headSha: _headSha, mergedAt: _mergedAt, areas, ...pullRequest } = published;
  return { ...pullRequest, areas: areas ?? [] };
}

/** The repository most of the agents work in, ties to the one whose agent moved last; none for no agent. */
function busiestRepository(agents: readonly ReadAgent[]): string | undefined {
  const tally = new Map<string, { name: string; count: number; latest: number }>();
  for (const { held, line } of agents) {
    const key = held.agent.repository.toLowerCase();
    const standing = tally.get(key) ?? { name: held.agent.repository, count: 0, latest: 0 };
    tally.set(key, {
      name: standing.name,
      count: standing.count + 1,
      latest: Math.max(standing.latest, line.activityAt),
    });
  }
  const [busiest] = [...tally.values()].sort(
    (left, right) => right.count - left.count || right.latest - left.latest,
  );
  return busiest?.name;
}

/** The workspace's agents read as their pages read them, at `now`. */
const readAgents = Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  mergedSince: number,
  now: number,
) {
  const rows = yield* listWorldCodingAgents(userId, organizationId, {
    mergedSince,
    limit: FACTORY_WORLD_READ.MAX_AGENT_ROWS,
  });
  const conversationIds = rows.map(({ agent }) => agent.conversationId);
  // The agents were read through their workspace's gate, and each conversation is its starter's.
  const turns = yield* latestTurnsOfReached(conversationIds);
  const awaiting = yield* awaitingLinesOfReached(conversationIds);
  const names = yield* readAccountNames(rows.map(({ agent }) => agent.userId));
  return rows.map((held): ReadAgent => {
    const { agent, published } = held;
    const turn = turns.get(agent.conversationId);
    const standing = {
      createdAt: agent.createdAt,
      now,
      awaitingLineAt: awaiting.get(agent.conversationId),
    };
    const status = codingAgentStatusOf(turn, standing);
    const starter = names.get(agent.userId);
    return {
      held,
      working: WORKING_STATUSES.has(status),
      line: {
        id: agent.id,
        title: agent.title,
        status,
        ...(starter === undefined
          ? undefined
          : { startedBy: { userId: agent.userId, name: starter } }),
        taskId: agent.taskId,
        activityAt: codingAgentActivityAt(turn, agent),
        pullRequest: published === null ? null : pullRequestOf(published),
      },
    };
  });
});

/** The agents the world names: those standing and those whose pull request is still open, at work first, then the latest to move. */
function agentsOf(agents: readonly ReadAgent[]): FactoryAgent[] {
  return agents
    .filter(
      ({ held }) =>
        held.agent.archivedAt === null ||
        (held.published !== null && OPEN_STATES.has(held.published.state)),
    )
    .sort(
      (left, right) =>
        Number(right.working) - Number(left.working) ||
        right.line.activityAt - left.line.activityAt,
    )
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_AGENTS)
    .map(({ line }) => line);
}

/** The pull requests merged since the window opened, each once by its page, the newest merged first. */
function shippedOf(agents: readonly ReadAgent[], since: number): FactoryShipped[] {
  const byUrl = new Map<string, FactoryShipped>();
  for (const { held } of agents) {
    const { agent, published } = held;
    if (published?.mergedAt === undefined || published.mergedAt < since) continue;
    if (byUrl.has(published.url)) continue;
    byUrl.set(published.url, {
      number: published.number,
      title: published.title,
      url: published.url,
      mergedAt: published.mergedAt,
      additions: published.additions,
      deletions: published.deletions,
      areas: published.areas ?? [],
      agentId: agent.id,
      ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
    });
  }
  return [...byUrl.values()]
    .sort((left, right) => right.mergedAt - left.mergedAt)
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_SHIPPED);
}

/**
 * The workspace's Linear issues still to do, the most pressing first, each
 * placed on the zones its plan's agents' pull requests touched; none where
 * the workspace has no Linear, or Linear did not answer.
 */
const readPlanned = Effect.fnUntraced(function* (
  organizationId: string,
  agents: readonly ReadAgent[],
  zones: readonly FactoryZone[],
) {
  const issues = yield* throughWorkspaceLinear(organizationId, (token) =>
    plannedLinearIssues(token, FACTORY_WORLD_READ.MAX_LINEAR_ISSUES),
  ).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          "A world's Linear read answered none",
          failure instanceof LinearReadFailure ? failure.reason : "store",
        ),
        [],
      ),
    ),
  );
  const holding = zoneHolding(zones.map((zone) => zone.path));
  const areasOfIssue = new Map<string, string[]>();
  for (const { held } of agents) {
    if (held.linearIssue === null) continue;
    const paths = (held.published?.areas ?? []).map((area) => area.path);
    areasOfIssue.set(held.linearIssue, [...(areasOfIssue.get(held.linearIssue) ?? []), ...paths]);
  }
  const rank = (priority: LinearPriority | undefined) =>
    PRIORITY_RANK[priority ?? LINEAR_PRIORITY.NONE];
  return issues
    .map((issue): FactoryPlanned => {
      const priority = Object.values(LINEAR_PRIORITY).find((value) => value === issue.priority);
      const zonePaths = new Set(
        (areasOfIssue.get(issue.identifier) ?? []).flatMap((path) => holding(path) ?? []),
      );
      return {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        ...(issue.state === undefined ? undefined : { state: issue.state }),
        ...(priority === undefined ? undefined : { priority }),
        zonePaths: [...zonePaths].slice(0, FACTORY_WORLD_BOUNDS.MAX_PLACES),
      };
    })
    .sort((left, right) => rank(left.priority) - rank(right.priority))
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
});

/**
 * The repository the world draws, with a token to read it by: the busiest
 * of the agents', where the workspace's installations still reach it, else
 * the one they reach that GitHub saw change last; none where they reach none.
 */
const chooseRepository = Effect.fnUntraced(function* (
  organizationId: string,
  agents: readonly ReadAgent[],
) {
  const app = yield* GitHubApp;
  const busiest = busiestRepository(agents);
  if (busiest !== undefined) {
    const reached = yield* app.repositoryReadToken(organizationId, busiest, undefined);
    if (Option.isSome(reached)) return reached;
  }
  const reachable = yield* app.workspaceRepositories(organizationId);
  const [latest] = Option.getOrElse(reachable, () => []);
  if (latest === undefined) return Option.none();
  return yield* app.repositoryReadToken(organizationId, latest.fullName, undefined);
});

/**
 * The workspace's world as it stands now, read as the account, whose
 * membership the caller has confirmed; none where the workspace reaches no
 * repository to draw.
 */
export const readFactoryWorld = /* @__PURE__ */ Effect.fn("web/readFactoryWorld")(function* (
  userId: string,
  organizationId: string,
): Effect.fn.Return<
  Option.Option<FactoryWorld>,
  GitHubWorkspaceReadFailure | StoreFailure,
  DatabaseServices | GitHubApp | HttpClient.HttpClient | WorkspaceLinearConnect
> {
  const now = yield* Clock.currentTimeMillis;
  const shippedSince = now - Duration.toMillis(FACTORY_WORLD_READ.SHIPPED_LOOKBACK);
  const read = yield* readAgents(userId, organizationId, shippedSince, now);
  const chosen = yield* chooseRepository(organizationId, read);
  if (Option.isNone(chosen)) return Option.none();
  const { token, repository: reached } = chosen.value;
  const repository = { fullName: reached.fullName, defaultBranch: reached.defaultBranch };
  const onRepository = read.filter(
    ({ held }) => held.agent.repository.toLowerCase() === reached.fullName.toLowerCase(),
  );
  const zones = yield* readZones(token, repository);
  const planned = yield* readPlanned(organizationId, onRepository, zones);
  return Option.some({
    snapshotAt: now,
    shippedSince,
    repository,
    zones,
    agents: agentsOf(onRepository),
    shipped: shippedOf(onRepository, shippedSince),
    planned,
    defects: [],
  } satisfies FactoryWorld);
});

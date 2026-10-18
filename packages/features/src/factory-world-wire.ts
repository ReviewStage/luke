import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_STATUS, codingAgentPullRequestSchema } from "./coding-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { pullRequestAreasSchema } from "./pull-request-area.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * factory-world-wire.ts -- one snapshot of a workspace's repository as the Factory's worlds draw it.
 *
 * A world is the repository as a factory floor: its zones, the directories
 * and packages it is built from, each naming the zones it depends on; the
 * workspace's coding agents at work and the pull requests they opened, each
 * by the areas it touched (`pull-request-area.ts`); the pull requests merged
 * within the window the snapshot looks back over; the Linear issues planned,
 * placed on the zones their task's agents touched where that is known; and
 * the defects a monitor reports, a slot nothing fills yet.
 *
 * A zone names no layer: which zones are the core and which the edge a
 * developer meets is read off the graph `dependsOn` draws, so the same
 * reading serves any repository. A zone's path, and every path a snapshot
 * names a zone by, is a directory from the repository's root, the root
 * itself spelled `AREA_PATH.ROOT`.
 *
 * The snapshot is read whole for one workspace (`factoryWorldRequestSchema`)
 * and is view-only: nothing in it is a handle to change anything by.
 */

/** How much of a repository one snapshot names; a repository with more names the largest, the newest, or the most pressing first. */
export const FACTORY_WORLD_BOUNDS = {
  /** The most zones a snapshot names, the largest by bytes first. */
  MAX_ZONES: 200,
  /** The most coding agents a snapshot names: those at work first, then the latest to move. */
  MAX_AGENTS: 100,
  /** The most merged pull requests a snapshot names, the newest merged first. */
  MAX_SHIPPED: 200,
  /** The most Linear issues a snapshot names, the most pressing first. */
  MAX_PLANNED: 50,
  /** The most defects a snapshot names, the most frequent first. */
  MAX_DEFECTS: 50,
  /** The most zones one issue or defect is placed on. */
  MAX_PLACES: 16,
} as const;

/** A Linear issue's priority, as Linear numbers it: none set, then urgent down to low. */
export const LINEAR_PRIORITY = {
  NONE: 0,
  URGENT: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
} as const;

export type LinearPriority = (typeof LINEAR_PRIORITY)[keyof typeof LINEAR_PRIORITY];

/** The zones a snapshot names one of its items on, by path. */
const zonePathsSchema = EffectSchema.Array(EffectSchema.String).check(
  EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_PLACES),
);

/** The repository a snapshot draws: `owner/name`, and the branch its merged work lands on. */
export const factoryRepositorySchema = EffectSchema.Struct({
  fullName: githubRepositoryFullNameSchema,
  defaultBranch: EffectSchema.String,
});

export type FactoryRepository = typeof factoryRepositorySchema.Type;

/**
 * One zone: a package or directory by its path from the root, the name it
 * is drawn under, how many files and bytes it holds on the default branch,
 * and the zones it depends on, by path: those its `package.json` names among
 * the workspace's own packages, and the zone it sits inside.
 */
export const factoryZoneSchema = EffectSchema.Struct({
  path: EffectSchema.String,
  /** A package's name, such as `@luke/service`, or a directory's own. */
  label: EffectSchema.String,
  files: countedNumber,
  bytes: countedNumber,
  dependsOn: EffectSchema.Array(EffectSchema.String).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_ZONES),
  ),
});

export type FactoryZone = typeof factoryZoneSchema.Type;

/**
 * The pull request an agent opened, as GitHub last answered the service:
 * what its row says, when it was opened where that is known, and the areas
 * it touched.
 */
export const factoryPullRequestSchema = EffectSchema.Struct({
  ...codingAgentPullRequestSchema.fields,
  /** Epoch milliseconds the pull request was opened; absent where the service has not read it. */
  openedAt: EffectSchema.optionalKey(countedNumber),
  areas: pullRequestAreasSchema,
});

export type FactoryPullRequest = typeof factoryPullRequestSchema.Type;

/**
 * One of the workspace's coding agents: what it is called, where it stands,
 * who started it, the task it works on, when it last moved, and the pull
 * request it opened.
 */
export const factoryAgentSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  /** The agent's title; null where it has none yet. */
  title: EffectSchema.NullOr(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(CODING_AGENT_STATUS)),
  /** The member who started the agent; absent once their account is gone. */
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  /** The task the agent works on; null for one an automation started with none. */
  taskId: EffectSchema.NullOr(wireUuidSchema),
  /** Epoch milliseconds the agent last moved: its start, its newest run's start, or that run's end, whichever is latest. */
  activityAt: countedNumber,
  /** The pull request it opened; null before it opened one. */
  pullRequest: EffectSchema.NullOr(factoryPullRequestSchema),
});

export type FactoryAgent = typeof factoryAgentSchema.Type;

/** One pull request merged within the window: what it was, when it merged, its size, the areas it landed in, and the agent and task it came from where known. */
export const factoryShippedSchema = EffectSchema.Struct({
  number: countedNumber,
  title: EffectSchema.String,
  url: EffectSchema.String,
  /** Epoch milliseconds it merged. */
  mergedAt: countedNumber,
  additions: countedNumber,
  deletions: countedNumber,
  areas: pullRequestAreasSchema,
  /** The coding agent that opened it; absent where none of the workspace's did. */
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  /** The task that agent worked on; absent where it had none, or no agent is known. */
  taskId: EffectSchema.optionalKey(wireUuidSchema),
});

export type FactoryShipped = typeof factoryShippedSchema.Type;

/**
 * One Linear issue planned: its key, title, page, workflow state, and
 * priority, and the zones it is placed on, those the pull requests of its
 * task's agents touched; empty where no task of it has touched any.
 */
export const factoryPlannedSchema = EffectSchema.Struct({
  /** The issue's key, `ENG-123`. */
  identifier: EffectSchema.String,
  title: EffectSchema.String,
  url: EffectSchema.String,
  /** The name of the workflow state it stands in, `Todo`; absent where Linear named none. */
  state: EffectSchema.optionalKey(EffectSchema.String),
  /** Absent where Linear answered none. */
  priority: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(LINEAR_PRIORITY))),
  zonePaths: zonePathsSchema,
});

export type FactoryPlanned = typeof factoryPlannedSchema.Type;

/** One defect a monitor reports: its id there, its title, how many events and users it reached, and the zones it is placed on. Nothing fills it yet. */
export const factoryDefectSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  title: EffectSchema.String,
  events: countedNumber,
  users: countedNumber,
  zonePaths: zonePathsSchema,
});

export type FactoryDefect = typeof factoryDefectSchema.Type;

/** One snapshot of a workspace's repository, as of `snapshotAt`. */
export const factoryWorldSchema = EffectSchema.Struct({
  /** Epoch milliseconds the snapshot was read. */
  snapshotAt: countedNumber,
  /** Epoch milliseconds the window `shipped` looks back over opens. */
  shippedSince: countedNumber,
  repository: factoryRepositorySchema,
  zones: EffectSchema.Array(factoryZoneSchema).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_ZONES),
  ),
  agents: EffectSchema.Array(factoryAgentSchema).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_AGENTS),
  ),
  shipped: EffectSchema.Array(factoryShippedSchema).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_SHIPPED),
  ),
  planned: EffectSchema.Array(factoryPlannedSchema).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_PLANNED),
  ),
  defects: EffectSchema.Array(factoryDefectSchema).check(
    EffectSchema.isMaxLength(FACTORY_WORLD_BOUNDS.MAX_DEFECTS),
  ),
});

export type FactoryWorld = typeof factoryWorldSchema.Type;

/** The world a member asks for (POST): the workspace, whose repository the service chooses. */
export const factoryWorldRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

export type FactoryWorldRequest = typeof factoryWorldRequestSchema.Type;

/** The workspace's world; null where it has no repository to draw. */
export const factoryWorldAnswerSchema = EffectSchema.Struct({
  world: EffectSchema.NullOr(factoryWorldSchema),
});

export type FactoryWorldAnswer = typeof factoryWorldAnswerSchema.Type;

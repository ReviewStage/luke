/**
 * factory-world.ts -- builders for a Factory world snapshot, each item filled with plain defaults a test overrides where it matters.
 *
 * `factoryWorldOf` decodes what it builds through `factoryWorldSchema`, so
 * a fixture that breaks the contract (a malformed id, a bound passed) fails
 * where it is built rather than passing a test the service could never
 * answer.
 */

import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  type FactoryAgent,
  type FactoryDefect,
  type FactoryPlanned,
  type FactoryPullRequest,
  type FactoryShipped,
  type FactoryWorld,
  type FactoryZone,
  factoryWorldSchema,
} from "@luke/features/factory-world-wire";
import type { PullRequestArea } from "@luke/features/pull-request-area";
import { Schema } from "effect";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The instant a built snapshot is read at, unless a test says otherwise. */
export const FACTORY_NOW = Date.UTC(2026, 9, 18, 12);

const decodeWorld = Schema.decodeUnknownSync(factoryWorldSchema);

/** A well-formed uuid numbered `n`, for an agent's or a task's id. */
export function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** An area of `lines` added lines at `path`. */
export function areaOf(path: string, lines: number): PullRequestArea {
  return { path, additions: lines, deletions: 0 };
}

/** A zone at `path`, labelled by its last directory, of 1000 bytes, depending on `dependsOn`. */
export function factoryZoneOf(
  path: string,
  dependsOn: readonly string[] = [],
  fields: Partial<FactoryZone> = {},
): FactoryZone {
  return {
    path,
    label: path.split("/").at(-1) ?? path,
    files: 1,
    bytes: 1000,
    dependsOn,
    ...fields,
  };
}

/** An open pull request, number 1, with passing checks and its lines summed from its areas. */
export function factoryPullRequestOf(fields: Partial<FactoryPullRequest> = {}): FactoryPullRequest {
  const areas = fields.areas ?? [];
  const number = fields.number ?? 1;
  return {
    number,
    title: "feat(factory): build it",
    url: `https://github.com/acme/factory/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: areas.reduce((sum, area) => sum + area.additions, 0),
    deletions: areas.reduce((sum, area) => sum + area.deletions, 0),
    changedFiles: areas.length,
    areas,
    ...fields,
  };
}

/** A running agent, numbered `n`, with no task and no pull request, last moving at `FACTORY_NOW`. */
export function factoryAgentOf(n: number, fields: Partial<FactoryAgent> = {}): FactoryAgent {
  return {
    id: uuidOf(n),
    title: "Build it",
    status: CODING_AGENT_STATUS.RUNNING,
    taskId: null,
    activityAt: FACTORY_NOW,
    pullRequest: null,
    ...fields,
  };
}

/** A pull request numbered `number` merged at `mergedAt`, with its lines summed from its areas. */
export function factoryShippedOf(
  number: number,
  mergedAt: number,
  fields: Partial<FactoryShipped> = {},
): FactoryShipped {
  const areas = fields.areas ?? [];
  return {
    number,
    title: "feat(factory): shipped it",
    url: `https://github.com/acme/factory/pull/${number}`,
    mergedAt,
    additions: areas.reduce((sum, area) => sum + area.additions, 0),
    deletions: areas.reduce((sum, area) => sum + area.deletions, 0),
    areas,
    ...fields,
  };
}

/** A Linear issue `ENG-<n>`, placed on no zone. */
export function factoryPlannedOf(n: number, fields: Partial<FactoryPlanned> = {}): FactoryPlanned {
  return {
    identifier: `ENG-${n}`,
    title: "Plan it",
    url: `https://linear.app/acme/issue/ENG-${n}`,
    zonePaths: [],
    ...fields,
  };
}

/** A defect numbered `n`, of one event for one user, placed on no zone. */
export function factoryDefectOf(n: number, fields: Partial<FactoryDefect> = {}): FactoryDefect {
  return { id: String(n), title: "It broke", events: 1, users: 1, zonePaths: [], ...fields };
}

/** A snapshot read at `FACTORY_NOW`, looking back fourteen days, holding nothing but what `fields` names. */
export function factoryWorldOf(fields: Partial<FactoryWorld> = {}): FactoryWorld {
  return decodeWorld({
    snapshotAt: FACTORY_NOW,
    shippedSince: FACTORY_NOW - 14 * DAY_MS,
    repository: { fullName: "acme/factory", defaultBranch: "main" },
    zones: [],
    agents: [],
    shipped: [],
    planned: [],
    defects: [],
    ...fields,
  });
}

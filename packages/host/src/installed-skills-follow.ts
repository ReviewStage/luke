import {
  INSTALLED_SKILLS_READ,
  type InstalledSkillLiveRow,
  type InstalledSkillsLiveAnswer,
  installedSkillsOfLiveRows,
} from "@repo/features/installed-skill-live";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillIdParams,
  type InstalledSkillRemovedView,
} from "@repo/features/installed-skill-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppInstalledSkills, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * installed-skills-follow.ts -- the skills the account sees in each workspace the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and every write to one drawn over them the moment it is asked.
 *
 * Settings › Skills holds its workspace's skills, the workspace's and the
 * reader's own, and the host follows them while any window holds them and a
 * while after (`heldSlice`), so a skill a teammate installs or removes draws
 * on every open page within the service's coalesce window.
 * Each skill is one row of the pool (`@repo/sync`), by its id, however many
 * workspaces' reads hold it: a personal skill stands in every held
 * workspace's read, so one write to it draws in each. Each workspace draws
 * the rows it holds as the held read answers them
 * (`@repo/features/installed-skill-live`), but those another workspace's
 * scope names, followed as every pool read is (`followLiveRead`).
 *
 * A removal is a write the pool draws over its skill at once, standing
 * until every read holding it carries the transaction, and taken back where
 * the service refused it. An install draws from its answer, since the
 * service reads the paste afresh and mints the ids: its skills are made rows
 * every held read whose scope they are in shows, each standing until those
 * reads carry it.
 *
 * A read the service did not answer is told unanswered and asked for again
 * after `LIVE_RESTART`, as a follow that stops is. One of a workspace the
 * account is no member of is told unanswered and ends; one refused because
 * the session is no longer the account the follow started for ends unsaid,
 * and the next sign-in follows it again.
 */

/** A skill as the pool holds it, by its id, every write to it a change of its fields, its deletion, or its making. */
const INSTALLED_SKILL = fieldKind((row: InstalledSkillLiveRow) => row.id);

/** A read the service did not answer, as the client and the gate tell it. */
interface SkillsUnanswered {
  readonly failure: string;
}

export interface InstalledSkillsFollowDependencies {
  /** The skills one workspace shows sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<InstalledSkillsLiveAnswer | SkillsUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which each held workspace's skills stand in while it is followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppInstalledSkills) => void;
}

/** A skill's row as a write's answer says it stands. */
export function skillRowOf({
  workspaceId,
  ...skill
}: InstalledSkillSummary): InstalledSkillLiveRow {
  return { ...skill, workspaceId: workspaceId ?? null };
}

/** Whether a skill is one the workspace shows: the reader's own, or the workspace's. */
function shownIn(workspaceId: string, row: InstalledSkillLiveRow): boolean {
  return row.workspaceId === null || row.workspaceId === workspaceId;
}

/**
 * The held lifetime over every workspace's skills the windows hold
 * (`heldSlice`), keyed by the workspace, told whole on their slice: each
 * workspace's read as its follow last told it, kept where a later read does
 * not answer, and failed where it never answered.
 */
export function heldInstalledSkills(
  dependencies: InstalledSkillsFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.INSTALLED_SKILLS, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate: dependencies.gate,
    follow: (workspaceId, answers) => {
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.accountId();
      return followLiveRead(
        {
          seal: (poll, after) =>
            userId === undefined
              ? Effect.succeed(LIVE_SIGNED_OUT)
              : dependencies.seal(workspaceId, userId, poll, after),
          rows: INSTALLED_SKILLS_READ.rows,
          part: "skills",
          pool: dependencies.pool,
          kind: INSTALLED_SKILL,
          // Note that a workspace the account is no member of ends the follow, told unanswered.
          endsFollow: (failure) => failure === INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND,
          // Note that each workspace draws the rows it shows, though another workspace's read holds them too, and adopts a skill an install made in its scope.
          draw: (rows) =>
            installedSkillsOfLiveRows(rows.filter((row) => shownIn(workspaceId, row))),
          adopts: (row) => shownIn(workspaceId, row),
        },
        answers,
      );
    },
    tell: dependencies.tell,
  });
}

/** A change to a skill's row. */
type SkillChange = FieldChange<InstalledSkillLiveRow>;

/** A skill removed, gone at once from every read holding it, sent as `send` asks; a refusal puts it back. */
export function skillRemoved(
  send: (removal: InstalledSkillIdParams) => Effect.Effect<InstalledSkillRemovedView>,
): WriteDeclaration<
  InstalledSkillLiveRow,
  SkillChange,
  InstalledSkillIdParams,
  InstalledSkillRemovedView
> {
  return {
    kind: INSTALLED_SKILL,
    keys: (removal) => [removal.skillId],
    change: () => () => ROW_GONE,
    send: (removal) =>
      Effect.map(send(removal), (answer) =>
        "id" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };
}

/**
 * A skill an install made, drawn on every held read whose scope it is in
 * until each carries the install's transaction, or taken as the service
 * answered it where a read hands no wait.
 */
export const SKILL_MADE: WriteDeclaration<
  InstalledSkillLiveRow,
  SkillChange,
  { readonly row: InstalledSkillLiveRow; readonly txid: string | undefined },
  void
> = {
  kind: INSTALLED_SKILL,
  keys: ({ row }) => [row.id],
  change: ({ row }) => ({ made: row }),
  send: ({ txid }) => Effect.succeed({ answer: undefined, txid }),
};

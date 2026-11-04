import {
  type InstalledSkillLiveRow,
  type InstalledSkillsLiveAnswer,
  installedSkillsLiveRowsSchema,
  installedSkillsOfLiveRows,
} from "@repo/features/installed-skill-live";
import type { InstalledSkillSummary } from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillIdParams,
  type InstalledSkillRemovedView,
  type InstalledSkillShareParams,
  type InstalledSkillToggleParams,
  type InstalledSkillUpdatedView,
  type InstalledSkillUpdateParams,
  type InstalledSkillView,
} from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type Refused,
  ROW_GONE,
  type WriteDeclaration,
  type Written,
} from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { Effect, type Scope } from "effect";
import { type AppHostReads, type AppInstalledSkills, NO_KEYS_HELD } from "./app-state.js";
import { type HeldAnswers, type HeldSlice, heldSlice } from "./live-collection.js";
import {
  confirmWrite,
  followTakingRows,
  LIVE_GONE,
  restarting,
  type TxWait,
} from "./live-follow.js";

/**
 * installed-skills-follow.ts -- the skills the account sees in each workspace the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and every write to one drawn over them the moment it is asked.
 *
 * Settings › Skills holds its workspace's skills, the workspace's and the
 * reader's own, and the host follows them while any window holds them and a
 * while after (`heldSlice`), so a skill a teammate installs, toggles, or
 * removes draws on every open page within the service's coalesce window.
 * Each skill is one row of the pool (`@repo/sync`), by its id, however many
 * workspaces' reads hold it: a personal skill stands in every held
 * workspace's read, so one write to it draws in each. Each workspace draws
 * the rows it holds as the held read answers them
 * (`@repo/features/installed-skill-live`), but those another workspace's
 * scope names, as a skill shared into another workspace is until its read
 * answers without it.
 *
 * A toggle, a share, and a removal are writes the pool draws over their
 * skill at once, standing until every read holding it carries the
 * transaction, and taken back where the service refused them. An update and
 * an install draw from their answers, since the service reads the paste or
 * the GitHub folder afresh and mints the ids: an update stands as the skill
 * it answered, and an install's skills are made rows every held read whose
 * scope they are in shows, each standing until those reads carry it.
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

/** A refusal after which the read is followed no longer: a workspace the account is no member of, or another account's session. */
function endsFollow(failure: string): boolean {
  return failure === INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/**
 * Follows one workspace's skills until let go, each change told through
 * `answers`: the rows as the read last answered them, every write standing
 * drawn over them, and the skills an install made in its scope beside them.
 * Nothing is told before the read first answers, since a write drawn on no
 * skills shows nothing of the workspace.
 */
function followSkills(
  dependencies: InstalledSkillsFollowDependencies,
  workspaceId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.INSTALLED_SKILLS]>,
): Effect.Effect<void> {
  // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
  const userId = dependencies.accountId();
  const seal = (poll: boolean, after?: string) =>
    userId === undefined
      ? Effect.succeed(LIVE_SIGNED_OUT)
      : dependencies.seal(workspaceId, userId, poll, after);
  const attempt = Effect.scoped(
    Effect.gen(function* () {
      const first = yield* seal(false);
      if ("failure" in first) {
        if (first.failure === LIVE_SIGNED_OUT.failure) return false;
        answers.unanswered();
        return first.failure !== INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND;
      }
      let wait: TxWait | undefined;
      let answered = false;
      /** Why a poll ended the follow for good, the first such failure kept, so one the account no longer reaches is told unanswered. */
      let endedBy: string | undefined;
      const drawn: Effect.Effect<void> = Effect.sync(() => {
        if (!answered) return;
        const shown = skills.rows().filter((row) => shownIn(workspaceId, row));
        answers.answered(installedSkillsOfLiveRows(shown));
      });
      const skills: HeldRows<InstalledSkillLiveRow> = yield* dependencies.pool.stand(
        INSTALLED_SKILL,
        {
          redraw: () => drawn,
          confirmation: () => {
            const handed = wait;
            return handed === undefined ? undefined : (txid) => confirmWrite(handed, txid);
          },
          adopts: (row) => shownIn(workspaceId, row),
        },
      );
      const gone = yield* followTakingRows(
        {
          poll: (after) =>
            Effect.map(seal(true, after), (read) => {
              if (!("failure" in read)) return read;
              const ends = endsFollow(read.failure);
              if (ends && endedBy === undefined) endedBy = read.failure;
              return { failure: read.failure, gone: ends };
            }),
          onTxWait: (handed) => {
            wait = handed;
          },
        },
        first,
        installedSkillsLiveRowsSchema,
        (rows) =>
          Effect.andThen(
            skills.answer(rows.skills),
            Effect.suspend(() => {
              answered = true;
              return drawn;
            }),
          ),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      if (!gone) return true;
      if (endedBy === INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND) answers.unanswered();
      return false;
    }),
  );
  return restarting(attempt);
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
    follow: (workspaceId, answers) => followSkills(dependencies, workspaceId, answers),
    tell: dependencies.tell,
  });
}

/** A change to a skill's row. */
type SkillChange = FieldChange<InstalledSkillLiveRow>;

/** A toggle's or a share's answer: the skill as the service says it now stands, or the write refused. */
function settledAs(
  answer: InstalledSkillView,
): Written<SkillChange, WireValue> | Refused<WireValue, SkillChange> {
  return "skill" in answer
    ? {
        answer: carried<InstalledSkillView>(answer),
        txid: answer.txid,
        taken: () => skillRowOf(answer.skill),
      }
    : { refused: carried<InstalledSkillView>(answer) };
}

/** A skill turned on or off, drawn so at once over every read holding it, sent as `send` asks. */
export function skillEnabled(
  send: (toggle: InstalledSkillToggleParams) => Effect.Effect<InstalledSkillView>,
): WriteDeclaration<InstalledSkillLiveRow, SkillChange, InstalledSkillToggleParams, WireValue> {
  return {
    kind: INSTALLED_SKILL,
    keys: (toggle) => [toggle.skillId],
    change: (toggle) => () => ({ enabled: toggle.enabled }),
    send: (toggle) => Effect.map(send(toggle), settledAs),
  };
}

/**
 * The account's own skill shared with a workspace, drawn at once as that
 * workspace's, installed by the account, who may manage it, sent as `send`
 * asks. Note that a read of another workspace holding it stops showing it
 * at once, since its scope is no longer that read's.
 */
export function skillShared(
  send: (share: InstalledSkillShareParams) => Effect.Effect<InstalledSkillView>,
  readerId: () => string | undefined,
): WriteDeclaration<InstalledSkillLiveRow, SkillChange, InstalledSkillShareParams, WireValue> {
  return {
    kind: INSTALLED_SKILL,
    keys: (share) => [share.skillId],
    change: (share) => {
      const installedBy = readerId() ?? null;
      return () => ({
        scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
        workspaceId: share.workspaceId,
        installedBy,
        manageable: true,
      });
    },
    send: (share) => Effect.map(send(share), settledAs),
  };
}

/** A skill removed, gone at once from every read holding it, sent as `send` asks; a refusal puts it back. */
export function skillRemoved(
  send: (removal: InstalledSkillIdParams) => Effect.Effect<InstalledSkillRemovedView>,
): WriteDeclaration<InstalledSkillLiveRow, SkillChange, InstalledSkillIdParams, WireValue> {
  return {
    kind: INSTALLED_SKILL,
    keys: (removal) => [removal.skillId],
    change: () => () => ROW_GONE,
    send: (removal) =>
      Effect.map(send(removal), (answer) =>
        "id" in answer
          ? { answer: carried<InstalledSkillRemovedView>(answer), txid: answer.txid }
          : { refused: carried<InstalledSkillRemovedView>(answer) },
      ),
  };
}

/**
 * A skill's files read again at its ref, drawn as the service answered it
 * the moment it answers and standing so until every read holding it carries
 * the transaction. Note that nothing is drawn before, since only the service
 * reads what the folder now holds.
 */
export function skillUpdated(
  send: (update: InstalledSkillUpdateParams) => Effect.Effect<InstalledSkillUpdatedView>,
): WriteDeclaration<InstalledSkillLiveRow, SkillChange, InstalledSkillUpdateParams, WireValue> {
  return {
    kind: INSTALLED_SKILL,
    keys: (update) => [update.skillId],
    change: () => () => ({}),
    send: (update) =>
      Effect.map(send(update), (answer) => {
        if (!("skill" in answer)) return { refused: carried<InstalledSkillUpdatedView>(answer) };
        const updated: SkillChange = () => skillRowOf(answer.skill);
        return {
          answer: carried<InstalledSkillUpdatedView>(answer),
          txid: answer.txid,
          taken: updated,
          standsAs: updated,
        };
      }),
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

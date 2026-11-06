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
} from "@repo/features/installed-skill-view";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { carried } from "@repo/gateway";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  ROW_GONE,
  type WriteDeclaration,
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

const INSTALLED_SKILL = fieldKind((row: InstalledSkillLiveRow) => row.id);

interface SkillsUnanswered {
  readonly failure: string;
}

export interface InstalledSkillsFollowDependencies {
  readonly seal: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<InstalledSkillsLiveAnswer | SkillsUnanswered>;
  readonly accountId: () => string | undefined;
  readonly gate: () => boolean;
  readonly pool: EntityPool;
  readonly tell: (held: AppInstalledSkills) => void;
}

export function skillRowOf({
  workspaceId,
  ...skill
}: InstalledSkillSummary): InstalledSkillLiveRow {
  return { ...skill, workspaceId: workspaceId ?? null };
}

function shownIn(workspaceId: string, row: InstalledSkillLiveRow): boolean {
  return row.workspaceId === null || row.workspaceId === workspaceId;
}

function endsFollow(failure: string): boolean {
  return failure === INSTALLED_SKILL_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

function followSkills(
  dependencies: InstalledSkillsFollowDependencies,
  workspaceId: string,
  answers: HeldAnswers<AppHostReads[typeof LIVE_READ.INSTALLED_SKILLS]>,
): Effect.Effect<void> {
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

type SkillChange = FieldChange<InstalledSkillLiveRow>;

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

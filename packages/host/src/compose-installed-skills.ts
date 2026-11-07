import type { HostedInstalledSkillClient } from "@repo/features/installed-skill-client";
import { INSTALLED_SKILLS_READ } from "@repo/features/installed-skill-live";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { declaredWrite, type EntityPool } from "@repo/sync";
import { Effect, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { type INSTALLED_SKILL_ACTS, INSTALLED_SKILL_FOLLOWS } from "./contract/index.js";
import { type HostActTable, liveTold } from "./host-acts.js";
import type { HostKernel } from "./host-kernel.js";
import {
  heldInstalledSkills,
  SKILL_MADE,
  skillRemoved,
  skillRowOf,
} from "./installed-skills-follow.js";
import type { HeldSlice } from "./live-collection.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-installed-skills.ts -- the skills the account installs, held for the windows that draw them and asked of the service on the window's behalf: one read, a paste previewed and installed, or one removed.
 *
 * What Settings › Skills draws, a workspace's skills beside the account's
 * own, it holds (`heldSlice`): the host follows them on the service's live
 * read for the account signed in as it started, into the sync engine's pool
 * (`installed-skills-follow.ts`), from the first window's hold, and keeps
 * them among the few let go latest after the last lets go, laid on their
 * app-state slice and told on it (`liveTold`). A sign-out lets
 * every follow go and lays none, and the account gate opening follows the
 * holds anew (`open`).
 *
 * A removal is a write declared there, drawn over every held read of the
 * skill the moment it is asked; an install draws from its answer, since
 * only the service reads what it installs. Each answers the service's answer whole, as the window's view of
 * it: the answer, or why there is none, with the skill it names. A skill
 * read whole and a preview are fetched and held nowhere. Behind a closed account gate, or on a run that
 * sends nothing, every ask answers unanswered.
 */

/** The service's side of installed skills, as this concern asks it. */
export type InstalledSkillsClient = Pick<
  HostedInstalledSkillClient,
  "liveRead" | "read" | "preview" | "install" | "remove"
>;

export interface InstalledSkillsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: InstalledSkillsClient;
  /** The sync engine's pool, which each held workspace's skills stand in. */
  pool: EntityPool;
}

export interface InstalledSkillsComposer extends Composer {
  /** The installed skills' plain asks and live follow, answered directly as the panel's port asks them. */
  readonly acts: HostActTable<typeof INSTALLED_SKILL_ACTS> &
    HostActTable<typeof INSTALLED_SKILL_FOLLOWS>;
  /** Every held workspace's skills followed anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every follow let go and no read laid, as a sign-out lets them go; the windows' holds stand. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

export function composeInstalledSkills(
  dependencies: InstalledSkillsDependencies,
): Effect.Effect<InstalledSkillsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const { kernel, account, client } = dependencies;
    const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();
    const skills = yield* heldInstalledSkills({
      seal: (workspaceId, userId, poll, after) =>
        gate()
          ? Effect.provideService(
              client.liveRead(
                INSTALLED_SKILLS_READ,
                { userId, workspaceId },
                poll ? { after } : undefined,
              ),
              HttpClient.HttpClient,
              http,
            )
          : Effect.succeed(UNANSWERED),
      accountId: dependencies.accountId,
      gate,
      pool: dependencies.pool,
      tell: liveTold(kernel.emit, INSTALLED_SKILL_FOLLOWS.INSTALLED_SKILLS_FOLLOW),
    });
    return composed(dependencies, gate, http, skills);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: InstalledSkillsDependencies,
  gate: () => boolean,
  http: HttpClient.HttpClient,
  skills: HeldSlice<string>,
): InstalledSkillsComposer {
  const { client, pool } = dependencies;

  /** The service asked behind the gate, over the host's own HTTP client, its answer handed on as it stands, so a failure's cause reaches the window. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  /** The installed skills' plain asks and live follow, answered as the panel's port asks them (`INSTALLED_SKILL_ACTS`, `INSTALLED_SKILL_FOLLOWS`). */
  const acts: InstalledSkillsComposer["acts"] = {
    INSTALLED_SKILLS_READ: ({ skillId }) => asked(client.read(skillId)),
    INSTALLED_SKILLS_PREVIEW: ({ workspaceId, text }) => asked(client.preview(workspaceId, text)),
    // An install's skills are drawn on every held read whose scope they are in the moment it answers, each standing until those reads carry its transaction.
    INSTALLED_SKILLS_INSTALL: (install) =>
      Effect.gen(function* () {
        const view = yield* asked(client.install(install));
        if ("skills" in view) {
          yield* Effect.forEach(
            view.skills,
            (skill) => pool.write(SKILL_MADE, { row: skillRowOf(skill), txid: view.txid }),
            { concurrency: "unbounded", discard: true },
          );
        }
        return view;
      }),
    INSTALLED_SKILLS_REMOVE: declaredWrite(
      pool,
      skillRemoved((removal) => asked(client.remove(removal.skillId))),
    ),
    // A workspace's skills are held for the windows while Settings › Skills shows them.
    INSTALLED_SKILLS_FOLLOW: {
      hold: ({ workspaceId }) => skills.hold(workspaceId),
      retry: ({ workspaceId }) => skills.retry(workspaceId),
    },
  };

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  return { methods: {}, acts, lifetime: Effect.void, open: skills.open, reset: skills.end };
}

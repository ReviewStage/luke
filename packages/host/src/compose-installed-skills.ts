import type { HostedInstalledSkillClient } from "@repo/features/installed-skill-client";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillInstallView,
  type InstalledSkillPreviewView,
  installedSkillFollowParamsSchema,
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillPreviewParamsSchema,
} from "@repo/features/installed-skill-view";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import { declaredMethod, type EntityPool } from "@repo/sync";
import type { WireRecord } from "@repo/wire";
import { Effect, FiberMap, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AppInstalledSkills } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostMethodTable } from "./gateway-door.js";
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
 * app-state slice and told as `INSTALLED_SKILLS_CHANGED`. A sign-out lets
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
  "installedSkillsLive" | "read" | "preview" | "install" | "remove"
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
              client.installedSkillsLive(workspaceId, userId, poll, after),
              HttpClient.HttpClient,
              http,
            )
          : Effect.succeed(UNANSWERED),
      accountId: dependencies.accountId,
      gate,
      pool: dependencies.pool,
      tell: (held: AppInstalledSkills) =>
        kernel.emit(GATEWAY_EVENT.INSTALLED_SKILLS_CHANGED, carried(held)),
    });
    const holds = yield* FiberMap.make<string>();
    return composed(dependencies, gate, http, { skills, holds });
  });
}

/** What the composer holds for the windows: every held workspace's skills, and the windows' hold on each, one fiber standing until let go. */
interface Held {
  readonly skills: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: InstalledSkillsDependencies,
  gate: () => boolean,
  http: HttpClient.HttpClient,
  { skills, holds }: Held,
): InstalledSkillsComposer {
  const { client, pool } = dependencies;

  /** The service asked behind the gate, over the host's own HTTP client, its answer handed on as it stands, so a failure's cause reaches the window. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  const methods: HostMethodTable = {
    // Note that the windows' hold on a workspace is one fiber standing until let go, so a window holding it again holds nothing anew.
    [GATEWAY_METHOD.INSTALLED_SKILLS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          installedSkillFollowParamsSchema,
          params,
          "following skills names a workspace",
        );
        yield* FiberMap.run(
          holds,
          workspaceId,
          Effect.scoped(Effect.andThen(skills.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          installedSkillFollowParamsSchema,
          params,
          "letting skills go names a workspace",
        );
        yield* FiberMap.remove(holds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          installedSkillFollowParamsSchema,
          params,
          "reading skills again names a workspace",
        );
        yield* skills.retry(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_READ]: (params) =>
      Effect.gen(function* () {
        const { skillId } = yield* readParams(
          installedSkillIdParamsSchema,
          params,
          "a read names a skill",
        );
        const view = yield* asked(client.read(skillId));
        return carried<InstalledSkillContentView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, text } = yield* readParams(
          installedSkillPreviewParamsSchema,
          params,
          "a preview names a workspace and a paste",
        );
        const view = yield* asked(client.preview(workspaceId, text));
        return carried<InstalledSkillPreviewView>(view);
      }),
    // An install's skills are drawn on every held read whose scope they are in the moment it answers, each standing until those reads carry its transaction.
    [GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL]: (params) =>
      Effect.gen(function* () {
        const install = yield* readParams(
          installedSkillInstallParamsSchema,
          params,
          "an install names a workspace, a scope, and a paste",
        );
        const view = yield* asked(client.install(install));
        if ("skills" in view) {
          yield* Effect.forEach(
            view.skills,
            (skill) => pool.write(SKILL_MADE, { row: skillRowOf(skill), txid: view.txid }),
            { concurrency: "unbounded", discard: true },
          );
        }
        return carried<InstalledSkillInstallView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE]: declaredMethod(
      pool,
      skillRemoved((removal) => asked(client.remove(removal.skillId))),
      (params: WireRecord) =>
        readParams(installedSkillIdParamsSchema, params, "a removal names a skill"),
    ),
  };

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  return { methods, lifetime: Effect.void, open: skills.open, reset: skills.end };
}

import type {
  HostedInstalledSkillClient,
  InstalledSkillCallResult,
} from "@repo/features/installed-skill-client";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillFailedView,
  type InstalledSkillInstallView,
  type InstalledSkillPreviewFileView,
  type InstalledSkillPreviewView,
  type InstalledSkillUpdateCheckView,
  installedSkillFollowParamsSchema,
  installedSkillIdParamsSchema,
  installedSkillInstallParamsSchema,
  installedSkillPreviewFileParamsSchema,
  installedSkillPreviewParamsSchema,
  installedSkillShareParamsSchema,
  installedSkillToggleParamsSchema,
  installedSkillUpdateParamsSchema,
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
  skillEnabled,
  skillRemoved,
  skillRowOf,
  skillShared,
  skillUpdated,
} from "./installed-skills-follow.js";
import type { HeldSlice } from "./live-collection.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-installed-skills.ts -- the skills the account installs, held for the windows that draw them and asked of the service on the window's behalf: one read, a paste previewed and installed, a previewed skill's `SKILL.md` read, one toggled, checked for an update, updated, shared with a workspace, or removed.
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
 * A toggle, a share, and a removal are writes declared there, drawn over
 * every held read of the skill the moment they are asked; an update and an
 * install draw from their answers, since only the service reads what they
 * install. Each answers the service's answer whole, as the window's view of
 * it: the answer, or the failure with the skill it names and why its files
 * were refused. A skill read whole, a preview, and an update check are
 * fetched and held nowhere. Behind a closed account gate, or on a run that
 * sends nothing, every ask answers unanswered.
 */

/** The service's side of installed skills, as this concern asks it. */
export type InstalledSkillsClient = Pick<
  HostedInstalledSkillClient,
  | "installedSkillsLive"
  | "read"
  | "preview"
  | "previewFile"
  | "install"
  | "setEnabled"
  | "checkUpdate"
  | "update"
  | "share"
  | "remove"
>;

export interface InstalledSkillsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start and a share names as its sharer; none where nobody is. */
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

/** A client's result as the window's view: the answer shaped by `shape`, or the failure with what it names. */
function viewOf<Answer, View>(
  result: InstalledSkillCallResult<Answer>,
  shape: (answer: Answer) => View,
): View | InstalledSkillFailedView {
  if (result.ok) return shape(result.answer);
  const { failure, skillName, skillRefusal } = result;
  return {
    failure,
    ...(skillName === undefined ? undefined : { skillName }),
    ...(skillRefusal === undefined ? undefined : { skillRefusal }),
  };
}

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

  /** The service asked behind the gate, over the host's own HTTP client, its result as the window's view. */
  const asked = <Answer, View>(
    call: Effect.Effect<InstalledSkillCallResult<Answer>, never, HttpClient.HttpClient>,
    shape: (answer: Answer) => View,
  ): Effect.Effect<View | InstalledSkillFailedView> =>
    gate()
      ? Effect.map(Effect.provideService(call, HttpClient.HttpClient, http), (result) =>
          viewOf(result, shape),
        )
      : Effect.succeed(UNANSWERED);

  const whole = <Answer>(answer: Answer) => answer;
  const updated = skillUpdated((update) =>
    asked(client.update(update.workspaceId, update.skillId), whole),
  );

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
        const view = yield* asked(client.read(skillId), whole);
        return carried<InstalledSkillContentView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, text } = yield* readParams(
          installedSkillPreviewParamsSchema,
          params,
          "a preview names a workspace and a paste",
        );
        const view = yield* asked(client.preview(workspaceId, text), whole);
        return carried<InstalledSkillPreviewView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW_FILE]: (params) =>
      Effect.gen(function* () {
        const candidate = yield* readParams(
          installedSkillPreviewFileParamsSchema,
          params,
          "a previewed skill names a workspace, a repository, a commit, and a folder",
        );
        const view = yield* asked(client.previewFile(candidate), (markdown) => ({ markdown }));
        return carried<InstalledSkillPreviewFileView>(view);
      }),
    // An install's skills are drawn on every held read whose scope they are in the moment it answers, each standing until those reads carry its transaction.
    [GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL]: (params) =>
      Effect.gen(function* () {
        const install = yield* readParams(
          installedSkillInstallParamsSchema,
          params,
          "an install names a workspace, a scope, and a paste",
        );
        const view = yield* asked(client.install(install), whole);
        if ("skills" in view) {
          yield* Effect.forEach(
            view.skills,
            (skill) => pool.write(SKILL_MADE, { row: skillRowOf(skill), txid: view.txid }),
            { concurrency: "unbounded", discard: true },
          );
        }
        return carried<InstalledSkillInstallView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED]: declaredMethod(
      pool,
      skillEnabled((toggle) => asked(client.setEnabled(toggle.skillId, toggle.enabled), whole)),
      (params: WireRecord) =>
        readParams(
          installedSkillToggleParamsSchema,
          params,
          "a toggle names a skill and whether it is on",
        ),
    ),
    [GATEWAY_METHOD.INSTALLED_SKILLS_CHECK_UPDATE]: (params) =>
      Effect.gen(function* () {
        const { workspaceId, skillId } = yield* readParams(
          installedSkillUpdateParamsSchema,
          params,
          "an update check names a workspace and a skill",
        );
        const view = yield* asked(client.checkUpdate(workspaceId, skillId), whole);
        return carried<InstalledSkillUpdateCheckView>(view);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE]: (params) =>
      Effect.gen(function* () {
        const update = yield* readParams(
          installedSkillUpdateParamsSchema,
          params,
          "an update names a workspace and a skill",
        );
        return yield* pool.write(updated, update);
      }),
    [GATEWAY_METHOD.INSTALLED_SKILLS_SHARE]: declaredMethod(
      pool,
      skillShared(
        (share) => asked(client.share(share.workspaceId, share.skillId), whole),
        dependencies.accountId,
      ),
      (params: WireRecord) =>
        readParams(
          installedSkillShareParamsSchema,
          params,
          "a share names a workspace and a skill",
        ),
    ),
    [GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE]: declaredMethod(
      pool,
      skillRemoved((removal) => asked(client.remove(removal.skillId), whole)),
      (params: WireRecord) =>
        readParams(installedSkillIdParamsSchema, params, "a removal names a skill"),
    ),
  };

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  return { methods, lifetime: Effect.void, open: skills.open, reset: skills.end };
}

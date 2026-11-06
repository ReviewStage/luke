import type {
  HostedInstalledSkillClient,
  InstalledSkillCallResult,
} from "@repo/features/installed-skill-client";
import {
  INSTALLED_SKILL_CALL_FAILURE,
  type InstalledSkillContentView,
  type InstalledSkillFailedView,
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

export type InstalledSkillsClient = Pick<
  HostedInstalledSkillClient,
  "installedSkillsLive" | "read" | "preview" | "install" | "remove"
>;

export interface InstalledSkillsDependencies {
  kernel: Pick<HostKernel, "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  accountId: () => string | undefined;
  client: InstalledSkillsClient;
  pool: EntityPool;
}

export interface InstalledSkillsComposer extends Composer {
  readonly open: Effect.Effect<void>;
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;

function viewOf<Answer, View>(
  result: InstalledSkillCallResult<Answer>,
  shape: (answer: Answer) => View,
): View | InstalledSkillFailedView {
  if (result.ok) return shape(result.answer);
  const { failure, skillName } = result;
  return { failure, ...(skillName === undefined ? undefined : { skillName }) };
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

interface Held {
  readonly skills: HeldSlice<string>;
  readonly holds: FiberMap.FiberMap<string>;
}

function composed(
  dependencies: InstalledSkillsDependencies,
  gate: () => boolean,
  http: HttpClient.HttpClient,
  { skills, holds }: Held,
): InstalledSkillsComposer {
  const { client, pool } = dependencies;

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

  const methods: HostMethodTable = {
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
    [GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE]: declaredMethod(
      pool,
      skillRemoved((removal) => asked(client.remove(removal.skillId), whole)),
      (params: WireRecord) =>
        readParams(installedSkillIdParamsSchema, params, "a removal names a skill"),
    ),
  };

  return { methods, lifetime: Effect.void, open: skills.open, reset: skills.end };
}

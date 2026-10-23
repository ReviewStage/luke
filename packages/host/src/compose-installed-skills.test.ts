import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { InstalledSkillSummary } from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_FILES_REFUSAL } from "@luke/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@luke/features/installed-skill-wire";
import { SKILL_PASTE_KIND } from "@luke/features/skill-paste";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import type { WireRecord } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Effect } from "effect";
import { composeInstalledSkills, type InstalledSkillsClient } from "./compose-installed-skills.js";

/**
 * Settings › Skills' asks through the host as a window makes them, over a
 * scripted service: each answer reaches the window as its view, a refusal
 * with the skill it names and why its files were refused; behind a closed
 * account gate or on a run that sends nothing the service is never asked;
 * and params of the wrong shape are refused before anything travels.
 * Synthetic ids and names.
 */

const WORKSPACE_ID = "workspace-stage";
const SKILL_ID = "5d3c2b1a-0f9e-4d8c-b7a6-123456789abc";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const SKILL: InstalledSkillSummary = {
  id: SKILL_ID,
  scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
  name: "release-notes",
  description: "Write release notes from merged pull requests.",
  userInvocable: true,
  source: {
    type: INSTALLED_SKILL_SOURCE.GITHUB,
    owner: "acme",
    repo: "agent-skills",
    path: "skills/release-notes",
    ref: "main",
    sha: "3f9c2e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  },
  enabled: true,
  workspaceId: WORKSPACE_ID,
  installedBy: "user-dean",
  manageable: true,
  createdAt: 1,
  updatedAt: 1,
};

const CONTENT = {
  id: SKILL_ID,
  skillFile: "---\nname: release-notes\ndescription: Write release notes.\n---\n",
  files: [{ path: "SKILL.md", bytes: 58 }],
};

/** The service as a script: what it answers, and every call it was asked, in order. */
function fakeService(options: { refuseInstall?: boolean } = {}) {
  const asked: string[] = [];
  const client: InstalledSkillsClient = {
    list: (workspaceId) =>
      Effect.sync(() => {
        asked.push(`list:${workspaceId}`);
        return { ok: true as const, answer: [SKILL] };
      }),
    read: (skillId) =>
      Effect.sync(() => {
        asked.push(`read:${skillId}`);
        return { ok: true as const, answer: CONTENT };
      }),
    preview: (workspaceId) =>
      Effect.sync(() => {
        asked.push(`preview:${workspaceId}`);
        return { ok: true as const, answer: { kind: SKILL_PASTE_KIND.EMPTY } };
      }),
    install: (params) =>
      Effect.sync(() => {
        asked.push(`install:${params.scope}`);
        return options.refuseInstall
          ? {
              ok: false as const,
              failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
              skillName: "release-notes",
              skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
            }
          : { ok: true as const, answer: [SKILL] };
      }),
    setEnabled: (skillId, enabled) =>
      Effect.sync(() => {
        asked.push(`toggle:${skillId}:${enabled}`);
        return { ok: true as const, answer: { ...SKILL, enabled } };
      }),
    checkUpdate: (_workspaceId, skillId) =>
      Effect.sync(() => {
        asked.push(`check:${skillId}`);
        return { ok: true as const, answer: { available: true, latestSha: "abc" } };
      }),
    update: (_workspaceId, skillId) =>
      Effect.sync(() => {
        asked.push(`update:${skillId}`);
        return { ok: false as const, failure: INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED };
      }),
    share: (workspaceId, skillId) =>
      Effect.sync(() => {
        asked.push(`share:${workspaceId}:${skillId}`);
        return { ok: true as const, answer: SKILL };
      }),
    remove: (skillId) =>
      Effect.sync(() => {
        asked.push(`remove:${skillId}`);
        return { ok: true as const, answer: skillId };
      }),
  };
  return { client, asked };
}

function subject(
  options: { signedIn?: boolean; sendsNetwork?: boolean; refuseInstall?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const composer = yield* composeInstalledSkills({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked };
  });
}

const INSTALL = {
  text: "npx skills add acme/agent-skills",
  workspaceId: WORKSPACE_ID,
  scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
};

it.effect("each ask reaches the service and answers the window its view", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_LIST, { workspaceId: WORKSPACE_ID }),
      {
        skills: [SKILL],
      },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
      skills: [SKILL],
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, {
        skillId: SKILL_ID,
        enabled: false,
      }),
      { skill: { ...SKILL, enabled: false } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_CHECK_UPDATE, {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
      }),
      { available: true, latestSha: "abc" },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE, {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
      }),
      { failure: INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_READ, { skillId: SKILL_ID }),
      CONTENT,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_SHARE, {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
      }),
      { skill: SKILL },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE, { skillId: SKILL_ID }), {
      id: SKILL_ID,
    });
    assert.deepEqual(asked, [
      `list:${WORKSPACE_ID}`,
      `install:${INSTALLED_SKILL_SCOPE.WORKSPACE}`,
      `toggle:${SKILL_ID}:false`,
      `check:${SKILL_ID}`,
      `update:${SKILL_ID}`,
      `read:${SKILL_ID}`,
      `share:${WORKSPACE_ID}:${SKILL_ID}`,
      `remove:${SKILL_ID}`,
    ]);
  }),
);

it.effect("a refused install names the skill and why its files were refused", () =>
  Effect.gen(function* () {
    const { call } = yield* subject({ refuseInstall: true });

    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
      failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
      skillName: "release-notes",
      skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
    });
  }),
);

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { call, asked } = yield* subject(options);
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW, {
          workspaceId: WORKSPACE_ID,
          text: "x",
        }),
        { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED },
      );
      assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
        failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(asked, []);
    }
  }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, { skillId: "not-an-id", enabled: true }),
    );

    assert.equal(refused._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, []);
  }),
);

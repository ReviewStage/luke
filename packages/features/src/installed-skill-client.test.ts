import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import {
  HostedInstalledSkillClient,
  INSTALLED_SKILL_CALL_FAILURE,
} from "./installed-skill-client.js";
import { INSTALLED_SKILL_FILES_REFUSAL } from "./installed-skill-route-wire.js";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "./installed-skill-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * The window's installed skills calls against a scripted service: each
 * travels under the account's bearer to its own path, and a refusal is named
 * in the window's own words, a refused skill with its name and why.
 * Synthetic ids and words.
 */

const SKILL_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

const SUMMARY = {
  id: SKILL_ID,
  scope: INSTALLED_SKILL_SCOPE.PERSONAL,
  name: "review",
  description: "Review a pull request.",
  userInvocable: true,
  source: { type: INSTALLED_SKILL_SOURCE.TEXT },
  enabled: true,
  installedBy: "user-1",
  manageable: true,
  createdAt: 1,
  updatedAt: 2,
};

function client(): HostedInstalledSkillClient {
  return new HostedInstalledSkillClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("ada@example.com"),
    }),
  });
}

it.effect("each call goes to its own path under the account's bearer", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "GET /api/installed-skills": { answer: () => ({ skills: [SUMMARY] }) },
      "POST /api/installed-skills": { answer: () => ({ skills: [SUMMARY] }), status: 201 },
      [`PATCH /api/installed-skills/${SKILL_ID}`]: {
        answer: () => ({ skill: { ...SUMMARY, enabled: false } }),
      },
      [`GET /api/installed-skills/${SKILL_ID}/update`]: { answer: () => ({ available: false }) },
      [`DELETE /api/installed-skills/${SKILL_ID}`]: { answer: () => ({ id: SKILL_ID }) },
    });
    const ask = client();

    const listed = yield* Effect.provide(ask.list(WORKSPACE_ID), api.layer);
    const installed = yield* Effect.provide(
      ask.install({
        workspaceId: WORKSPACE_ID,
        scope: INSTALLED_SKILL_SCOPE.PERSONAL,
        text: "npx skills add acme/kit",
      }),
      api.layer,
    );
    const toggled = yield* Effect.provide(ask.setEnabled(SKILL_ID, false), api.layer);
    const checked = yield* Effect.provide(ask.checkUpdate(WORKSPACE_ID, SKILL_ID), api.layer);
    const removed = yield* Effect.provide(ask.remove(SKILL_ID), api.layer);

    assert.deepEqual(listed, { ok: true, answer: [SUMMARY] });
    assert.deepEqual(installed, { ok: true, answer: [SUMMARY] });
    assert.deepEqual(toggled, { ok: true, answer: { ...SUMMARY, enabled: false } });
    assert.deepEqual(checked, { ok: true, answer: { available: false } });
    assert.deepEqual(removed, { ok: true, answer: SKILL_ID });
    const [list, , toggle, check] = api.requests();
    assert.equal(new URL(list?.url ?? "").searchParams.get("workspaceId"), WORKSPACE_ID);
    assert.deepEqual(JSON.parse(toggle?.body ?? "{}"), { enabled: false });
    assert.equal(new URL(check?.url ?? "").searchParams.get("workspaceId"), WORKSPACE_ID);
    assert.deepEqual(new Set(api.credentials()), new Set(["token-1"]));
  }),
);

it.effect(
  "a refused skill is named with why its files were refused, and a refusal no call names is unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/installed-skills": {
          answer: () => ({
            error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
            skillName: "leaky",
            skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
          }),
          status: HTTP_STATUS.CONFLICT,
        },
        "POST /api/installed-skills/preview": {
          answer: () => ({ error: HOSTED_API_ERROR.AGENT_RETIRED }),
          status: HTTP_STATUS.CONFLICT,
        },
        [`POST /api/installed-skills/${SKILL_ID}/update`]: {
          answer: () => ({ error: HOSTED_API_ERROR.BRANCH_NOT_FOUND }),
          status: HTTP_STATUS.CONFLICT,
        },
      });
      const ask = client();

      const refused = yield* Effect.provide(
        ask.install({
          workspaceId: WORKSPACE_ID,
          scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
          text: "---\nname: leaky\n---",
        }),
        api.layer,
      );
      const unnamed = yield* Effect.provide(ask.preview(WORKSPACE_ID, "anything"), api.layer);
      const moved = yield* Effect.provide(ask.update(WORKSPACE_ID, SKILL_ID), api.layer);

      assert.deepEqual(refused, {
        ok: false,
        failure: INSTALLED_SKILL_CALL_FAILURE.FILES_REFUSED,
        skillName: "leaky",
        skillRefusal: INSTALLED_SKILL_FILES_REFUSAL.CREDENTIAL_SHAPED,
      });
      assert.deepEqual(unnamed, { ok: false, failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(moved, { ok: false, failure: INSTALLED_SKILL_CALL_FAILURE.REF_NOT_FOUND });
    }),
);

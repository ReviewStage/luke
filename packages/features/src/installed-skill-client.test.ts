import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@repo/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { HostedInstalledSkillClient } from "./installed-skill-client.js";
import { INSTALLED_SKILL_CALL_FAILURE } from "./installed-skill-view.js";
import {
  INSTALLED_SKILL_REFUSAL,
  INSTALLED_SKILL_SCOPE,
  INSTALLED_SKILL_SOURCE,
} from "./installed-skill-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

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

const CONTENT = {
  id: SKILL_ID,
  skillFile: "---\nname: review\ndescription: Review a pull request.\n---\n",
  files: [{ path: "SKILL.md", bytes: 55 }],
};

function client(): HostedInstalledSkillClient {
  return new HostedInstalledSkillClient({
    serviceBaseUrl: "https://vespin.dev",
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
      "POST /api/installed-skills": { answer: () => ({ skills: [SUMMARY] }), status: 201 },
      [`DELETE /api/installed-skills/${SKILL_ID}`]: { answer: () => ({ id: SKILL_ID }) },
      [`GET /api/installed-skills/${SKILL_ID}`]: { answer: () => CONTENT },
    });
    const ask = client();

    const installed = yield* Effect.provide(
      ask.install({
        workspaceId: WORKSPACE_ID,
        scope: INSTALLED_SKILL_SCOPE.PERSONAL,
        text: "npx skills add acme/kit",
      }),
      api.layer,
    );
    const removed = yield* Effect.provide(ask.remove(SKILL_ID), api.layer);
    const read = yield* Effect.provide(ask.read(SKILL_ID), api.layer);

    assert.deepEqual(installed, { ok: true, answer: { skills: [SUMMARY] } });
    assert.deepEqual(removed, { ok: true, answer: { id: SKILL_ID } });
    assert.deepEqual(read, { ok: true, answer: CONTENT });
    assert.deepEqual(new Set(api.credentials()), new Set(["token-1"]));
  }),
);

it.effect(
  "a refused skill is answered by why, with its name, and a refusal no call names is unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/installed-skills": {
          answer: () => ({
            error: HOSTED_API_ERROR.SKILL_FILES_REFUSED,
            skillName: "leaky",
            skillRefusal: INSTALLED_SKILL_REFUSAL.CREDENTIAL,
          }),
          status: HTTP_STATUS.CONFLICT,
        },
        "POST /api/installed-skills/preview": {
          answer: () => ({ error: HOSTED_API_ERROR.AGENT_RETIRED }),
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

      assert.deepEqual(refused, {
        ok: false,
        failure: INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL,
        skillName: "leaky",
      });
      assert.deepEqual(unnamed, { ok: false, failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED });
    }),
);

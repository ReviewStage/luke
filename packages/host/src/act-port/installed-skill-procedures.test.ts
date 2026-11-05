import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import { Effect } from "effect";
import { type ActPortClient, INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import { installedSkillProcedures } from "./installed-skill-procedures.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * Settings › Skills' acts through the act port as a window calls them: a
 * panel's Try again, install, and removal reach the host with what the page
 * names and hear its answer; any other window, and a frame this build does not
 * trust, are refused in each kind's own words before the host is asked;
 * and a payload off the kind's schema is refused at the port. Synthetic ids.
 */

const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const WORKSPACE_ID = "workspace-stage";

const RETRY_REFUSAL = "Could not read your skills again on this system.";
const INSTALL_REFUSAL = "Could not install the skill on this system.";
const REMOVE_REFUSAL = "Could not remove the skill on this system.";

const SKILL_ID = "5d3c2b1a-0f9e-4d8c-b7a6-123456789abc";

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** A window's act port over a host answering as told, and what it was asked, in order. */
function windowPort(actor: ActSender, options: { trusted?: boolean } = {}) {
  const asked: string[] = [];
  const refused = { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED } as const;
  const port = testActPort<unknown>(
    installedSkillProcedures({
      host: {
        installedSkillsFollow: () => Effect.void,
        installedSkillsUnfollow: () => Effect.void,
        installedSkillsRetry: ({ workspaceId }) =>
          Effect.sync(() => {
            asked.push(`retry:${workspaceId}`);
          }),
        installedSkillsRead: () => Effect.succeed(refused),
        installedSkillsPreview: () => Effect.succeed(refused),
        installedSkillsInstall: ({ scope }) =>
          Effect.sync(() => {
            asked.push(`install:${scope}`);
            return { skills: [] };
          }),
        installedSkillsRemove: ({ skillId }) =>
          Effect.sync(() => {
            asked.push(`remove:${skillId}`);
            return refused;
          }),
      },
    }),
  );
  ports.push(port);
  const client: ActPortClient = port.as(actor, { trusted: options.trusted ?? true });
  return {
    retry: () =>
      settledAct(
        client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY]({ workspaceId: WORKSPACE_ID }),
      ),
    install: () =>
      settledAct(
        client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_INSTALL]({
          text: "npx skills add acme/agent-skills",
          workspaceId: WORKSPACE_ID,
          scope: INSTALLED_SKILL_SCOPE.PERSONAL,
        }),
      ),
    remove: (skillId = SKILL_ID) =>
      // SAFETY: an id is sent as a window might send it, one the kind's schema may refuse.
      settledAct(client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_REMOVE]({ skillId } as never)),
    asked,
  };
}

it("a panel's Try again, install, and removal reach the host with what the page names, and it hears the answer", async () => {
  const { retry, install, remove, asked } = windowPort(PANEL);

  assert.deepEqual(await retry(), { answer: undefined });
  assert.deepEqual(await install(), { answer: { skills: [] } });
  assert.deepEqual(await remove(), {
    answer: { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED },
  });
  assert.deepEqual(asked, [
    `retry:${WORKSPACE_ID}`,
    `install:${INSTALLED_SKILL_SCOPE.PERSONAL}`,
    `remove:${SKILL_ID}`,
  ]);
});

it("a window that is not a panel, and a frame this build does not trust, are refused in each kind's own words, and the host is not asked", async () => {
  for (const { actor, trusted } of [
    { actor: OTHER_WINDOW, trusted: true },
    { actor: PANEL, trusted: false },
  ]) {
    const { retry, install, remove, asked } = windowPort(actor, { trusted });
    assert.deepEqual(await retry(), { refused: RETRY_REFUSAL });
    assert.deepEqual(await install(), { refused: INSTALL_REFUSAL });
    assert.deepEqual(await remove(), { refused: REMOVE_REFUSAL });
    assert.deepEqual(asked, []);
  }
});

it("a removal naming no skill id is refused at the port before the host is asked", async () => {
  const { remove, asked } = windowPort(PANEL);

  assert.deepEqual(await remove("not-an-id"), { refused: REMOVE_REFUSAL });
  assert.deepEqual(asked, []);
});

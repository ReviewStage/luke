import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { InstalledSkillListView } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_CALL_FAILURE } from "@luke/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE } from "@luke/features/installed-skill-wire";
import { Effect } from "effect";
import { type ActPortClient, INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import { installedSkillProcedures } from "./installed-skill-procedures.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * Settings › Skills' acts through the act port as a window calls them: a
 * panel's list and install reach the host with what the page names and hear
 * its answer; the voice and call windows, and a frame this build does not
 * trust, are refused in each kind's own words before the host is asked;
 * and a payload off the kind's schema is refused at the port. Synthetic ids.
 */

const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const WORKSPACE_ID = "workspace-stage";

const LIST_REFUSAL = "Could not read your skills on this system.";
const INSTALL_REFUSAL = "Could not install the skill on this system.";
const TOGGLE_REFUSAL = "Could not turn the skill on or off on this system.";

const NOTHING: InstalledSkillListView = { skills: [] };

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
        installedSkillsList: ({ workspaceId }) =>
          Effect.sync(() => {
            asked.push(`list:${workspaceId}`);
            return NOTHING;
          }),
        installedSkillsPreview: () => Effect.succeed(refused),
        installedSkillsPreviewFile: () => Effect.succeed(refused),
        installedSkillsInstall: ({ scope }) =>
          Effect.sync(() => {
            asked.push(`install:${scope}`);
            return { skills: [] };
          }),
        installedSkillsSetEnabled: ({ skillId }) =>
          Effect.sync(() => {
            asked.push(`toggle:${skillId}`);
            return refused;
          }),
        installedSkillsCheckUpdate: () => Effect.succeed(refused),
        installedSkillsUpdate: () => Effect.succeed(refused),
        installedSkillsRemove: () => Effect.succeed(refused),
      },
    }),
  );
  ports.push(port);
  const client: ActPortClient = port.as(actor, { trusted: options.trusted ?? true });
  return {
    list: () =>
      settledAct(
        client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_LIST]({ workspaceId: WORKSPACE_ID }),
      ),
    install: () =>
      settledAct(
        client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_INSTALL]({
          text: "npx skills add acme/agent-skills",
          workspaceId: WORKSPACE_ID,
          scope: INSTALLED_SKILL_SCOPE.PERSONAL,
        }),
      ),
    toggle: (skillId: string) =>
      // SAFETY: an id is sent as a window might send it, one the kind's schema may refuse.
      settledAct(
        client[INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_SET_ENABLED]({
          skillId,
          enabled: true,
        } as never),
      ),
    asked,
  };
}

it("a panel's list and install reach the host with what the page names, and it hears the answer", async () => {
  const { list, install, asked } = windowPort(PANEL);

  assert.deepEqual(await list(), { answer: NOTHING });
  assert.deepEqual(await install(), { answer: { skills: [] } });
  assert.deepEqual(asked, [`list:${WORKSPACE_ID}`, `install:${INSTALLED_SKILL_SCOPE.PERSONAL}`]);
});

it("the voice and call windows, and a frame this build does not trust, are refused in each kind's own words, and the host is not asked", async () => {
  for (const { actor, trusted } of [
    { actor: VOICE, trusted: true },
    { actor: CALL, trusted: true },
    { actor: PANEL, trusted: false },
  ]) {
    const { list, install, asked } = windowPort(actor, { trusted });
    assert.deepEqual(await list(), { refused: LIST_REFUSAL });
    assert.deepEqual(await install(), { refused: INSTALL_REFUSAL });
    assert.deepEqual(asked, []);
  }
});

it("a toggle naming no skill id is refused at the port before the host is asked", async () => {
  const { toggle, asked } = windowPort(PANEL);

  assert.deepEqual(await toggle("not-an-id"), { refused: TOGGLE_REFUSAL });
  assert.deepEqual(asked, []);
});

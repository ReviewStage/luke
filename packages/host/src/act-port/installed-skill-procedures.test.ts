import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { installedSkillProcedures } from "./installed-skill-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * Settings › Skills' acts through the act port as a window calls them: a
 * panel's Try again reaches the host with the workspace the page names; and
 * any other window, and a frame this build does not trust, are refused each
 * kind in its own words before the host or the service is asked. Synthetic
 * ids.
 */

const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const WORKSPACE_ID = "workspace-stage";

const SKILL_ID = "5d3c2b1a-0f9e-4d8c-b7a6-123456789abc";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY]:
    "Could not read your skills again on this system.",
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_READ]: "Could not read the skill on this system.",
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_PREVIEW]:
    "Could not read what that paste would install on this system.",
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_INSTALL]:
    "Could not install the skill on this system.",
  [INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_REMOVE]: "Could not remove the skill on this system.",
} as const;

/** One ask of each kind, with a payload its schema takes. */
const ASKS: readonly {
  readonly kind: keyof typeof REFUSAL;
  readonly payload: WireBoundaryInput;
}[] = [
  {
    kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY,
    payload: { workspaceId: WORKSPACE_ID },
  },
  { kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_READ, payload: { skillId: SKILL_ID } },
  {
    kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_PREVIEW,
    payload: { workspaceId: WORKSPACE_ID, text: "npx skills add acme/agent-skills" },
  },
  {
    kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_INSTALL,
    payload: {
      text: "npx skills add acme/agent-skills",
      workspaceId: WORKSPACE_ID,
      scope: INSTALLED_SKILL_SCOPE.PERSONAL,
    },
  },
  { kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_REMOVE, payload: { skillId: SKILL_ID } },
];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** The Try again's act port over a host that writes down what it was asked, in order. */
function retryPort() {
  const asked: string[] = [];
  const port = testActPort<unknown>(
    installedSkillProcedures({
      host: {
        installedSkillsFollow: () => Effect.void,
        installedSkillsUnfollow: () => Effect.void,
        installedSkillsRetry: ({ workspaceId }) =>
          Effect.sync(() => {
            asked.push(`retry:${workspaceId}`);
          }),
      },
    }),
  );
  ports.push(port);
  return { port, asked };
}

it.effect("a panel's Try again reaches the host with the workspace the page names", () =>
  Effect.gen(function* () {
    const { port, asked } = retryPort();

    assert.deepEqual(
      yield* port.perform(
        {
          kind: INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY,
          payload: { workspaceId: WORKSPACE_ID },
        },
        PANEL,
      ),
      { answer: undefined },
    );
    assert.deepEqual(asked, [`retry:${WORKSPACE_ID}`]);
  }),
);

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every skills act in the kind's own words, and neither the host nor the service is asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const retries = retryPort();
      const refused = [];
      for (const ask of ASKS) {
        const served =
          ask.kind === INSTALLED_SKILL_ACT_KIND.INSTALLED_SKILLS_RETRY ? retries.port : port;
        refused.push(yield* served.perform(ask, OTHER_WINDOW));
        refused.push(yield* served.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.deepEqual(retries.asked, []);
      assert.deepEqual(requests, []);
    }),
);

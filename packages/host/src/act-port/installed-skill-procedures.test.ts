import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INSTALLED_SKILL_SCOPE } from "@repo/features/installed-skill-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { INSTALLED_SKILL_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";

/**
 * Settings › Skills' acts through the act port as a window calls them: any
 * window but a panel, and a frame this build does not trust, are refused
 * each kind in its own words before the service is asked. The skills' live
 * follow is held in `live-follows.test.ts`. Synthetic ids.
 */

const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const WORKSPACE_ID = "workspace-stage";

const SKILL_ID = "5d3c2b1a-0f9e-4d8c-b7a6-123456789abc";

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
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

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every skills act in the kind's own words, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const refused = [];
      for (const ask of ASKS) {
        refused.push(yield* port.perform(ask, OTHER_WINDOW));
        refused.push(yield* port.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.deepEqual(requests, []);
    }),
);

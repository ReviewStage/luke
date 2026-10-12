// demo.tsx -- SPIKE: the real plan document in a browser page, edited in place, over a fake service that merges as the real one does.

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { applyDeveloperEdit, type PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { EMPTY_PLAN_FIELDS, type PlanContent, planBody } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, type Plan, type PlanFields } from "@sidecar/hosted/plan-wire";
import type { PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlanBody } from "../planning/plan-body";
import { rendererRegistry } from "../renderer-runtime";

/**
 * SPIKE, not production code. Built from this branch the page edits in
 * place on TipTap; built from a `main` checkout it is today's text boxes.
 * `?long=1` grows the plan to sixty
 * rules and long fields for the latency runs. `window.spike` lets the
 * headless driver play Luke: `lukeWrites(field, text)` is a notetaker save
 * landing on a text field, `lukeDraft(field, text)` a live draft frame.
 */

const RULES: PlanFields["rules"] = [
  {
    statement: "Any member may invite by email.",
    examples: [
      {
        given: "A member invites `dana@example.com`",
        when: "Dana opens the link",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template.
        then: "Dana joins the workspace as a **member**", // oxlint-disable-line unicorn/no-thenable -- the same key.
      },
    ],
  },
  {
    statement: "A withdrawn or accepted invite link never grants access again.",
    examples: [
      {
        given: "An invite Dana already accepted",
        when: "anyone opens its link again",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template.
        then: 'the page reads "This invite is no longer valid"', // oxlint-disable-line unicorn/no-thenable -- the same key.
      },
    ],
  },
];

const FIELDS: PlanFields = {
  ...EMPTY_PLAN_FIELDS,
  goal: {
    problem:
      "Only an admin can add someone to a workspace, by creating their account by hand, so " +
      "members wait on an admin to bring a teammate in. See the [support thread](https://example.com/t/42).",
    outcome: "A member invites a teammate by email; the teammate joins by *opening the link*.",
  },
  scope: {
    included: "- Inviting by email\n- Accepting an invite\n- Withdrawing an invite",
    excluded: "- SSO provisioning\n- Bulk CSV import",
    constraints: null,
  },
  rules: RULES,
  implementation: {
    ...EMPTY_PLAN_FIELDS.implementation,
    changeMap:
      "- `src/db/schema/memberships.ts`: a `pending` state.\n" +
      "- `src/members/invite.ts`: new, sending and accepting an invite.",
    contracts:
      "```ts\nexport function invite(by: Member, email: string): Effect<Invite, InviteError>\n```",
  },
  decisions:
    "Model an invite as a `memberships` row with `state = pending`. Why: removal covers " +
    "invites and members alike.\n\n## Rejected\n\n- A separate `invitations` table.",
  verification:
    "1. Invite a teammate from the members page.\n2. Open the link in a private window.",
  openQuestions: ["Who can withdraw an invite: the member who sent it, any admin, or *both*?"],
};

/** The plan grown for the latency runs: sixty rules and long text fields. */
function longFields(): PlanFields {
  const paragraph =
    "The invite flow reads the membership row under a lock, writes the pending state, and " +
    "sends the email through the `mailer` queue so a slow provider never holds the request. ";
  const rules = Array.from({ length: 60 }, (_, index) => ({
    statement: `Rule ${index + 1}: an invite in state ${index} never grants more than a member's role.`,
    examples: [
      {
        given: `A member invites user${index}@example.com`,
        when: "the invitee opens the link",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template.
        then: "the invitee joins as a member", // oxlint-disable-line unicorn/no-thenable -- the same key.
      },
    ],
  }));
  return {
    ...FIELDS,
    goal: { ...FIELDS.goal, problem: Array.from({ length: 30 }, () => paragraph).join("\n\n") },
    rules,
    decisions: Array.from({ length: 20 }, () => paragraph).join("\n\n"),
  };
}

const NAME = "Teammate invitations";
const PLAN_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

function planOf(content: PlanContent, at: number, actor: Plan["lastEdit"]): Plan {
  const plan: Plan = {
    id: PLAN_ID,
    name: NAME,
    createdAt: 1,
    updatedAt: at,
    repository: "acme/relay",
    document: { body: planBody({ name: NAME }, content.fields), assumptions: content.assumptions },
    fields: content.fields,
  };
  return actor === undefined ? plan : { ...plan, lastEdit: actor };
}

const params = new URLSearchParams(window.location.search);
/** The stored content the fake service holds, which the driver reads. */
let stored: PlanContent = {
  fields: params.get("long") === "1" ? longFields() : FIELDS,
  assumptions: [
    { text: "Invites reuse memberships with a pending state." },
    { text: "An invite expires after 7 days." },
  ],
};

function Demo(): React.JSX.Element {
  const [plan, setPlan] = useState(() => planOf(stored, Date.now(), undefined));
  const show = (content: PlanContent, actor: (typeof PLAN_ACTOR)[keyof typeof PLAN_ACTOR]) => {
    stored = content;
    const at = Date.now();
    setPlan(planOf(content, at, { actor, at, duringCall: true }));
  };
  const edit = async (request: PlanEditRequest): Promise<PlanningEditAnswer> => {
    const outcome = applyDeveloperEdit(stored, request);
    if ("conflict" in outcome) return { conflict: outcome.conflict };
    show(outcome.applied, PLAN_ACTOR.DEVELOPER);
    return { saved: true };
  };
  Object.assign(window, {
    spike: {
      content: () => stored,
      lukeWrites: (field: "decisions" | "verification", text: string) =>
        show({ ...stored, fields: { ...stored.fields, [field]: text } }, PLAN_ACTOR.NOTETAKER),
      lukeDraft: (field: "decisions" | "verification", text: string) =>
        setPlan((now) => ({
          ...now,
          document: {
            ...now.document,
            body: planBody({ name: NAME }, { ...stored.fields, [field]: text }),
          },
        })),
    },
  });
  return (
    <section className="desktop-document spike-demo" aria-label={NAME}>
      <PlanBody plan={plan} live={false} onEdit={edit} />
    </section>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("no root");
createRoot(rootElement).render(
  <RegistryContext.Provider value={rendererRegistry}>
    <Demo />
  </RegistryContext.Provider>,
);

import assert from "node:assert/strict";
import { EMPTY_PLAN_FIELDS, planBody } from "@sidecar/hosted/plan-template";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  type CallStatus,
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  type CopyShown,
  DOCUMENT_REGION,
  NO_ASSUMPTIONS_LINE,
} from "./planning-model";
import { MicrophoneRow, PlanDocumentView, PlanList } from "./planning-parts";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: {
    body: "# Teammate invitations\n\n## Goal\nInvite a teammate by email.",
    assumptions: [
      { text: "Members and admins can both invite." },
      { text: "An invite expires after 7 days." },
    ],
  },
};

const ignore = () => undefined;

const RESTING = { shown: COPY_SHOWN.IDLE, onPress: ignore };

function documentMarkup(plan: Plan, copied: CopyShown = COPY_SHOWN.IDLE): string {
  return renderToStaticMarkup(
    createElement(PlanDocumentView, {
      region: { kind: DOCUMENT_REGION.READY, plan },
      onRetry: ignore,
      onBack: ignore,
      live: false,
      copy: { shown: copied, onPress: ignore },
    }),
  );
}

test("the saved body is drawn as Markdown under the plan's name and repository line", () => {
  const markup = documentMarkup({ ...PLAN, repository: "acme/relay" });

  assert.match(markup, /<h1 class="plan-title">Teammate invitations<\/h1>/u);
  assert.match(markup, /<p class="plan-repository">acme\/relay<\/p>/u);
  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("a plan with no repository yet draws no repository line", () => {
  const markup = documentMarkup(PLAN);

  assert.doesNotMatch(markup, /plan-repository/u);
});

test("each assumption is a list item holding its text and nothing to click", () => {
  const markup = documentMarkup(PLAN);

  const rows = markup.match(/<li class="plan-assumption">[\s\S]*?<\/li>/gu) ?? [];
  assert.deepEqual(
    rows,
    PLAN.document.assumptions.map(({ text }) => `<li class="plan-assumption">${text}</li>`),
  );
  assert.doesNotMatch(markup, /type="checkbox"|Confirmed/u);
});

test("the document offers no way to write, confirm, or approve anything", () => {
  const markup = documentMarkup(PLAN);

  assert.doesNotMatch(markup, /<textarea|contenteditable|type="text"/u);
  // Copy is the document's one action, and it writes nothing; Back only
  // leaves it.
  const buttons = markup.match(/<button[^>]*>/gu) ?? [];
  assert.deepEqual(buttons, [
    '<button type="button" class="icon-button plan-back" aria-label="Back to plans" title="Back">',
    '<button type="button" class="plan-button plan-copy-button">',
  ]);
  assert.doesNotMatch(markup, /Approve|Version|History|Ready/u);
});

test("a new plan draws its whole template unanswered, and an assumptions section that says none is recorded", () => {
  const body = planBody(PLAN, EMPTY_PLAN_FIELDS);
  const markup = documentMarkup({ ...PLAN, document: { body, assumptions: [] } });

  const sections = [
    ...markup.matchAll(/<p class="markdown-heading" data-level="2">([^<]*)<\/p>/gu),
  ];
  assert.deepEqual(
    sections.map((match) => match[1]),
    [
      "Goal",
      "Scope",
      "Rules",
      "Implementation",
      "Decisions",
      "Verification",
      "Left to the agent",
      "Open questions",
    ],
  );
  assert.match(markup, /<em>Unanswered<\/em>/u);
  assert.match(
    markup,
    new RegExp(
      `<h2 class="plan-assumptions-heading">Assumptions</h2><p class="plan-assumptions-none">${NO_ASSUMPTIONS_LINE}</p>`,
      "u",
    ),
  );
});

test("Copy stands in the header, enabled", () => {
  const header = documentMarkup(PLAN).match(/<header class="plan-header">[\s\S]*?<\/header>/u);
  const button = header?.[0].match(/<button[^>]*class="plan-button plan-copy-button"[^>]*>/u);
  assert.ok(button);
  assert.doesNotMatch(button[0], /disabled/u);
});

test("Copy shows the check mark once copied, and the failure in words when the clipboard refused", () => {
  assert.match(documentMarkup(PLAN), /<\/svg>Copy<\/button>/u);
  assert.match(
    documentMarkup(PLAN, COPY_SHOWN.COPIED),
    /data-copied="true"[\s\S]*Copied<\/button>/u,
  );

  const failed = documentMarkup(PLAN, COPY_SHOWN.FAILED);
  assert.ok(failed.includes(`role="alert">${COPY_FAILED_NOTE}</p>`));
  assert.doesNotMatch(documentMarkup(PLAN), /role="alert"/u);
});

test("a document that could not be read shows the failure and Try again, never a document", () => {
  const markup = renderToStaticMarkup(
    createElement(PlanDocumentView, {
      region: { kind: DOCUMENT_REGION.FAILED },
      onRetry: ignore,
      onBack: ignore,
      live: false,
      copy: RESTING,
    }),
  );

  assert.match(markup, /could not be read/u);
  assert.match(markup, />Try again<\/button>/u);
  assert.doesNotMatch(markup, /plan-body/u);
});

test("the plan list marks the open plan and names each one's repository", () => {
  const second = {
    ...PLAN,
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    name: "Billing export",
    repository: "acme/relay",
  };
  const markup = renderToStaticMarkup(
    createElement(PlanList, {
      plans: [PLAN, second],
      activePlanId: second.id,
      failed: false,
      onSelect: ignore,
      onRetry: ignore,
      onNewPlan: ignore,
    }),
  );

  const rows =
    markup.match(/<button type="button" class="plan-list-row"[\s\S]*?<\/button>/gu) ?? [];
  assert.equal(rows.length, 2);
  assert.doesNotMatch(rows[0] ?? "", /aria-current/u);
  assert.match(rows[1] ?? "", /aria-current="true"/u);
  assert.match(rows[1] ?? "", /Billing export[\s\S]*acme\/relay/u);
  assert.match(markup, /<\/svg>New plan<\/button>/u);
});

function microphoneRowMarkup(
  status: CallStatus,
  call: { muted: boolean; stop: boolean } = { muted: false, stop: false },
): string {
  return renderToStaticMarkup(
    createElement(MicrophoneRow, {
      status,
      microphone: {
        label: call.muted ? "Unmute the microphone" : "Mute the microphone",
        enabled: true,
        muted: call.muted,
        onPress: ignore,
      },
      stop: { shown: call.stop, onPress: ignore },
    }),
  );
}

const IDLE_BACKEND = { planner: undefined, notes: false };

test("a muted call presses the microphone and offers a stop apart from it, and no call offers no stop", () => {
  const muted = microphoneRowMarkup(
    { voiceWord: "Muted", backend: IDLE_BACKEND },
    { muted: true, stop: true },
  );
  assert.match(muted, /aria-label="Unmute the microphone"[^>]*aria-pressed="true"/u);
  assert.match(muted, /<button[^>]*class="plan-stop"[^>]*aria-label="End the call"/u);

  const heard = microphoneRowMarkup({ voiceWord: "Listening", backend: IDLE_BACKEND });
  assert.match(heard, /aria-pressed="false"/u);
  assert.doesNotMatch(heard, /plan-stop/u);
});

test("the microphone row's second line names the planning model's command and the notetaker, with the dots and a reader's status line", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Listening",
    backend: { planner: { action: "grep -rn invite src" }, notes: true },
  });
  assert.match(markup, /class="plan-voice-word">Listening</u);
  assert.match(markup, /class="thinking-dots" aria-hidden="true"/u);
  assert.match(
    markup,
    /Planning model · <span class="plan-backend-action">grep -rn invite src<\/span>/u,
  );
  assert.match(markup, />Notetaker · Writing notes</u);
  assert.match(markup, /role="status">Luke is working on it</u);
});

test("the planning model with no command pending reads Thinking", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Handing off",
    backend: { planner: { action: undefined }, notes: false },
  });
  assert.match(markup, />Planning model · Thinking</u);
  assert.doesNotMatch(markup, /Notetaker/u);
});

test("an idle backend draws the voice's word alone, with no dots and no status line", () => {
  const markup = microphoneRowMarkup({
    voiceWord: "Listening",
    backend: { planner: undefined, notes: false },
  });
  assert.match(markup, /class="plan-voice-word">Listening</u);
  assert.doesNotMatch(markup, /thinking-dots/u);
  assert.doesNotMatch(markup, /role="status"/u);
});

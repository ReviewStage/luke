import assert from "node:assert/strict";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  COPY_FAILED_NOTE,
  COPY_SHOWN,
  type CopyShown,
  DOCUMENT_REGION,
  EMPTY_PLAN_LINE,
} from "./planning-model";
import { PlanDocumentView, PlanList } from "./planning-parts";
import {
  REPOSITORY_LIST,
  readRepositoryList,
  SetupSheetView,
  type SetupSheetViewProps,
} from "./setup-sheet";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
  },
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: {
    body: "# Teammate invitations\n\n## Goal\nInvite a teammate by email.",
    assumptions: [
      { text: "Members and admins can both invite.", confirmed: true },
      { text: "An invite expires after 7 days.", confirmed: false },
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
      copy: { shown: copied, onPress: ignore },
    }),
  );
}

test("the saved body is drawn as Markdown under the plan's name and repository line", () => {
  const markup = documentMarkup(PLAN);

  assert.match(markup, /<h1 class="plan-title">Teammate invitations<\/h1>/u);
  assert.match(markup, /acme\/relay · main @ 4f2c9e1/u);
  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

test("each assumption is a checkbox that cannot be clicked, its text, and its saved flag in words", () => {
  const markup = documentMarkup(PLAN);

  const rows = markup.match(/<li class="plan-assumption"[\s\S]*?<\/li>/gu) ?? [];
  assert.equal(rows.length, 2);
  assert.match(rows[0] ?? "", /data-confirmed="true"/u);
  assert.match(
    rows[0] ?? "",
    /<input type="checkbox" disabled="" readOnly="" tabindex="-1" checked=""\/>/u,
  );
  assert.match(rows[0] ?? "", />Confirmed</u);
  assert.match(rows[1] ?? "", /<input type="checkbox" disabled="" readOnly="" tabindex="-1"\/>/u);
  assert.match(rows[1] ?? "", />Not confirmed</u);
});

test("the document offers no way to write, confirm, or approve anything", () => {
  const markup = documentMarkup(PLAN);

  assert.doesNotMatch(markup, /<textarea|contenteditable|type="text"/u);
  // Copy is the document's one action, and it writes nothing.
  const buttons = markup.match(/<button[^>]*>/gu) ?? [];
  assert.deepEqual(buttons, ['<button type="button" class="plan-button plan-copy-button">']);
  assert.doesNotMatch(markup, /Approve|Version|History|Ready/u);
});

test("an empty plan shows the one line that says how to begin, and no assumption section", () => {
  const markup = documentMarkup({ ...PLAN, document: { body: "", assumptions: [] } });

  assert.match(markup, new RegExp(EMPTY_PLAN_LINE, "u"));
  assert.doesNotMatch(markup, /Assumptions/u);
});

test("Copy stands in the header, enabled, whatever the assumptions' flags say", () => {
  const unconfirmed: Plan = {
    ...PLAN,
    document: {
      body: PLAN.document.body,
      assumptions: PLAN.document.assumptions.map((assumption) => ({
        ...assumption,
        confirmed: false,
      })),
    },
  };

  for (const plan of [PLAN, unconfirmed]) {
    const header = documentMarkup(plan).match(/<header class="plan-header">[\s\S]*?<\/header>/u);
    const button = header?.[0].match(/<button[^>]*class="plan-button plan-copy-button"[^>]*>/u);
    assert.ok(button);
    assert.doesNotMatch(button[0], /disabled/u);
  }
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
      copy: RESTING,
    }),
  );

  assert.match(markup, /could not be read/u);
  assert.match(markup, />Try again<\/button>/u);
  assert.doesNotMatch(markup, /plan-body/u);
});

test("the plan list marks the open plan and names each one's repository", () => {
  const second = { ...PLAN, id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", name: "Billing export" };
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
  assert.match(markup, />New plan<\/button>/u);
});

function sheet(patch: Partial<SetupSheetViewProps>): string {
  const props: SetupSheetViewProps = {
    name: "",
    filter: "",
    chosen: undefined,
    list: { status: REPOSITORY_LIST.READING },
    starting: false,
    note: undefined,
    onName: ignore,
    onFilter: ignore,
    onChoose: ignore,
    onConnect: ignore,
    onRetryList: ignore,
    onStart: ignore,
    onCancel: ignore,
    ...patch,
  };
  return renderToStaticMarkup(createElement(SetupSheetView, props));
}

test("an account with no GitHub connection is offered Connect GitHub in place of the list", () => {
  const markup = sheet({
    list: { status: REPOSITORY_LIST.FAILED, failure: GITHUB_FAILURE.NOT_CONNECTED },
  });

  assert.match(markup, />Connect GitHub<\/button>/u);
  assert.doesNotMatch(markup, /type="radio"/u);
});

test("Start plan waits for both a name and a repository", () => {
  const list = {
    status: REPOSITORY_LIST.READY,
    repositories: [{ owner: "acme", name: "relay", private: true }],
    truncated: false,
  } as const;
  const startButton =
    /<button type="submit" class="plan-button plan-button-primary"( disabled="")?>/u;

  assert.equal(sheet({ list, name: "Invites" }).match(startButton)?.[1], ' disabled=""');
  assert.equal(
    sheet({ list, chosen: { owner: "acme", name: "relay" } }).match(startButton)?.[1],
    ' disabled=""',
  );
  const ready = sheet({ list, name: "Invites", chosen: { owner: "acme", name: "relay" } });
  assert.equal(ready.match(startButton)?.[1], undefined);
  assert.match(ready, /acme\/relay[\s\S]*Private/u);
});

test("a refused start keeps the sheet open with the reason", () => {
  const markup = sheet({
    note: "That repository has no commits on its default branch to plan against.",
  });

  assert.match(markup, /role="alert">That repository has no commits/u);
  assert.match(markup, />Start plan<\/button>/u);
});

test("a repository read the system refused offers Try again rather than reading forever", async () => {
  const list = await readRepositoryList(() =>
    Promise.reject(new Error("Could not read your GitHub repositories on this system.")),
  );
  const markup = sheet({ list });

  assert.doesNotMatch(markup, /Reading your repositories/u);
  assert.match(markup, />Try again<\/button>/u);
});

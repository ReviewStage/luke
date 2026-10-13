import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { PlanBody } from "./plan-body";

const PLAN: Plan = {
  ...DOCUMENT_PLAN,
  document: { body: "## Goal\nInvite a teammate by email.", assumptions: [] },
};

function bodyMarkup(plan: Plan): string {
  return renderToStaticMarkup(createElement(PlanBody, { plan, live: false }));
}

test("the saved body is drawn as Markdown", () => {
  const markup = bodyMarkup(PLAN);

  assert.match(markup, /<p class="markdown-heading" data-level="2">Goal<\/p>/u);
  assert.match(markup, /Invite a teammate by email\./u);
});

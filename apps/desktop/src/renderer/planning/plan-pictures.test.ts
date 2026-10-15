// @vitest-environment jsdom

import assert from "node:assert/strict";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { PLAN_ACTOR, type Plan } from "@luke/features/plan-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_PLAN } from "#testing/document-plan";
import { MarkdownMessage } from "../markdown-message";
import { useConfirmDialog } from "../settings/confirm-dialog";
import { PlanBody } from "./plan-body";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * plan-pictures.test.ts -- a plan's pictures where its words are drawn: each
 * read through the host and drawn from its bytes with its caption, one this
 * reader cannot reach drawn as its words, one from outside Luke a link that
 * reads nothing, a press opening the plan's pictures over the window, and a
 * version drawing a picture it struck and the one it wrote in, each marked.
 * Synthetic plans and pictures.
 */

/** A PNG's signature in base64: all the window draws of a picture here. */
const PNG_BASE64 = "iVBORw0KGgo=";

const MOCK = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const SECOND = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";
const GONE = "d1e2f3a4-5b6c-4d7e-8f90-a1b2c3d4e506";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The host as the window reaches it: the pictures it holds by id, and every other read refused. */
function standHost(pictures: ReadonlySet<string>, asked: string[]): void {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind !== ACT_KIND.PLANNING_PICTURE_READ) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
        }
        asked.push(request.payload.attachmentId);
        return Promise.resolve({
          status: ACT_OUTCOME_STATUS.DONE,
          value: pictures.has(request.payload.attachmentId)
            ? { contentType: "image/png", base64: PNG_BASE64 }
            : { failure: "not-found" },
        });
      },
    },
  });
}

async function drawn(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), element)));
  await settle();
  return container;
}

/** A plan of its own id, so the window's pictures read for one test stand apart from another's. */
function planOf(id: string, body: string): Plan {
  return { ...DOCUMENT_PLAN, id, document: { body, assumptions: [] } };
}

const picture = (planId: string, id: string) =>
  planAttachmentAddress({ planId, attachmentId: id }, "acme");

test("a plan's picture is drawn from its bytes under its caption, and one this reader cannot reach as its words", async () => {
  const planId = "7a1d4e90-0c3f-4b6a-9d2e-5f6a7b8c9d03";
  standHost(new Set([MOCK]), []);
  const body = [
    "## Approach",
    `![Invite email](${picture(planId, MOCK)} "The mock Lee shared")`,
    `![Members page](${picture(planId, GONE)})`,
  ].join("\n\n");

  const view = await drawn(createElement(PlanBody, { plan: planOf(planId, body), live: false }));

  const blocks = [...view.querySelectorAll<HTMLElement>(".picture-block")];
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block) => block.classList.contains("ph-no-capture")));
  const image = blocks[0]?.querySelector("img");
  assert.equal(image?.getAttribute("src"), `data:image/png;base64,${PNG_BASE64}`);
  assert.equal(image?.getAttribute("alt"), "Invite email");
  assert.equal(blocks[0]?.querySelector(".picture-caption")?.textContent, "The mock Lee shared");
  assert.equal(blocks[1]?.querySelector("img"), null);
  assert.equal(blocks[1]?.textContent, "Members page · not available");
});

test("a press on a picture opens the plan's pictures over the window, named by their alt text", async () => {
  const planId = "9e2f5c11-6d4a-4c8b-b1e3-2a3b4c5d6e04";
  standHost(new Set([MOCK, SECOND]), []);
  const body = [
    "## Approach",
    `![Invite email](${picture(planId, MOCK)})`,
    `![Members page](${picture(planId, SECOND)})`,
  ].join("\n\n");
  const view = await drawn(createElement(PlanBody, { plan: planOf(planId, body), live: false }));

  act(() => {
    view.querySelectorAll<HTMLButtonElement>(".picture-frame")[1]?.click();
  });

  const viewer = document.querySelector(".attachment-viewer");
  assert.ok(viewer, "the viewer stands over the window");
  assert.equal(viewer.querySelector(".attachment-viewer-title")?.textContent, "Members page");
  assert.equal(viewer.querySelector(".attachment-viewer-place")?.textContent, "2 of 2");
});

test("a picture from outside Luke is a link to it, and nothing is read for it", async () => {
  const planId = "c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e05";
  const asked: string[] = [];
  standHost(new Set(), asked);
  const body = "## Approach\n\nThe vendor's flow is ![SSO flow](https://northwind.io/sso.png).";

  const view = await drawn(createElement(PlanBody, { plan: planOf(planId, body), live: false }));

  assert.equal(view.querySelector("img"), null);
  assert.equal(view.querySelector(".text-link")?.textContent, "SSO flow");
  assert.deepEqual(asked, []);
});

test("words drawn with no picture drawer, as a reply is, keep a picture as its alt text", async () => {
  const view = await drawn(
    createElement(MarkdownMessage, {
      words: `![Invite email](${picture("7a1d4e90-0c3f-4b6a-9d2e-5f6a7b8c9d03", MOCK)})`,
    }),
  );

  assert.equal(view.querySelector("img"), null);
  assert.equal(view.textContent, "Invite email");
});

test("a version draws the picture it struck and the one it wrote in, each in its change's mark", async () => {
  const planId = "e2f3a4b5-6c7d-4e8f-90a1-b2c3d4e5f607";
  standHost(new Set([MOCK, SECOND]), []);
  const before = `## Approach\n\n![First mock](${picture(planId, MOCK)})\n`;
  const after = `## Approach\n\n![Second mock](${picture(planId, SECOND)})\n`;
  function Version(): React.JSX.Element {
    const restore = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
      Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    );
    return createElement(VersionView, {
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 2, duringCall: false },
          startedAt: 1,
          changes: 1,
        },
        current: false,
        read: {
          kind: HISTORY_READ.READY,
          document: { body: after, assumptions: [] },
          previous: { body: before, assumptions: [] },
        },
      },
      restore,
      plan: { planId, place: { workspace: "acme", repository: null }, anchors: new Set<string>() },
    });
  }

  const view = await drawn(createElement(Version));

  assert.equal(
    view.querySelector("del.markdown-deleted .picture-block img")?.getAttribute("alt"),
    "First mock",
  );
  assert.equal(
    view.querySelector("ins.markdown-inserted .picture-block img")?.getAttribute("alt"),
    "Second mock",
  );
});

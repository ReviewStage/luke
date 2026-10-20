// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHAPTERS_MODEL, type ChaptersModelId } from "@luke/features/chapters-model-choice";
import { PULL_REQUEST_CHAPTERS_CALL_FAILURE } from "@luke/features/pull-request-chapters-view";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { readSegmented, segment, segmentedGroup } from "../testing/segmented.js";
import { ChaptersModelSection } from "./chapters-model-section.js";

/**
 * Settings › Coding agents' Chapters group over a bridge answering as the
 * host would: the member's model is read as the page opens and shown as a
 * segmented control over Claude's three, Haiku first; a press writes the
 * model and keeps what the service kept; a refusal is said under the row
 * with the stored model still checked; and a read that fails offers a retry.
 */

/** The model the test's service holds. */
let stored: ChaptersModelId = CHAPTERS_MODEL.HAIKU;
/** Every act the group sent, in order. */
let sent: AnyAct[] = [];
/** Whether the service fails the next read, or refuses the next write. */
let failRead = false;
let refuseWrite = false;

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

const UNANSWERED = { failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED };

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.CHAPTERS_MODEL_READ:
      return Promise.resolve(done(failRead ? UNANSWERED : { model: stored }));
    case ACT_KIND.CHAPTERS_MODEL_WRITE:
      if (refuseWrite) return Promise.resolve(done(UNANSWERED));
      stored = request.payload.model;
      return Promise.resolve(done({ model: stored }));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = CHAPTERS_MODEL.HAIKU;
  sent = [];
  failRead = false;
  refuseWrite = false;
  fakeAppPlatform(QUIET_PANEL);
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(ChaptersModelSection, { signedIn: true })));
  await settle();
  return container;
}

/** The models the group asked the service to keep, in order. */
const written = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.CHAPTERS_MODEL_WRITE ? [request.payload.model] : [],
  );

/** What the group announces now: its alerts and its live regions that say something. */
const alerts = (page: HTMLElement) =>
  [...page.querySelectorAll('[role="alert"], [aria-live]')]
    .map((each) => each.textContent ?? "")
    .filter((words) => words !== "");

test("the member's model is shown among Claude's three, Haiku first, and a press keeps the one chosen", async () => {
  stored = CHAPTERS_MODEL.SONNET;
  const page = await mount();
  const group = segmentedGroup(page, "Chapters model");
  assert.deepEqual(readSegmented(group), {
    options: ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5"],
    checked: ["Sonnet 5.5"],
    tabStops: ["Sonnet 5.5"],
  });

  act(() => segment(group, "Opus 5.5").click());
  await settle();

  assert.deepEqual(written(), [CHAPTERS_MODEL.OPUS]);
  assert.deepEqual(readSegmented(segmentedGroup(page, "Chapters model")).checked, ["Opus 5.5"]);
  assert.deepEqual(alerts(page), []);
});

test("a write the service refuses is said under the row, the stored model still checked", async () => {
  const page = await mount();
  refuseWrite = true;
  act(() => segment(segmentedGroup(page, "Chapters model"), "Opus 5.5").click());
  await settle();

  assert.deepEqual(alerts(page), ["The chapters model could not be saved. Try again."]);
  assert.deepEqual(readSegmented(segmentedGroup(page, "Chapters model")).checked, ["Haiku 5.5"]);
});

test("a read that fails says so and reads again on a retry", async () => {
  failRead = true;
  const page = await mount();
  assert.match(page.textContent ?? "", /The chapters model could not be read\./u);

  failRead = false;
  const retry =
    [...page.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      /retry|try again/iu.test(each.textContent ?? ""),
    ) ?? assert.fail("no retry");
  act(() => retry.click());
  await settle();
  assert.deepEqual(readSegmented(segmentedGroup(page, "Chapters model")).checked, ["Haiku 5.5"]);
});

// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AgentTranscriptView } from "./agent-tab";
import { SkillFiles } from "./skill-chip";
import type { SkillOption } from "./skill-mention";
import type { SkillSource } from "./skill-picker";

/**
 * skill-chip.test.ts -- a skill named in a sent message is the composer's
 * chip, which opens the skill's `SKILL.md`, as the "Loaded skill" row of a
 * call that loaded one does; a `/word` naming no skill of the plan's, or
 * one in code, stays words, and the message reads as it was written.
 */

const RELEASE: SkillOption = {
  name: "release",
  description: "Use to cut a release of the relay.",
  path: ".agents/skills/release/SKILL.md",
};

const PLAN: CodingAgentMessage = {
  id: "m-plan",
  role: "user",
  parts: [{ type: "text", text: "# Releases\n\nCut a release." }],
};

const TURN: CodingAgentMessage = {
  id: "m-turn",
  role: "assistant",
  parts: [{ type: "text", text: "Ready." }],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** A source answering the plan's skills as the service read them. */
const reading: SkillSource = () =>
  Promise.resolve({ skills: [RELEASE] satisfies readonly SkillOption[] });

/** A message the developer sent after the plan, in the words given. */
function sent(text: string): CodingAgentMessage {
  return { id: "m-sent", role: "user", parts: [{ type: "text", text }] };
}

/** The transcript drawn under the plan's skills, every file it opens recorded, once the skills' read has landed. */
async function mounted(messages: readonly CodingAgentMessage[]) {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const view = createElement(AgentTranscriptView, {
    messages,
    reading: false,
    failed: false,
    working: false,
    onRetry: () => undefined,
  });
  await act(async () => {
    root.render(
      createElement(SkillFiles, {
        source: reading,
        onOpen: (skill) => opened.push(skill.path),
        children: view,
      }),
    );
  });
  return { container, opened };
}

/** The developer's bubble. */
function bubble(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>(".is-user");
  assert.ok(found, "the developer's bubble stands");
  return found;
}

test("a skill of the plan's named in a sent message is the composer's chip, and pressing it opens the skill's file", async () => {
  const { container, opened } = await mounted([PLAN, TURN, sent("Cut it with /release now.")]);
  const chips = [...bubble(container).querySelectorAll<HTMLButtonElement>("button.skill-chip")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["/release"],
  );
  act(() => chips[0]?.click());
  assert.deepEqual(opened, [RELEASE.path]);
});

test("a `/word` naming no skill of the plan's, or a skill's name in code of any fence or run of backticks, stays words, and the bubble reads as the message was written", async () => {
  const words =
    "Try /unknown, then `/release`, ``a /release b``, then /release\n\n~~~\n/release\n~~~";
  const { container } = await mounted([PLAN, TURN, sent(words)]);
  const chips = [...bubble(container).querySelectorAll("button.skill-chip")];
  assert.equal(chips.length, 1, "only the bare /release is a chip");
  assert.equal(bubble(container).querySelector(".skill-chip")?.closest("code"), null);
  assert.match(
    bubble(container).textContent ?? "",
    /Try \/unknown, then \/release, a \/release b, then \/release[\s\S]*\/release/u,
  );
  assert.doesNotMatch(bubble(container).innerHTML, /luke-skill/u, "no markup shows in code");
});

test("the row of a call that loaded one of the plan's skills opens the skill's file, and one that failed or loaded another skill folds open as a call's row does", async () => {
  const loading: CodingAgentMessage = {
    id: "m-loading",
    role: "assistant",
    parts: [
      {
        type: "tool-load_skill",
        toolCallId: "call_known",
        state: "output-available",
        input: { skill: "release" },
        output: "Tag it, then publish.",
      },
      {
        type: "tool-load_skill",
        toolCallId: "call_failed",
        state: "output-error",
        input: { skill: "release" },
        errorText: "The skill could not be read.",
      },
      {
        type: "tool-load_skill",
        toolCallId: "call_other",
        state: "output-available",
        input: { skill: "drizzle" },
        output: "Write the schema first.",
      },
    ],
  };
  const { container, opened } = await mounted([PLAN, loading]);
  // A finished turn folds its calls, so the fold is opened first.
  await act(async () => {
    container.querySelector<HTMLElement>("[data-turn-fold] > summary")?.click();
  });
  const known = container.querySelector<HTMLElement>('[data-call-id="call_known"]');
  assert.equal(known?.tagName, "BUTTON", "the known skill's row is one button");
  act(() => known?.click());
  assert.deepEqual(opened, [RELEASE.path]);
  const other = container.querySelector<HTMLElement>('[data-call-id="call_other"]');
  act(() => other?.querySelector<HTMLElement>("summary")?.click());
  assert.match(
    other?.textContent ?? "",
    /Write the schema first\./u,
    "another skill's row opens onto what it loaded",
  );
  assert.deepEqual(opened, [RELEASE.path], "and opens no file");
  const failed = container.querySelector<HTMLElement>('[data-call-id="call_failed"]');
  act(() => failed?.querySelector<HTMLElement>("summary")?.click());
  assert.match(
    failed?.textContent ?? "",
    /The skill could not be read\./u,
    "a failed load says why",
  );
  assert.deepEqual(opened, [RELEASE.path], "and opens no file either");
});

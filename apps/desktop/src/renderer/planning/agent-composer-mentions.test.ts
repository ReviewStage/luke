// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import { MENTION_KIND, type Mention, mentionMarkdown } from "@luke/features/mention-link";
import { PLAN_TREE_ENTRY } from "@luke/features/plan-wire";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";
import type { SkillSource } from "./skill-picker";
import { TranscriptWords } from "./transcript-blocks";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

/**
 * `@` in an agent's message box and its transcript, on a plan's page and
 * off it, over the real editor bundle: the word typed opens the list of the
 * plan's sections and the repository's files, the row chosen is written
 * into the message as its link and drawn in the box as its chip, the link
 * is what is sent, and a sent message's mention is drawn as the chip that
 * opens it. Off a plan's page an `@` is a letter and a mention is words.
 * Synthetic plan and repository.
 */

const PLAN_ID = "pl_1";

const PLAN_TEXT = "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.\n";

const ROLLOUT: Mention = { kind: MENTION_KIND.SECTION, planId: PLAN_ID, heading: "Rollout" };

/** The files each repository holds, as the plan's tree answers them. */
const TREES: ReadonlyMap<string, string> = new Map([
  ["acme/relay", "apps/web/rollout-store.ts"],
  ["acme/next", "apps/web/rollout-next.ts"],
]);

/** The repository the plan's tree is read from now. */
let standing = "acme/relay";

const noSkills: SkillSource = () => Promise.resolve({ skills: [] });

const ignore = () => undefined;

const roots: Root[] = [];

// Set before any box renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  standing = "acme/relay";
  installScrollIntoView();
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.PLANNING_TREE
            ? {
                status: ACT_OUTCOME_STATUS.DONE,
                value: {
                  folder: {
                    path: "",
                    repository: standing,
                    branch: "main",
                    entries: [{ name: TREES.get(standing) ?? "", kind: PLAN_TREE_ENTRY.FILE }],
                    truncated: false,
                  },
                },
              }
            : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
        ),
      recordSurfaceEvent: ignore,
    },
  });
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

/** What a plan's page hands its places, every mention a chip was asked to open kept. */
function planPage(opened: Mention[], repository = "acme/relay"): PlanMentionsValue {
  return {
    planId: PLAN_ID,
    planName: "Invitations",
    repository,
    text: () => PLAN_TEXT,
    doors: {
      planId: PLAN_ID,
      headings: new Set(["Goal", "Rollout"]),
      onOpenPlan: (mention) => opened.push(mention),
      onOpenFile: undefined,
    },
  };
}

/** The box on the composer's own control, its sends answered by `sender`. */
function Box({ sender }: { sender: MessageSender }): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    planId: PLAN_ID,
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(AgentComposer, { ...QUIET_COMPOSER, composer, skills: noSkills });
}

/** The node drawn on a plan's page, or off any page where none is given; `redraw` draws it on the page given. */
function drawing(node: ReactNode, page: PlanMentionsValue | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const redraw = (on: PlanMentionsValue | undefined) =>
    act(() =>
      root.render(
        on === undefined ? node : createElement(PlanMentions, { value: on, children: node }),
      ),
    );
  redraw(page);
  return { container, redraw };
}

/** The node drawn on a plan's page, or off any page where none is given. */
function drawn(node: ReactNode, page: PlanMentionsValue | undefined): HTMLElement {
  return drawing(node, page).container;
}

/** The box drawn, every message it sends written down. */
async function box(page: PlanMentionsValue | undefined) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise<CodingAgentAgentAnswer>(ignore);
  };
  const { container, redraw } = drawing(createElement(Box, { sender }), page);
  await settle();
  return { container, sent, redraw };
}

/** The attribute that carries a mention's target, other than one session replay masks, if any element drawn holds one. */
function carryingTarget(container: HTMLElement): string | undefined {
  const masked = new Set(["title", "aria-label"]);
  return [...container.querySelectorAll("*")]
    .flatMap((element) => [...element.attributes])
    .find((attribute) => !masked.has(attribute.name) && attribute.value.includes("luke://"))?.name;
}

/** The rows the list draws, by name. */
function listed(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".mention-menu .plan-compose-menu-name")].map(
    (name) => name.textContent ?? "",
  );
}

test("an @ typed in the box on a plan's page offers the plan's sections, and the row chosen is drawn as its chip and sent as its link", async () => {
  const { container, sent } = await box(planPage([]));

  typeInComposer(container, "Follow @roll");
  await settle();
  const offered = listed(container);
  pressInComposer(container, "ArrowDown");
  pressInComposer(container, "Enter");
  await settle();
  const chips = [...composerEditor(container).querySelectorAll(".mention-chip")];
  pressInComposer(container, "Enter");
  await settle();

  assert.deepEqual(offered, ["rollout-store.ts", "Rollout"]);
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Rollout"],
  );
  assert.deepEqual(sent, [`Follow ${mentionMarkdown(ROLLOUT, "Rollout")}`]);
});

test("off a plan's page an @ in the box opens nothing and is sent as the letter it is", async () => {
  const { container, sent } = await box(undefined);

  typeInComposer(container, "Mail @roll");
  await settle();
  const menu = container.querySelector(".mention-menu");
  pressInComposer(container, "Enter");
  await settle();

  assert.equal(menu, null);
  assert.deepEqual(sent, ["Mail @roll"]);
});

test("a sent message's mention is drawn on a plan's page as the chip that opens what it names", () => {
  const opened: Mention[] = [];
  const container = drawn(
    createElement(TranscriptWords, { text: `Follow ${mentionMarkdown(ROLLOUT, "Rollout")}.` }),
    planPage(opened),
  );

  const chip = container.querySelector<HTMLButtonElement>("button.mention-chip");
  assert.ok(chip, "the mention is a chip");
  act(() => chip.click());

  assert.equal(chip.textContent, "Rollout");
  assert.deepEqual(opened, [ROLLOUT]);
  assert.equal(carryingTarget(container), undefined);
});

test("off a plan's page a sent message's mention is drawn as its words, not a chip", () => {
  const container = drawn(
    createElement(TranscriptWords, { text: `Follow ${mentionMarkdown(ROLLOUT, "Rollout")}.` }),
    undefined,
  );

  assert.equal(container.querySelector(".mention-chip"), null);
  assert.equal(carryingTarget(container), undefined);
  assert.equal(container.textContent, "Follow @Rollout.");
});

test("once the plan's repository changes, the box offers the new repository's files", async () => {
  const { container, redraw } = await box(planPage([]));
  typeInComposer(container, "Follow @roll");
  await settle();
  const before = listed(container);

  standing = "acme/next";
  redraw(planPage([], "acme/next"));
  await settle();

  assert.deepEqual(before, ["rollout-store.ts", "Rollout"]);
  assert.deepEqual(listed(container), ["rollout-next.ts", "Rollout"]);
});

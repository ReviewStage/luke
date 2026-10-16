// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { tasksControl } from "#testing/tasks-control";
import { CHIP_LOOK } from "./chip";
import { PickerRow } from "./settings/picker-row";
import { AgentModelChip } from "./tasks/agent-model-chip";
import { ChangesChip, PublishedChip, type PublishedDoors } from "./tasks/agent-published";
import { CHIP_PLACE, type ChipPlace, RepositoryChip } from "./tasks/repository-chip";

/**
 * The chips as each place draws them: the chips that stand in one role are
 * one look, read off the button the developer presses, so the model chip
 * at an agent box's foot and the repository chip in the plan toolbar are
 * the same quiet toolbar button as the ⋯ beside them, what an agent
 * published is the composer's one pill, and a settings picker is the row
 * buttons' hairlined field.
 */

const DOORS: PublishedDoors = {
  openGitHub: () => undefined,
  copy: () => undefined,
  openChanges: () => undefined,
};

const PUBLISHED = {
  repository: "acme/relay",
  branch: "luke/chips",
  pullRequest: {
    number: 42,
    title: "Chips agree",
    url: "https://github.com/acme/relay/pull/42",
    state: PULL_REQUEST_STATE.OPEN,
    checks: "passing",
    additions: 3,
    deletions: 1,
    changedFiles: 2,
  },
} as const;

/** The buttons an element draws, in order. */
function buttons(element: ReactElement): HTMLButtonElement[] {
  document.body.innerHTML = renderToStaticMarkup(element);
  return [...document.querySelectorAll("button")];
}

/** The one button an element draws. */
function onlyButton(element: ReactElement): HTMLButtonElement {
  const [button, ...rest] = buttons(element);
  assert.equal(rest.length, 0, "the element draws one button");
  return button ?? assert.fail("the element draws a button");
}

function repositoryChip(place: ChipPlace): HTMLButtonElement {
  return onlyButton(
    createElement(RepositoryChip, {
      place,
      value: null,
      chooser: tasksControl().repositories,
      onChoose: () => undefined,
    }),
  );
}

function modelChip(): HTMLButtonElement {
  return onlyButton(
    createElement(AgentModelChip, {
      model: {
        choice: { model: "opus", effort: "high" },
        note: undefined,
        choose: () => undefined,
      },
      models: [],
      readModels: () => undefined,
      usage: undefined,
    }),
  );
}

test("the model chip at an agent box's foot is the plan toolbar's repository chip: one quiet toolbar button", () => {
  const model = modelChip();
  const repository = repositoryChip(CHIP_PLACE.TOOLBAR);

  assert.equal(model.dataset.look, CHIP_LOOK.TOOLBAR);
  assert.equal(repository.dataset.look, CHIP_LOOK.TOOLBAR);
  assert.deepEqual([...model.classList], [...repository.classList]);
  // The toolbar's ⋯ and Summary are toolbar buttons too, so the chip lights and presses as they do.
  assert.ok(repository.classList.contains("toolbar-button"));
  assert.ok(!repository.classList.contains("bordered-button"));
});

test("what an agent published and a new plan's repository are the composer's one pill", () => {
  const [published] = buttons(createElement(PublishedChip, { published: PUBLISHED, doors: DOORS }));
  const [changes] = buttons(createElement(ChangesChip, { published: PUBLISHED, doors: DOORS }));
  const repository = repositoryChip(CHIP_PLACE.COMPOSER);

  for (const chip of [published, changes, repository]) {
    assert.equal(chip?.dataset.look, CHIP_LOOK.PILL);
  }
  assert.notEqual(modelChip().dataset.look, CHIP_LOOK.PILL);
});

test("a settings picker is a field inside the hairline its row's buttons draw", () => {
  const picker = onlyButton(
    createElement(PickerRow, {
      label: "Default model",
      copy: "Default model",
      value: "opus",
      valueLabel: "Opus",
      rows: [],
      noMatch: "No models match",
      onPick: () => undefined,
    }),
  );

  assert.equal(picker.dataset.look, CHIP_LOOK.FIELD);
  assert.ok(picker.classList.contains("bordered-button"));
  assert.equal(picker.querySelectorAll(".settings-chevron").length, 1);
});

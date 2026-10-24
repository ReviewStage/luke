// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { POPOVER_ALIGN } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { ModelMenu } from "./model-menu.js";

/**
 * model-menu.test.ts -- a model no subscription or API key of the account's
 * pays for is never a dead row: its pick lands on its harness's row in
 * Settings › Agents rather than choosing it, and where the choice standing
 * is such a model, as a new account's Claude default is on an OpenAI key
 * alone, the menu says it cannot run and offers the same Connect. Synthetic
 * catalog.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Claude's models with nothing connected to pay for them, and a GPT model an OpenAI key pays for. */
const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
    credentialMissing: true,
  },
  {
    id: "openai/gpt-6.1",
    name: "GPT-6.1",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

const OPUS: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" };
const GPT: ModelChoice = { model: "openai/gpt-6.1", effort: "high" };

/** Where Claude's Connect lands: its harness's row on Agents. */
const CLAUDE_ROW: SettingsLink = {
  page: SETTINGS_VIEW.CODING_AGENTS,
  section: SETTINGS_SECTION.CLAUDE,
};

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  installScrollIntoView();
});

beforeEach(() => {
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** The menu open on `chosen`, recording where Settings opened, what it chose, and whether it asked to close. */
function open(chosen: ModelChoice): {
  menu: HTMLElement;
  opened: SettingsLink[];
  chose: ModelChoice[];
  closed: () => number;
} {
  const opened: SettingsLink[] = [];
  const chose: ModelChoice[] = [];
  let closes = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => opened.push(link) },
        createElement(ModelMenu, {
          id: "model-menu",
          align: POPOVER_ALIGN.END,
          models: MODELS,
          failed: false,
          onRetry: () => undefined,
          chosen,
          onChoose: (next) => chose.push(next),
          onClose: () => {
            closes += 1;
          },
          onLeave: () => undefined,
        }),
      ),
    ),
  );
  const menu = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Model"]');
  assert.ok(menu, "the menu is open");
  return { menu, opened, chose, closed: () => closes };
}

/** The listed row whose words begin with `name`. */
function row(menu: HTMLElement, name: string): HTMLElement {
  const found = [...menu.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
    (each.textContent ?? "").startsWith(name),
  );
  assert.ok(found, `no row for ${name}`);
  return found;
}

test("a model nothing pays for says Connect Claude, and its pick lands on Claude's row in Settings rather than choosing it", () => {
  const { menu, opened, chose, closed } = open(GPT);

  const opus = row(menu, "Opus 5.5");
  assert.match(opus.textContent ?? "", /Connect Claude/u);
  assert.notEqual(opus.getAttribute("aria-disabled"), "true", "the row can be reached and picked");
  act(() => opus.click());

  assert.deepEqual(opened, [CLAUDE_ROW]);
  assert.deepEqual(chose, [], "the model is not chosen");
  assert.equal(closed(), 1, "the menu closes on its way to Settings");
});

test("a choice nothing pays for says it cannot run under the pinned rows, and their Connect lands on Claude's row", () => {
  const { menu, opened, chose } = open(OPUS);

  const foot = menu.querySelector<HTMLElement>(".luke-searchable-menu-foot");
  assert.ok(foot, "the pinned rows stand");
  assert.match(
    foot.textContent ?? "",
    /Opus 5\.5 cannot run until you connect Claude with a subscription or an API key\./u,
  );
  const connect = [...foot.querySelectorAll<HTMLElement>('[role="menuitem"], button')].find(
    (each) => each.textContent === "Connect Claude",
  );
  assert.ok(connect, "a Connect row heads the pinned rows");
  act(() => connect.click());

  assert.deepEqual(opened, [CLAUDE_ROW]);
  assert.deepEqual(chose, []);
});

test("a choice something pays for says nothing of connecting", () => {
  const { menu } = open(GPT);

  const foot = menu.querySelector<HTMLElement>(".luke-searchable-menu-foot")?.textContent ?? "";
  assert.doesNotMatch(foot, /cannot run|Connect/u);
});

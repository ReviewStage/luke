// @vitest-environment jsdom

import assert from "node:assert/strict";
import { FAILURE_REASON, type Failure } from "@luke/features/failure-remedy";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { SETTINGS_SECTION, SETTINGS_VIEW, type SettingsLink } from "@luke/settings/settings-views";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { OpenSettingsProvider } from "../open-settings.js";
import { useRepositoryRemedy } from "./repository-remedy.js";

/**
 * A missing credential's press opens Settings › Agents at the row of the
 * harness the service named, and at the page's top where it named none.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Presses the remedy of each failure in turn, answering every place Settings was opened at. */
function pressed(failures: readonly Failure[]): SettingsLink[] {
  const opened: SettingsLink[] = [];
  const presses: (() => void)[] = [];
  function Remedies(): null {
    const remedy = useRepositoryRemedy();
    presses.splice(0, presses.length, ...failures.map((failure) => remedy(failure) ?? fail()));
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        OpenSettingsProvider,
        { value: (link: SettingsLink) => opened.push(link) },
        createElement(Remedies),
      ),
    ),
  );
  for (const press of presses) act(press);
  return opened;
}

function fail(): never {
  return assert.fail("the failure offers a press");
}

test("a missing credential's press lands on its harness's row in Agents, or atop Agents where no harness is named", () => {
  const missing = (provider?: (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER]): Failure => ({
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: "Connect it in Settings to start an agent.",
    provider,
  });

  assert.deepEqual(
    pressed([missing(MODEL_PROVIDER.ANTHROPIC), missing(MODEL_PROVIDER.OPENAI), missing()]),
    [
      { page: SETTINGS_VIEW.CODING_AGENTS, section: SETTINGS_SECTION.CLAUDE },
      { page: SETTINGS_VIEW.CODING_AGENTS, section: SETTINGS_SECTION.CODEX },
      { page: SETTINGS_VIEW.CODING_AGENTS },
    ],
  );
});

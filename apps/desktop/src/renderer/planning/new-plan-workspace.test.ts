// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { NewPlanDialog } from "./new-plan-dialog";
import type { RepositoryChooser } from "./repository-chip";

/**
 * new-plan-workspace.test.ts -- New plan says where the plan will start,
 * "New plan in Acme", and the workspace chip there chooses another: the
 * repository chip then lists that workspace's repositories under where they
 * come from, and the plan starts there. Synthetic throughout.
 */

const PERSONAL: Workspace = {
  id: "ws-personal",
  name: "Personal",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "ws-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme-corp", active: true },
};

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
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

/** The chooser each workspace's repository chip is handed, Acme's reaching its installation's repositories. */
function chooserFor(workspaceId: string | undefined): RepositoryChooser {
  const base = plansControl().repositories;
  if (workspaceId !== ACME.id) return { ...base, scope: workspaceId, workspaceName: PERSONAL.name };
  return {
    ...base,
    scope: ACME.id,
    workspaceName: ACME.name,
    source: "acme-corp on GitHub · Acme",
    read: () =>
      Promise.resolve({
        repositories: {
          installed: true,
          repositories: [
            {
              owner: "acme-corp",
              name: "relay",
              fullName: "acme-corp/relay",
              defaultBranch: "main",
              private: true,
              updatedAt: 1,
            },
          ],
          installationUrl: "https://github.com/apps/luke/installations/new",
        },
      }),
  };
}

test("New plan says the workspace it starts in, and the workspace chosen there lists its own repositories under their source and starts the plan", async () => {
  const starts: (string | undefined)[] = [];
  const control = plansControl();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(NewPlanDialog, {
        newPlan: {
          ...control.newPlan,
          open: true,
          workspaces: [PERSONAL, ACME],
          workspaceId: PERSONAL.id,
          repositoriesIn: chooserFor,
          start: (_name, _repository, workspaceId) => {
            starts.push(workspaceId);
            return Promise.resolve(undefined);
          },
        },
      }),
    ),
  );
  await settle();
  const title = () => document.querySelector(".new-plan-title")?.textContent;
  assert.match(title() ?? "", /^New plan in.*Personal$/u);

  const workspaceChip =
    document.querySelector<HTMLButtonElement>('[aria-label="Workspace: Personal"]') ??
    assert.fail("the title's workspace is a chip");
  act(() => workspaceChip.click());
  await settle();
  assert.equal(
    document.querySelector<HTMLElement>('[role="menu"][aria-label="Workspace"]')?.dataset.layer,
    "dialog",
    "the chip's menu stands over the window the dialog dims, not under it",
  );
  const acme = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (item) => item.textContent?.endsWith("Acme"),
  );
  act(() => acme?.click());
  await settle();
  assert.match(title() ?? "", /Acme$/u, "the title says the workspace chosen");

  const repositoryChip =
    document.querySelector<HTMLButtonElement>(".repository-chip .chip") ??
    assert.fail("the repository chip stands");
  act(() => repositoryChip.click());
  await settle();
  assert.match(
    document.body.textContent ?? "",
    /acme-corp on GitHub · Acme/u,
    "the list says where its repositories come from",
  );

  const name = document.querySelector<HTMLInputElement>('input[aria-label="Plan name"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Usage");
    name?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
    each.textContent?.startsWith("Create plan"),
  );
  act(() => create?.click());
  await settle();
  assert.deepEqual(starts, [ACME.id], "the plan starts in the workspace chosen");
});

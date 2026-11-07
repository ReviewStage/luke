// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@repo/features/link-grammar";
import type { TaskPullRequests } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { useQuery } from "@tanstack/react-query";
import { act, createElement, memo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PullRequestLine } from "../desktop/task-card.js";
import { rendererRegistry } from "../renderer-runtime.js";
import { ADDRESS } from "../route.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { onRegistry, withQueryClient } from "../testing/copy-feedback.js";
import { appStateQuery, selectRun } from "../use-app-state.js";
import {
  ListedPullRequests,
  OpenAddressesHere,
  OpenLinkProvider,
  PullRequestsOnGitHub,
  useOpenLink,
} from "./use-open-link.js";

/**
 * use-open-link.test.ts -- a pull request inside a pull request's own tab
 * opens on GitHub, though a listed task's agent opened it, a new list
 * draws no part opening links again, which reads the list as the link
 * opens, and a link naming a listed task by its number reaches the place
 * pressed on by the task's id; where every other link opens is the route table's
 * (`../route.test.ts`). Synthetic ids, a task card's pull request row
 * standing for every press.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const URL = "https://github.com/acme/relay/pull/42";

const LINE = {
  number: 42,
  title: "Expire invitations",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 3,
  deletions: 1,
  url: URL,
};

/** The listed task's pull requests, as the list followed live holds them. */
const LISTED: readonly TaskPullRequests[] = [
  { taskId: TASK, pullRequests: [{ ...LINE, agentId: AGENT }] },
];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Presses the pull request's row drawn as `wrap` holds it under the window's opener, answering where it went. */
function press(url: string, wrap: (row: ReactNode) => ReactNode = (row) => row) {
  const links: ReadLink[] = [];
  const github: string[] = [];
  fakeAppPlatform({ openGitHub: (href) => github.push(href) });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const row = createElement(
    "ul",
    null,
    createElement(PullRequestLine, { pullRequest: { ...LINE, url } }),
  );
  act(() =>
    root?.render(
      withQueryClient(
        createElement(
          OpenLinkProvider,
          { value: (link: ReadLink) => links.push(link) },
          createElement(ListedPullRequests, { tasks: LISTED, children: wrap(row) }),
        ),
      ),
    ),
  );
  const button =
    container.querySelector<HTMLElement>("[data-task-card-pull-request] button") ??
    assert.fail("the row is a press");
  act(() => button.click());
  return { places: links.map((link) => link.place), github };
}

test("inside a pull request's own tab, a link to it opens on GitHub", () => {
  assert.deepEqual(
    press(URL, (row) => createElement(PullRequestsOnGitHub, null, row)),
    { places: [], github: [URL] },
  );
});

test("a new list of tasks draws no part opening links again, and a link opened after it reads the new list", () => {
  const links: ReadLink[] = [];
  let open: ((href: string) => void) | undefined;
  // Note that the part holds while nothing it is handed changes, as a transcript's link does.
  const Opener = memo(function Opener() {
    open = useOpenLink();
    return null;
  });
  const openPlace = (link: ReadLink) => {
    links.push(link);
  };
  const draw = (tasks: readonly TaskPullRequests[]) =>
    withQueryClient(
      createElement(
        OpenLinkProvider,
        { value: openPlace },
        createElement(ListedPullRequests, { tasks, children: createElement(Opener) }),
      ),
    );
  fakeAppPlatform({ openGitHub: () => undefined });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(draw([])));
  act(() => root?.render(draw(LISTED)));
  act(() => open?.(URL));

  assert.deepEqual(
    links.map((link) => link.place),
    [{ kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT }],
  );
});

test("a link naming a listed task by its number is asked of the place it is pressed on by the task's id", async () => {
  const page = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
  const acme = {
    id: "workspace-acme",
    name: "Acme",
    slug: "acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
    memberCount: 1,
  };
  handState(
    {},
    {
      tasks: {
        ...IDLE_TASKS_VIEW,
        workspaces: [acme],
        tasks: [
          {
            id: TASK,
            workspaceId: "workspace-acme",
            name: "Teammate invitations",
            createdAt: 1,
            updatedAt: 2,
            repository: "acme/relay",
            number: 42,
          },
        ],
      },
    },
  );
  const asked: LinkPlace[] = [];
  let open: ((href: string) => void) | undefined;
  // Note that the part reads the window's document, so it is read by the press.
  function Opener(): null {
    useQuery({ ...appStateQuery, select: selectRun });
    open = useOpenLink();
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root?.render(
      onRegistry(
        rendererRegistry,
        createElement(
          OpenAddressesHere,
          {
            value: (address) => {
              if (address.kind === ADDRESS.PLACE) asked.push(address.link.place);
              return true;
            },
          },
          createElement(Opener),
        ),
      ),
    ),
  );
  // The window's document lands a few turns after the read is asked.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  act(() => open?.(`https://vespin.dev/acme/task/42/page/${page}`));

  assert.deepEqual(asked, [{ kind: LINK_PLACE.PAGE, planId: TASK, pageId: page }]);
});

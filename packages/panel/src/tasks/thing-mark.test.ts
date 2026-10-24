// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { TranscriptWords } from "./transcript-blocks.js";
import { OpenLinkProvider } from "./use-open-link.js";

/**
 * thing-mark.test.ts -- a chip leads with its thing's mark whichever way
 * the thing was written: a person named by a mention and by a Luke link to
 * their page wears the same face, and a pull request or a GitHub issue
 * GitHub answered nothing for wears its kind's glyph, never GitHub's mark
 * as a page of any site's would. Synthetic workspace and people.
 */

const SAM = "user-sam";
const HOME = "https://tryluke.dev/acme";

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 2,
};

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: SAM, name: "Sam Okafor", email: "sam@example.com", role: WORKSPACE_ROLE.MEMBER },
];

const STATE: AppStateSnapshot = signedInAs({
  id: SAM,
  email: "sam@example.com",
  name: "Sam Okafor",
});

let root: Root | undefined;

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The words drawn as a transcript draws them, among the workspace's members. */
async function drawn(text: string): Promise<HTMLElement> {
  fakeActs({
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(STATE),
    act: (request: AnyAct): Promise<FakeActAnswer> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? { status: FAKE_ANSWER.DONE, value: MEMBERS }
          : { status: FAKE_ANSWER.DONE, value: undefined },
      ),
  });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const words = createElement(MemberDirectory, {
    workspace: ACME,
    readerId: SAM,
    children: createElement(TranscriptWords, { text }),
  });
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OpenLinkProvider, { value: () => undefined, children: words }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Each chip's mark as drawn, by the kind of chip it leads. */
function marks(container: HTMLElement): [string | undefined, Element | null][] {
  return [...container.querySelectorAll<HTMLElement>("[data-mention-ref]")].map((chip) => [
    chip.dataset.kind,
    chip.querySelector(".luke-inline-ref-glyph")?.firstElementChild ?? null,
  ]);
}

test("a person wears their face whether named by a mention or by a Luke link to their page", async () => {
  const container = await drawn(`[@Sam](${HOME}/person/${SAM}) and ${HOME}/person/${SAM}#about`);
  const [mention, link] = marks(container);

  assert.equal(mention?.[0], "person");
  assert.equal(link?.[0], "place");
  assert.equal(link?.[1]?.classList.contains("actor-mark"), true);
  assert.equal(link?.[1]?.outerHTML, mention?.[1]?.outerHTML);
});

test("a pull request and a GitHub issue GitHub answered nothing for wear their kind's glyph, not GitHub's mark", async () => {
  const container = await drawn(
    "https://github.com/acme/relay/pull/42 and https://github.com/acme/relay/issues/7",
  );

  assert.deepEqual(
    marks(container).map(([, mark]) => mark?.getAttribute("class")),
    ["lucide lucide-git-pull-request", "lucide lucide-circle-dot"],
  );
});

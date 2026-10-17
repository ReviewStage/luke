import assert from "node:assert/strict";
import { LINK_PLACE } from "@luke/features/luke-link";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { test } from "vitest";
import { LINK_ROUTE, linkRoute } from "./link-route.js";

/**
 * Where the window opens a Luke link: a page of Settings in Settings, on
 * the reader's own copy of the workspace its slug names; a place of an
 * experiment that is off nowhere; anything else on the Plans tab, whose
 * read decides. Synthetic workspaces.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const WINDOW = { workspaces: [ACME], factoryOn: false, automationsOn: true, issuesOn: true };

test("a link to a page of Settings opens it on the workspace its slug names, where the account is in it", () => {
  assert.deepEqual(
    linkRoute(
      { workspace: "acme", place: { kind: LINK_PLACE.SETTINGS, page: "workspace" } },
      WINDOW,
    ),
    {
      kind: LINK_ROUTE.SETTINGS,
      settings: { page: SETTINGS_VIEW.WORKSPACE, workspaceId: ACME.id },
    },
  );
  assert.deepEqual(
    linkRoute(
      { workspace: "someone-elses", place: { kind: LINK_PLACE.SETTINGS, page: "workspace" } },
      WINDOW,
    ),
    { kind: LINK_ROUTE.SETTINGS, settings: { page: SETTINGS_VIEW.WORKSPACE } },
  );
});

test("a link to Settings with no page, or a page this window does not know, opens Settings on its first", () => {
  for (const place of [
    { kind: LINK_PLACE.SETTINGS },
    { kind: LINK_PLACE.SETTINGS, page: "billing" },
  ] as const) {
    assert.deepEqual(linkRoute({ workspace: "acme", place }, WINDOW), {
      kind: LINK_ROUTE.SETTINGS,
      settings: { page: SETTINGS_VIEW.ACCOUNT, workspaceId: ACME.id },
    });
  }
});

test("a place of an experiment the account has off opens nowhere, and one it has on opens on the Plans tab", () => {
  const automation = { kind: LINK_PLACE.AUTOMATION, automationId: "a1" } as const;

  assert.deepEqual(linkRoute({ workspace: "acme", place: { kind: LINK_PLACE.FACTORY } }, WINDOW), {
    kind: LINK_ROUTE.EXPERIMENT_OFF,
  });
  assert.deepEqual(linkRoute({ workspace: "acme", place: automation }, WINDOW), {
    kind: LINK_ROUTE.TASKS,
  });
  assert.deepEqual(
    linkRoute({ workspace: "acme", place: automation }, { ...WINDOW, automationsOn: false }),
    { kind: LINK_ROUTE.EXPERIMENT_OFF },
  );
});

test("an issue opens on the Plans tab while the Issues experiment is on, and nowhere while it is off", () => {
  const issue = { kind: LINK_PLACE.ISSUE, issueId: "i1" } as const;

  assert.deepEqual(linkRoute({ workspace: "acme", place: issue }, WINDOW), {
    kind: LINK_ROUTE.TASKS,
  });
  assert.deepEqual(linkRoute({ workspace: "acme", place: issue }, { ...WINDOW, issuesOn: false }), {
    kind: LINK_ROUTE.EXPERIMENT_OFF,
  });
});

test("a task, an agent, or an Inbox item opens on the Plans tab, whatever workspace its slug names", () => {
  for (const place of [
    { kind: LINK_PLACE.TASK, planId: "p1" },
    { kind: LINK_PLACE.AGENT, agentId: "a1" },
    { kind: LINK_PLACE.INBOX_ITEM, agentId: "a1", itemId: "i1" },
  ] as const) {
    assert.deepEqual(linkRoute({ workspace: "someone-elses", place }, WINDOW), {
      kind: LINK_ROUTE.TASKS,
    });
  }
});

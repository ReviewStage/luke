import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import {
  listAgentBrowserTabs,
  retargetBrowserTab,
  upsertBrowserTab,
} from "@repo/database/models/agent-browser-tabs";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { AGENT_BROWSER_TAB_OPENER } from "@repo/features/agent-browser-tab-wire";
import type { CdpSession } from "@repo/features/browser-cdp";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { agentBrowserTestLayer, fakeCdpPeer } from "../../testing/agent-browser-fake.js";
import { AgentBrowser } from "./agent-browser.js";
import { connectRestoring, restoreBrowserTabs } from "./restore-tabs.js";

const SESSION = "wrun_restore_tabs_fixture";

const openConversation = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );
  const [row] = yield* Database.use((db) =>
    db
      .insert(conversations)
      .values({ userId: id, kind: CONVERSATION_KIND.AGENT })
      .returning({ id: conversations.id }),
  );
  assert.ok(row);
  return row.id;
});

const keep = (conversationId: string, targetId: string, address: string) =>
  upsertBrowserTab({
    conversationId,
    targetId,
    address,
    title: "Kept",
    openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
  });

it.layer(getTestDB())("restoring an agent's Browser tabs", (it) => {
  it.effect(
    "a live view's connection reopens every kept tab, though another connection started the browser and went",
    () =>
      Effect.gen(function* () {
        const conversationId = yield* openConversation;
        yield* keep(conversationId, "before-1", "https://shop.test/cart");
        yield* keep(conversationId, "before-2", "http://localhost:3000/");
        const peer = yield* fakeCdpPeer();
        yield* Effect.gen(function* () {
          const agent = yield* AgentBrowser;
          yield* agent.ensure(SESSION);
          yield* Effect.scoped(connectRestoring(SESSION, conversationId));
        }).pipe(Effect.provide(agentBrowserTestLayer(peer, SESSION)));

        const pages = yield* peer.pages;
        const rows = yield* listAgentBrowserTabs(conversationId);
        assert.deepEqual(
          rows.map((row) => pages.find((page) => page.targetId === row.targetId)?.url).sort(),
          ["http://localhost:3000/", "https://shop.test/cart"],
        );
        assert.equal(pages.length, 3, "the blank page, and one page for each kept tab");
      }),
  );

  it.effect(
    "of two connections reopening one tab at once, the row moves for one and the other's page is closed",
    () =>
      Effect.gen(function* () {
        const conversationId = yield* openConversation;
        const kept = yield* keep(conversationId, "before-1", "https://shop.test/cart");
        const peer = yield* fakeCdpPeer();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const agent = yield* AgentBrowser;
            const cdp = yield* agent.connect(SESSION);
            const database = yield* Effect.context<DatabaseServices>();
            const raced: CdpSession = {
              ...cdp,
              openPage: (url) =>
                Effect.gen(function* () {
                  const theirs = yield* cdp.openPage(url);
                  yield* retargetBrowserTab(conversationId, kept.id, "before-1", theirs).pipe(
                    Effect.provideContext(database),
                    Effect.orDie,
                  );
                  return yield* cdp.openPage(url);
                }),
            };
            yield* restoreBrowserTabs(conversationId, raced);
          }),
        ).pipe(Effect.provide(agentBrowserTestLayer(peer, SESSION)));

        const pages = yield* peer.pages;
        const [row] = yield* listAgentBrowserTabs(conversationId);
        assert.ok(row);
        assert.equal(row.id, kept.id);
        assert.deepEqual(
          pages
            .filter((page) => page.url === "https://shop.test/cart")
            .map(({ targetId }) => targetId),
          [row.targetId],
        );
      }),
  );

  it.effect("a kept tab at the blank address is reopened like any other", () =>
    Effect.gen(function* () {
      const conversationId = yield* openConversation;
      const kept = yield* keep(conversationId, "blank-before", "about:blank");
      const peer = yield* fakeCdpPeer();

      yield* Effect.scoped(connectRestoring(SESSION, conversationId)).pipe(
        Effect.provide(agentBrowserTestLayer(peer, SESSION)),
      );

      const [row] = yield* listAgentBrowserTabs(conversationId);
      assert.equal(row?.id, kept.id);
      assert.ok((yield* peer.pages).some((page) => page.targetId === row?.targetId));
    }),
  );

  it.effect(
    "a browser that could not say which pages it holds is left as it is, its kept tabs unmoved",
    () =>
      Effect.gen(function* () {
        const conversationId = yield* openConversation;
        yield* keep(conversationId, "before-1", "https://shop.test/cart");
        const peer = yield* fakeCdpPeer({
          answer: (command) =>
            command.method === "Target.getTargets"
              ? { error: { code: -32000, message: "Not available" } }
              : undefined,
        });

        yield* Effect.scoped(connectRestoring(SESSION, conversationId)).pipe(
          Effect.provide(agentBrowserTestLayer(peer, SESSION)),
        );

        assert.equal((yield* peer.pages).length, 1, "no tab was opened");
        const [row] = yield* listAgentBrowserTabs(conversationId);
        assert.equal(row?.targetId, "before-1");
      }),
  );

  it.effect("a page reopened for a tab whose row the store would not move is closed again", () =>
    Effect.gen(function* () {
      const conversationId = yield* openConversation;
      yield* keep(conversationId, "before-1", "https://shop.test/cart");
      yield* TestClock.adjust("1 second");
      yield* keep(conversationId, "page-1", "https://shop.test/");
      const peer = yield* fakeCdpPeer();

      yield* Effect.scoped(connectRestoring(SESSION, conversationId)).pipe(
        Effect.provide(agentBrowserTestLayer(peer, SESSION)),
      );

      assert.deepEqual(
        (yield* peer.pages).map((page) => page.url),
        ["about:blank"],
        "the page opened for the unmoved tab is closed",
      );
    }),
  );
});

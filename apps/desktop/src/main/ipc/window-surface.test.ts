import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import type { PanelManager } from "../window/panel-manager";
import { windowSurfaceActRows } from "./window-surface";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };

/** The window surface's rows over a save dialog that answers `choosing`, every file it saved and every address it opened written down. */
function fixture(choosing: boolean) {
  const saved: string[] = [];
  const opened: string[] = [];
  const rows = windowSurfaceActRows({
    // SAFETY: a save reads nothing of the panels.
    panels: {} as PanelManager,
    requestMicrophone: () => Promise.reject(new Error("not asked")),
    microphoneRoute: () => undefined,
    microphoneRouteWatcher: () => undefined,
    recordProductEvent: () => undefined,
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    saveFile: (sender, name, text) => {
      if (choosing)
        saved.push(`${sender === SENDER ? "over the panel" : "elsewhere"}: ${name} ${text}`);
      return Promise.resolve(choosing);
    },
  });
  // SAFETY: the router reads only the rows of the kinds it is asked, and every act here is one of these.
  return { router: createActRouter(rows as ActRows), saved, opened };
}

it.effect(
  "a panel's file is saved where its dialog chose and answers saved, a dialog cancelled answers not, and a save is refused from any window but a panel or with a folder in its name",
  () =>
    Effect.gen(function* () {
      const chosen = fixture(true);
      const save = (name: string, sender: ActSender) =>
        chosen.router.performAct(
          { kind: ACT_KIND.WINDOW_SAVE_FILE, payload: { name, text: "export {};" } },
          sender,
        );

      assert.deepEqual(yield* save("invite.ts", PANEL), {
        status: ACT_OUTCOME_STATUS.DONE,
        value: true,
      });
      const refused = {
        status: ACT_OUTCOME_STATUS.REFUSED,
        reason: ACT[ACT_KIND.WINDOW_SAVE_FILE].refusal,
      };
      assert.deepEqual(yield* save("invite.ts", VOICE), refused);
      assert.deepEqual(yield* save("../invite.ts", PANEL), refused);
      assert.deepEqual(chosen.saved, ["over the panel: invite.ts export {};"]);

      const cancelled = fixture(false);
      assert.deepEqual(
        yield* cancelled.router.performAct(
          { kind: ACT_KIND.WINDOW_SAVE_FILE, payload: { name: "invite.ts", text: "" } },
          PANEL,
        ),
        { status: ACT_OUTCOME_STATUS.DONE, value: false },
      );
    }),
);

it.effect("Contact us by email opens a new message to Luke's own address and no other", () =>
  Effect.gen(function* () {
    const { router, opened } = fixture(false);

    assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.CONTACT_EMAIL }, PANEL), {
      status: ACT_OUTCOME_STATUS.DONE,
      value: undefined,
    });
    assert.deepEqual(opened, ["mailto:founders@stagereview.app"]);
  }),
);

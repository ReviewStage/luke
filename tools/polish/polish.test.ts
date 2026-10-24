import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { READY_SCRIPT } from "./ready.ts";
import { CLIENT, type Client, drawsOn, pressedOn, SCENES, STEP } from "./scenes.ts";

// jsdom lays nothing out, so a box is given the rectangle it would stand in.
const ON_SCREEN = { width: 20, height: 20, top: 10, left: 10, bottom: 30, right: 30 };
const OFF_SCREEN = { ...ON_SCREEN, top: -100, bottom: -80 };

/** Whether the readiness script calls a page ready, where its body holds `html` and its first box stands at `rect`. */
function readyWith(html: string, rect = ON_SCREEN): boolean {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: "outside-only" });
  const box = dom.window.document.querySelector("[data-box]");
  if (box !== null) box.getBoundingClientRect = () => rect as DOMRect;
  return dom.window.eval(READY_SCRIPT) as boolean;
}

describe("the readiness script", () => {
  it("is ready when nothing waits", () => {
    expect(readyWith("<main>Loaded</main>")).toBe(true);
  });

  it.each([
    ["a skeleton", '<div data-box class="luke-skeleton"></div>'],
    ["a spinner", '<span data-box class="luke-spinner" role="status"></span>'],
    ["a busy region", '<section data-box aria-busy="true"></section>'],
    ["Excalidraw's loading line", '<div data-box class="LoadingMessage">Loading scene…</div>'],
  ])("waits on %s", (_name, html) => {
    expect(readyWith(html)).toBe(false);
  });

  it("does not wait on a spinner scrolled out of view", () => {
    expect(readyWith('<span data-box class="luke-spinner"></span>', OFF_SCREEN)).toBe(true);
  });
});

describe("the scene list", () => {
  it("leaves the desktop-only scenes out of the web client's", () => {
    const web = SCENES.filter((scene) => drawsOn(scene, CLIENT.WEB)).map((scene) => scene.id);
    const desktopOnly = SCENES.filter((scene) => !drawsOn(scene, CLIENT.WEB)).map(
      (scene) => scene.id,
    );
    expect(desktopOnly).toEqual(
      expect.arrayContaining(["voice-speaking", "voice-muted", "voice-duplex", "call-panel"]),
    );
    expect(web).toContain("palette");
    expect(web).not.toContain("voice-speaking");
  });

  it("opens ⌘K with the chord each client answers: Meta on the desktop, a Mac's alone, and Ctrl or Meta on the web as its system has it", () => {
    const palettes = SCENES.filter((scene) => scene.id.startsWith("palette"));
    const chordsOn = (client: Client) =>
      palettes.flatMap((scene) =>
        (scene.steps ?? []).flatMap((step) =>
          step.kind === STEP.PRESS ? [pressedOn(step.keys, client)] : [],
        ),
      );
    expect(palettes).toHaveLength(2);
    expect(chordsOn(CLIENT.DESKTOP)).toEqual(["Meta+K", "Meta+K"]);
    expect(chordsOn(CLIENT.WEB)).toEqual(["ControlOrMeta+K", "ControlOrMeta+K"]);
  });
});

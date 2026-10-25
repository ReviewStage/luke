import { JSDOM } from "jsdom";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { flattenPng } from "./png.ts";
import { READY_SCRIPT } from "./ready.ts";
import { CLIENT, type Client, pressedOn, SCENES, STEP } from "./scenes.ts";
import { PIN_SCROLL_FADES_SCRIPT, scrollScript } from "./scroll.ts";
import { sizedScript } from "./viewport.ts";

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

describe("the scroll script", () => {
  /** A page whose body holds `html`, its boxes scrolled to `top`, and what a scroll of `role` by `by` answered there. */
  function scrolledWith(html: string, top: number, role: string, by: number) {
    const dom = new JSDOM(`<body>${html}</body>`, { runScripts: "outside-only" });
    const boxes = [...dom.window.document.querySelectorAll<HTMLElement>("[data-box]")];
    for (const box of boxes) box.scrollTop = top;
    const found = dom.window.eval(scrollScript(role, by)) as boolean;
    return { found, tops: boxes.map((box) => box.scrollTop) };
  }

  it("scrolls the first box of the role back up by the step's pixels, and no other", () => {
    const html = '<div data-box role="log"></div><div data-box role="log"></div>';

    expect(scrolledWith(html, 900, "log", -600)).toEqual({ found: true, tops: [300, 900] });
  });

  it("answers that it found nothing where no box holds the role", () => {
    const html = '<div data-box role="region"></div>';

    expect(scrolledWith(html, 900, "log", -600)).toEqual({ found: false, tops: [900] });
  });
});

describe("the scroll fade pin", () => {
  it("holds the depths a faded box rests at as important lengths, and leaves a box with no fade be", () => {
    const dom = new JSDOM('<body><div id="faded"></div><div id="plain"></div></body>', {
      runScripts: "outside-only",
    });
    const { document } = dom.window;
    // jsdom runs no scroll timeline, so the box is given the depths one would have eased it to.
    const depths: Record<string, string> = {
      "--luke-scroll-area-fade-start": "0px",
      "--luke-scroll-area-fade-end": "24px",
    };
    dom.window.getComputedStyle = ((box: Element) => ({
      animationName:
        box.id === "faded" ? "luke-scroll-area-fade-start, luke-scroll-area-fade-end" : "none",
      getPropertyValue: (name: string) => depths[name] ?? "",
    })) as unknown as typeof dom.window.getComputedStyle;

    dom.window.eval(PIN_SCROLL_FADES_SCRIPT);

    const faded = document.getElementById("faded")?.style;
    expect(faded?.getPropertyValue("--luke-scroll-area-fade-end")).toBe("24px");
    expect(faded?.getPropertyPriority("--luke-scroll-area-fade-end")).toBe("important");
    expect(document.getElementById("plain")?.style.length).toBe(0);
  });
});

describe("the sized script", () => {
  /** Whether the script for the least window at 125% calls a page laid out at `width` by `height` CSS px sized. */
  function sizedAt(width: number, height: number): boolean {
    const dom = new JSDOM("<body></body>", { runScripts: "outside-only" });
    Object.assign(dom.window, { innerWidth: width, innerHeight: height });
    return dom.window.eval(
      sizedScript({ width: 760, height: 520, zoom: 1.25, phone: false }),
    ) as boolean;
  }

  it("waits while the zoomed window's page still lays out at the window's earlier size, and at its pixels unzoomed", () => {
    expect(sizedAt(1280, 840)).toBe(false);
    expect(sizedAt(760, 520)).toBe(false);
  });

  it("is sized once the page lays out at 608×416 CSS px", () => {
    expect(sizedAt(608, 416)).toBe(true);
  });
});

describe("flattening a picture", () => {
  it("writes every pixel opaque, mixed with the ground by its alpha", () => {
    const picture = new PNG({ width: 3, height: 1 });
    // Clear, half-clear white, and opaque red.
    picture.data.set([10, 20, 30, 0, 255, 255, 255, 128, 200, 0, 0, 255]);
    const flat = PNG.sync.read(
      flattenPng(PNG.sync.write(picture), { red: 32, green: 32, blue: 32 }),
    );

    // (255·128 + 32·127) / 255 = 143.9 for the half-clear white.
    expect([...flat.data]).toEqual([32, 32, 32, 255, 144, 144, 144, 255, 200, 0, 0, 255]);
  });
});

describe("the scene list", () => {
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

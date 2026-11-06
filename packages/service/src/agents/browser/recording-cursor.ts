import { BRAND_PALETTE } from "@repo/brand";
import { BROWSER_RECORDING_POINTER_MARK } from "@repo/features/browser-agent-cdp";
import { RECORDING_CURSOR_FONT } from "./recording-cursor-font.js";

const POINTER = { LIGHT: BRAND_PALETTE.LIGHT.ACCENT, DARK: BRAND_PALETTE.DARK.ACCENT } as const;

function rgba(hex: string, alpha: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

export const RECORDING_CURSOR_FILE = {
  DIRECTORY: "/usr/local/share/agent-recording",
  PATH: "/usr/local/share/agent-recording/cursor.js",
} as const;

export const RECORDING_CURSOR_SOURCE = `(function draw() {
  const root = document.documentElement;
  // A new document runs this before it has a root, so the pointer is drawn once it does.
  if (!root) return document.addEventListener("DOMContentLoaded", draw, { once: true });
  // One pointer a document, however often it is added; the mark stands on the window, so a stop finds it though the page removed the host.
  const mark = Symbol.for(${JSON.stringify(BROWSER_RECORDING_POINTER_MARK)});
  if (window[mark]) return;
  window[mark] = true;
  const GLIDE = 280;
  const REACH = 16;
  const DARK_LUMA = 0.32;
  const EXIT = "cubic-bezier(.4,0,.6,1)";
  const SPRING = "linear(0,.0288,.1002,.1961,.3029,.4113,.5149,.6097,.6935,.7656,.826,.8755,.9149,.9457,.969,.9861,.9982,1.0063,1.0113,1.014,1.0151,1.015,1.0141,1.0127,1.0112,1.0095,1)";
  const svg = "http://www.w3.org/2000/svg";
  const FAMILY = "agent-recording-geist";
  // The key caps' face, from its own bytes; a page that cannot take it sets them in its own sans.
  let face;
  if (typeof FontFace === "function" && document.fonts) {
    try {
      face = new FontFace(FAMILY, Uint8Array.from(atob("${RECORDING_CURSOR_FONT}"), (c) => c.charCodeAt(0)), { weight: "100 900" });
      document.fonts.add(face);
    } catch {
      face = undefined;
    }
  }
  const host = document.createElement("div");
  host.setAttribute("data-ui-recording-cursor", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
  const shadow = host.attachShadow({ mode: "closed" });
  const css = ".c{position:absolute;left:0;top:0;opacity:0;transition:transform " + GLIDE + "ms " + SPRING + ",opacity 140ms " + EXIT + "}.c.on{opacity:1}.h{position:absolute;left:-14px;top:-14px;width:40px;height:40px;border-radius:50%;background:radial-gradient(closest-side,${rgba(POINTER.LIGHT, ".42")},transparent);opacity:0;transition:opacity " + GLIDE + "ms " + EXIT + "}.c.dark .h{background:radial-gradient(closest-side,${rgba(POINTER.DARK, ".5")},transparent)}.c.t .h{opacity:1}.f{transform-origin:0 0}.c.fx .f{scale:-1 1}.c.fy .f{scale:1 -1}.c.fx.fy .f{scale:-1 -1}.a{display:block;width:16px;height:16px;overflow:visible;fill:${POINTER.LIGHT};stroke:#fff;stroke-width:2.4;stroke-linejoin:round;paint-order:stroke;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));transform-origin:0 0}.c.dark .a{fill:${POINTER.DARK}}.r{position:absolute;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;box-sizing:border-box;border:1.5px solid ${POINTER.LIGHT};border-radius:50%;opacity:0}.r.dark{border-color:${POINTER.DARK}}.k{position:absolute;left:50%;bottom:24px;display:flex;align-items:center;gap:12px;padding:7px 12px;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);border-radius:7px;background:#0b0b0c;box-shadow:0 4px 14px rgba(0,0,0,.12);color:rgba(255,255,255,.5);font:500 17px/1 " + FAMILY + ",-apple-system,BlinkMacSystemFont,sans-serif;font-variant-numeric:tabular-nums;opacity:0;transform:translateX(-50%);transition:opacity 140ms " + EXIT + "}.k.on{opacity:1}.k span{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}.k span:last-child{color:rgba(255,255,255,.95)}.k svg{display:block;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}";
  // A constructed sheet, since a page's own style-src may refuse a style element.
  if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet.prototype.replaceSync === "function") {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
  }
  const arrow = document.createElement("div");
  arrow.className = "c";
  const halo = document.createElement("span");
  halo.className = "h";
  const flip = document.createElement("div");
  flip.className = "f";
  const icon = document.createElementNS(svg, "svg");
  icon.setAttribute("class", "a");
  icon.setAttribute("viewBox", "1 1 16 16");
  const path = document.createElementNS(svg, "path");
  path.setAttribute("d", "M1 1 13.07 5.16Q15.2 5.89 13.56 6.58L8.64 8.64 6.58 13.56Q5.89 15.2 5.16 13.07Z");
  icon.append(path);
  flip.append(icon);
  arrow.append(halo, flip);
  const keys = document.createElement("div");
  keys.className = "k";
  shadow.append(arrow, keys);
  root.append(host);
  const stop = new AbortController();
  const on = { capture: true, passive: true, signal: stop.signal };
  const animates = typeof icon.animate === "function";
  let at = { x: -1, y: -1 };
  let movedAt = 0;
  let pressedAt = 0;
  let bob;
  let bobEnd;
  let keysEnd;
  // Each key's glyph as Lucide draws it, its paths in its 24 box, or its name where Lucide draws none.
  const ICONS = {
    Enter: ["M20 4v7a4 4 0 0 1-4 4H4", "m9 10-5 5 5 5"],
    Tab: ["M17 12H3", "m11 18 6-6-6-6", "M21 5v14"],
    Backspace: ["M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z", "m12 9 6 6", "m18 9-6 6"],
    ArrowUp: ["m5 12 7-7 7 7", "M12 19V5"],
    ArrowDown: ["M12 5v14", "m19 12-7 7-7-7"],
    ArrowLeft: ["m12 19-7-7 7-7", "M19 12H5"],
    ArrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
    Control: ["m18 15-6-6-6 6"],
    Alt: ["M14 3h7", "M3 3h5.28a1 1 0 0 1 .948.684l5.544 16.632a1 1 0 0 0 .949.684H21"],
    Shift: ["M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z"],
    Meta: ["M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"],
  };
  const NAMES = { Escape: "Esc", Delete: "Del", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn" };
  const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);
  // Whether the page is dark just inside the arrow's tip: the first background there that mostly covers what is under it, by its luminance.
  const darkAt = (x, y) => {
    if (typeof document.elementsFromPoint !== "function") return false;
    for (const element of document.elementsFromPoint(x + 4, y + 4)) {
      const channels = getComputedStyle(element).backgroundColor.match(/[\\d.]+/g);
      if (!channels || channels.length < 3 || (channels.length > 3 && Number(channels[3]) < 0.5)) continue;
      const linear = (byte) => {
        const channel = Number(byte) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]) < DARK_LUMA;
    }
    return false;
  };
  const moveTo = (x, y) => {
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    if (x !== at.x || y !== at.y) movedAt = Date.now();
    at = { x, y };
    arrow.style.transform = "translate(" + x + "px," + y + "px)";
    arrow.classList.toggle("fx", x > innerWidth - REACH);
    arrow.classList.toggle("fy", y > innerHeight - REACH);
    arrow.classList.toggle("dark", darkAt(x, y));
    arrow.classList.add("on");
  };
  // How long until the arrow, still gliding, arrives where it last moved.
  const arrival = () => Math.max(0, movedAt + GLIDE - Date.now());
  // The ripple marks the press where and when the page heard it, and the arrow presses once it arrives.
  const pressAt = (x, y) => {
    if (!animates) return;
    icon.animate([{ transform: "scale(1)" }, { transform: "scale(.82)", offset: 0.45 }, { transform: "scale(1)" }], { duration: GLIDE, delay: arrival(), easing: EXIT });
    const ring = document.createElement("div");
    ring.className = arrow.classList.contains("dark") ? "r dark" : "r";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    shadow.append(ring);
    const ripple = ring.animate([{ opacity: 0, transform: "scale(.3)" }, { opacity: 0.6, offset: 0.15 }, { opacity: 0, transform: "scale(1.6)" }], { duration: 460, easing: EXIT });
    ripple.onfinish = () => ring.remove();
  };
  // Typing bobs the arrow over its glow until the keys have stopped for a beat.
  const bobOnce = () => {
    arrow.classList.add("t");
    if (animates && !bob) bob = icon.animate([{ translate: "0 0" }, { translate: "0 -2px" }, { translate: "0 0" }], { duration: 600, iterations: Infinity, easing: "ease-in-out" });
    clearTimeout(bobEnd);
    bobEnd = setTimeout(() => {
      arrow.classList.remove("t");
      bob?.cancel();
      bob = undefined;
    }, 700);
  };
  // A key's glyphs, its modifiers first in a Mac menu's order, each a Lucide icon's name or a word; none for a modifier alone or a key that only types text.
  const capsOf = (event) => {
    if (MODIFIERS.has(event.key)) return undefined;
    const chord = event.metaKey || event.ctrlKey || event.altKey;
    const icon = Object.hasOwn(ICONS, event.key) ? { icon: event.key } : undefined;
    const name = Object.hasOwn(NAMES, event.key) ? NAMES[event.key] : /^F\\d{1,2}$/.test(event.key) ? event.key : undefined;
    if (icon === undefined && name === undefined && !chord) return undefined;
    const code = event.code || "";
    const word = name ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\\d$/.test(code) ? code.slice(5) : event.key === " " ? "Space" : event.key.toUpperCase());
    const held = [["Control", event.ctrlKey], ["Alt", event.altKey], ["Shift", event.shiftKey], ["Meta", event.metaKey]].filter(([, down]) => down).map(([modifier]) => ({ icon: modifier }));
    return [...held, icon ?? { word }];
  };
  const glyphOf = (part) => {
    if (part.word !== undefined) return document.createTextNode(part.word);
    const drawn = document.createElementNS(svg, "svg");
    drawn.setAttribute("viewBox", "0 0 24 24");
    for (const d of ICONS[part.icon]) {
      const line = document.createElementNS(svg, "path");
      line.setAttribute("d", d);
      drawn.append(line);
    }
    return drawn;
  };
  // The last three keys stand on the pill, which fades a beat after the last.
  const showKeys = (event) => {
    const caps = capsOf(event);
    if (caps === undefined) return;
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    const cap = document.createElement("span");
    cap.append(...caps.map(glyphOf));
    keys.append(cap);
    while (keys.childElementCount > 3) keys.firstElementChild.remove();
    keys.classList.add("on");
    clearTimeout(keysEnd);
    keysEnd = setTimeout(() => {
      keys.classList.remove("on");
      keysEnd = setTimeout(() => keys.replaceChildren(), 200);
    }, 1200);
  };
  const middleOf = (target) => {
    if (!(target instanceof Element)) return undefined;
    const box = target.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined;
  };
  const place = (event) => moveTo(event.clientX, event.clientY);
  window.addEventListener("mousemove", place, on);
  window.addEventListener("wheel", place, on);
  window.addEventListener("mousedown", (event) => {
    pressedAt = Date.now();
    place(event);
    pressAt(event.clientX, event.clientY);
  }, on);
  window.addEventListener("beforeinput", bobOnce, on);
  window.addEventListener("keydown", (event) => {
    bobOnce();
    showKeys(event);
  }, on);
  // Typing by ref focuses its field and a choice sets its dropdown, neither with the mouse, so the pointer goes to the field it lands in.
  window.addEventListener("focusin", (event) => {
    if (Date.now() - pressedAt < 400) return;
    const middle = middleOf(event.target);
    if (middle) moveTo(middle.x, middle.y);
  }, on);
  window.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const middle = middleOf(event.target);
    if (!middle) return;
    moveTo(middle.x, middle.y);
    pressAt(middle.x, middle.y);
  }, on);
  window.addEventListener("agent-recording-stop", () => {
    stop.abort();
    clearTimeout(bobEnd);
    clearTimeout(keysEnd);
    if (face) document.fonts.delete(face);
    host.remove();
    delete window[mark];
  }, { once: true });
})();`;

export const RECORDING_CURSOR_STOP = 'window.dispatchEvent(new Event("agent-recording-stop"));';

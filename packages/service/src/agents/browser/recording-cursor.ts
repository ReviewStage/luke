/**
 * recording-cursor.ts -- the agent's pointer drawn into a page while it is recorded, as the panel draws it over the live view: the source a page runs, the word that takes it out, and the file the sandbox image keeps it in.
 *
 * A video's frames are the page's own, and the pointer the panel draws over
 * a cloud Browser tab's live view is no part of them
 * (`@repo/panel`'s `cloud-browser-cursor.tsx`), so the pointer is drawn into
 * the page instead, in the panel's look. Two recorders add it: the browser
 * tool's (`sandbox-recorder.ts`), to every page it records, and an agent's own
 * Playwright script, which the coder's instructions tell to add the image's
 * copy (`RECORDING_CURSOR_FILE`) before it records a flow. Both send input a
 * page hears as a person's, so the one source follows either.
 *
 * Self-contained, since the sandbox image (`agent-runtime/sandbox-image.ts`)
 * reaches it.
 */

/**
 * Where the sandbox image keeps the pointer's source, every user's to read,
 * for a script to hand Playwright's `page.addInitScript({ path })`.
 */
export const RECORDING_CURSOR_FILE = {
  DIRECTORY: "/usr/local/share/agent-recording",
  PATH: "/usr/local/share/agent-recording/cursor.js",
} as const;

/**
 * The agent's pointer, drawn into each page while it is recorded: the
 * panel's arrow on its soft halo, in a closed shadow root on the document's
 * root, hidden from the accessibility tree and taking no pointer events. It
 * follows the input the agent sends, which a page hears as a person's
 * (`@repo/features/browser-agent-cdp`), gliding to each point on the panel's
 * spring (`--ui-spring-fast` over `--ui-duration-fast`), and once it arrives a
 * press presses it, with a ripple at the point, and typing bobs it; over a
 * dark page it is drawn in the panel's lighter grey, and near the page's
 * right or bottom edge it is mirrored about its tip. A key a viewer could
 * not otherwise see, such as Enter, Tab, Escape, an arrow, or a shortcut,
 * shows as key caps on a pill at the foot of the page, which fades a beat
 * after the last one; a key that only types text never does, since the
 * field shows that itself and it may be a password. The panel's tokens are
 * no part of the page, so their values are written out here: hold them to
 * `--agent-pointer`, `--agent-pointer-on-dark`, and `--agent-pointer-halo`,
 * and to the `.cloud-browser-cursor` rules. Note that it does not rock while
 * still, as the panel's does while the agent works, because a video shows the
 * agent only as it acts.
 */
export const RECORDING_CURSOR_SOURCE = `(function draw() {
  const root = document.documentElement;
  // A new document runs this before it has a root, so the pointer is drawn once it does.
  if (!root) return document.addEventListener("DOMContentLoaded", draw, { once: true });
  // One pointer a document, however often it is added; the mark stands on the window, so a stop finds it though the page removed the host.
  const mark = Symbol.for("agent.recordingCursor");
  if (window[mark]) return;
  window[mark] = true;
  const GLIDE = 280;
  const REACH = 16;
  const DARK_LUMA = 0.32;
  const EXIT = "cubic-bezier(.4,0,.6,1)";
  const SPRING = "linear(0,.0288,.1002,.1961,.3029,.4113,.5149,.6097,.6935,.7656,.826,.8755,.9149,.9457,.969,.9861,.9982,1.0063,1.0113,1.014,1.0151,1.015,1.0141,1.0127,1.0112,1.0095,1)";
  const svg = "http://www.w3.org/2000/svg";
  const host = document.createElement("div");
  host.setAttribute("data-ui-recording-cursor", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;";
  const shadow = host.attachShadow({ mode: "closed" });
  const css = ".c{position:absolute;left:0;top:0;opacity:0;transition:transform " + GLIDE + "ms " + SPRING + ",opacity 140ms " + EXIT + "}.c.on{opacity:1}.h{position:absolute;left:-14px;top:-14px;width:40px;height:40px;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.2),transparent)}.f{transform-origin:0 0}.c.fx .f{scale:-1 1}.c.fy .f{scale:1 -1}.c.fx.fy .f{scale:-1 -1}.a{display:block;width:16px;height:16px;overflow:visible;fill:rgba(107,111,118,.9);stroke:rgba(107,111,118,.9);stroke-width:.6;stroke-linejoin:round;transform-origin:0 0}.c.dark .a{fill:rgba(206,209,214,.92);stroke:rgba(206,209,214,.92)}.r{position:absolute;left:0;top:0;width:24px;height:24px;margin:-12px 0 0 -12px;box-sizing:border-box;border:1px solid rgba(107,111,118,.9);border-radius:50%;opacity:0}.r.dark{border-color:rgba(206,209,214,.92)}.k{position:absolute;left:50%;bottom:24px;display:flex;gap:6px;padding:6px;border-radius:10px;background:rgba(31,35,40,.82);color:#fff;font:500 15px/1 system-ui,-apple-system,sans-serif;opacity:0;transform:translateX(-50%);transition:opacity 140ms " + EXIT + "}.k.on{opacity:1}.k span{min-width:14px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);text-align:center;white-space:nowrap}";
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
  path.setAttribute("d", "M1 1 11.94 6.29Q13.87 7.22 12.56 7.58L8.64 8.64 7.58 12.56Q7.22 13.87 6.29 11.94Z");
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
  const NAMED = { Enter: "\u23ce", Tab: "\u21e5", Backspace: "\u232b", Delete: "\u2326", Escape: "Esc", ArrowUp: "\u2191", ArrowDown: "\u2193", ArrowLeft: "\u2190", ArrowRight: "\u2192", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn" };
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
  const pressAt = (x, y) => {
    if (!animates) return;
    const delay = arrival();
    icon.animate([{ transform: "scale(1)" }, { transform: "scale(.82)", offset: 0.45 }, { transform: "scale(1)" }], { duration: GLIDE, delay, easing: EXIT });
    const ring = document.createElement("div");
    ring.className = arrow.classList.contains("dark") ? "r dark" : "r";
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    shadow.append(ring);
    const ripple = ring.animate([{ opacity: 0, transform: "scale(.3)" }, { opacity: 0.6, offset: 0.15 }, { opacity: 0, transform: "scale(1.6)" }], { duration: 460, delay, easing: EXIT });
    ripple.onfinish = () => ring.remove();
  };
  // Typing bobs the arrow until the keys have stopped for a beat.
  const bobOnce = () => {
    if (!animates) return;
    if (!bob) bob = icon.animate([{ translate: "0 0" }, { translate: "0 -2px" }, { translate: "0 0" }], { duration: 600, iterations: Infinity, easing: "ease-in-out" });
    clearTimeout(bobEnd);
    bobEnd = setTimeout(() => {
      bob?.cancel();
      bob = undefined;
    }, 700);
  };
  // A key's caps, its modifiers first; none for a modifier alone or a key that only types text.
  const capsOf = (event) => {
    if (MODIFIERS.has(event.key)) return undefined;
    const chord = event.metaKey || event.ctrlKey || event.altKey;
    const named = Object.hasOwn(NAMED, event.key) ? NAMED[event.key] : /^F\\d{1,2}$/.test(event.key) ? event.key : undefined;
    if (named === undefined && !chord) return undefined;
    const code = event.code || "";
    const key = named ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\\d$/.test(code) ? code.slice(5) : event.key === " " ? "Space" : event.key.toUpperCase());
    return (event.ctrlKey ? "\u2303" : "") + (event.altKey ? "\u2325" : "") + (event.shiftKey ? "\u21e7" : "") + (event.metaKey ? "\u2318" : "") + key;
  };
  // The last three keys stand on the pill, which fades a beat after the last.
  const showKeys = (event) => {
    const caps = capsOf(event);
    if (caps === undefined) return;
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    const cap = document.createElement("span");
    cap.textContent = caps;
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
    host.remove();
    delete window[mark];
  }, { once: true });
})();`;

/** Takes the pointer out of a document, its listeners with it, whether or not the page kept its host. */
export const RECORDING_CURSOR_STOP = 'window.dispatchEvent(new Event("agent-recording-stop"));';

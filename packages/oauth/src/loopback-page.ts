import { FACE_ART } from "@sidecar/surface";

/**
 * The two pages the ephemeral 127.0.0.1 server ever serves: the continue page
 * a sign-in starts on, and the landing page the OAuth redirect leaves the
 * browser on. They bracket the consent trip, so they dress like the sign-in
 * and consent pages between them — one dark card, the mark, a line saying
 * where things stand — rather than a line of bare text. Self-contained on
 * purpose: the server serves exactly these documents, so nothing here may
 * fetch a font, a script, or an image from anywhere.
 *
 * Every string on either page is fixed by the build, with one exception the
 * continue page exists to carry: the flow's own authorization URL, composed by
 * the flow that serves the page and escaped where it lands. Nothing the
 * redirect carried — code, state, error — is ever interpolated into either
 * document.
 */
export const LOOPBACK_PAGE_TONE = {
  /** The sign-in reached a resting state worth a green pill. */
  SETTLED: "settled",
  /** Something needs the user back in Luke. */
  ATTENTION: "attention",
} as const;

export type LoopbackPageTone = (typeof LOOPBACK_PAGE_TONE)[keyof typeof LOOPBACK_PAGE_TONE];

export interface LoopbackPage {
  tone: LoopbackPageTone;
  /** The pill's one word or two: "Signed in", "Not completed". */
  badge: string;
  title: string;
  body: string;
  /**
   * A success page the user needs nothing more from asks the browser to close
   * its own tab once the outcome has had time to be read, saying so on the
   * page while it counts down. Best-effort by design: a browser may refuse to
   * close a tab the user navigated, so the countdown note removes itself on a
   * refusal and the body keeps saying the tab can be closed by hand.
   */
  closesItself?: boolean;
}

/**
 * The page a sign-in starts on, and the reason the landing page's close is
 * honored at all: a browser lets a script close only a tab that web content
 * created, and a tab the user then navigated through a consent flow refuses
 * `window.close()` outright. So the flow's first stop is this page, served by
 * the same loopback, whose one link opens the provider's consent in a tab of
 * its own — a tab created by web content, which stays script-closable through
 * every consent navigation and even a provider's COOP severing the opener —
 * and then closes itself, a close its own single-entry history allows.
 */
export interface LoopbackContinuePage {
  title: string;
  body: string;
  /** The link's own words: "Continue to Google". */
  action: string;
  /**
   * The provider's authorization URL, composed by the flow serving this page.
   * The one value on either page the build does not fix — and still never
   * anything a redirect carried.
   */
  authorizationUrl: string;
}

/** Long enough to read the outcome; short enough to not overstay it. */
const CLOSE_DELAY_SECONDS = 5;

/**
 * Inline and fixed by the build like everything else on the page — the
 * self-contained rule above forbids fetching a script, not carrying one. The
 * script owns the countdown note's words outright: with scripting off nothing
 * would close, so nothing says it will, and a browser that refuses the close
 * is answered by taking the note away rather than leaving a promise standing.
 */
const CLOSE_SCRIPT =
  `<script>(function () {` +
  `var left = ${CLOSE_DELAY_SECONDS};` +
  `var note = document.getElementById("close-note");` +
  `var say = function () {` +
  ` note.textContent = "This tab will close itself in " + left + (left === 1 ? " second." : " seconds.");` +
  `};` +
  `say();` +
  `var timer = setInterval(function () {` +
  ` left -= 1;` +
  ` if (left > 0) { say(); return; }` +
  ` clearInterval(timer);` +
  ` window.close();` +
  ` setTimeout(function () { note.remove(); }, 400);` +
  `}, 1000);` +
  `})();</script>`;

const CLOSE_NOTE = `<p class="close-note" id="close-note"></p>`;

/**
 * The continue page's script owns every promise about closing, so with
 * scripting off the page makes none and its link still works. On the click
 * that opens the consent tab this page's work is done, and it closes itself a
 * beat later; where a browser refuses even that, the note stops promising and
 * offers the by-hand close instead. The statements after `window.close()` run
 * only on a refusal — a closed page runs nothing.
 */
const CONTINUE_SCRIPT =
  `<script>(function () {` +
  `var note = document.getElementById("close-note");` +
  `note.textContent = "This stop is what lets the tabs close themselves when the sign-in is done.";` +
  `document.getElementById("continue").addEventListener("click", function () {` +
  ` setTimeout(function () {` +
  `  window.close();` +
  `  note.textContent = "The sign-in is open in a tab of its own. You can close this one.";` +
  ` }, 250);` +
  `});` +
  `})();</script>`;

/**
 * The face, drawn from the same generated constants the renderer draws it
 * from, so this copy cannot drift from the artwork. The tight viewBox is the
 * mark's own, as the landing page crops it.
 */
function markSvg(ink = "currentColor"): string {
  const { TILT, SMILE, STROKE_WIDTH, EYE_X, EYE_Y, EYE_RADIUS } = FACE_ART;
  return (
    `<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="53.85 62.67 134.29 122.37" fill="none" aria-hidden="true">` +
    `<g transform="${TILT}">` +
    `<path d="${SMILE}" fill="none" stroke="${ink}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${EYE_X.LEFT}" cy="${EYE_Y}" r="${EYE_RADIUS}" fill="${ink}"/>` +
    `<circle cx="${EYE_X.RIGHT}" cy="${EYE_Y}" r="${EYE_RADIUS}" fill="${ink}"/>` +
    `</g></svg>`
  );
}

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #08090b;
    color: rgba(255, 255, 255, 0.92);
    font-family: -apple-system, blinkmacsystemfont, "SF Pro Display", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card {
    width: min(100%, 390px);
    padding: 48px 32px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 17px;
    background: #000;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    text-align: center;
  }
  .mark { width: 52px; height: auto; color: rgba(255, 255, 255, 0.92); }
  .pill {
    display: inline-block;
    margin-top: 16px;
    padding: 3px 11px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.2px;
    background: rgba(111, 220, 164, 0.14);
    color: #6fdca4;
  }
  .pill[data-tone="attention"] { background: rgba(255, 160, 73, 0.14); color: #ffa049; }
  h1 { margin: 12px 0 8px; font-size: 1.375rem; line-height: 1.2; }
  p { margin: 0; color: rgba(255, 255, 255, 0.56); font-size: 0.9375rem; line-height: 1.6; }
  .continue {
    display: inline-block;
    margin-top: 22px;
    padding: 10px 24px;
    border-radius: 999px;
    background: #f5f5f7;
    color: #08090b;
    font-size: 0.9375rem;
    font-weight: 650;
    text-decoration: none;
  }
  .close-note {
    margin-top: 18px;
    font-size: 0.8125rem;
    color: rgba(255, 255, 255, 0.38);
    font-variant-numeric: tabular-nums;
  }
`;

/** The authorization URL is the flows' own, but an attribute takes no chances. */
function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cardDocument(title: string, card: string, script: string): string {
  // The same mark as the tab's icon, travelling inside the document like
  // everything else on it: a data URL fetches nothing from anywhere. Inked
  // outright, because `currentColor` resolves to black outside the page.
  const favicon = encodeURIComponent(markSvg("#f5f5f7"));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="dark">` +
    `<link rel="icon" href="data:image/svg+xml;utf8,${favicon}">` +
    `<title>${title}</title><style>${PAGE_STYLE}</style></head>` +
    `<body><main class="shell"><section class="card">` +
    card +
    `</section></main>${script}</body></html>`
  );
}

export function accountLoopbackPage(page: LoopbackPage): string {
  return cardDocument(
    page.title,
    markSvg() +
      `<div><span class="pill" data-tone="${page.tone}">${page.badge}</span></div>` +
      `<h1>${page.title}</h1><p>${page.body}</p>` +
      (page.closesItself ? CLOSE_NOTE : ""),
    page.closesItself ? CLOSE_SCRIPT : "",
  );
}

export function loopbackContinuePage(page: LoopbackContinuePage): string {
  // `target="_blank"` is what makes the consent tab web-created and so
  // script-closable; `rel="opener"` undoes the implicit `noopener` such a
  // link now carries, which would otherwise hand the provider a tab no
  // script may close. Nothing is ever done with the opener handle itself —
  // this page is gone a beat after the click.
  return cardDocument(
    page.title,
    markSvg() +
      `<h1>${page.title}</h1><p>${page.body}</p>` +
      `<a class="continue" id="continue" href="${escapeAttribute(page.authorizationUrl)}" target="_blank" rel="opener">${page.action}</a>` +
      CLOSE_NOTE,
    CONTINUE_SCRIPT,
  );
}

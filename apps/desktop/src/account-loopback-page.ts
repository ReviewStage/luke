import { FACE_ART } from "./renderer/luke-face-art";

/**
 * The page the browser is left on after the OAuth redirect lands on the
 * loopback. It is the last thing the sign-in shows, so it dresses like the
 * sign-in and consent pages before it — one dark card, the mark, a status
 * pill, and a line saying where things stand — rather than a line of bare
 * text. Self-contained on purpose: the ephemeral 127.0.0.1 server serves
 * exactly one document, so nothing here may fetch a font, a script, or an
 * image from anywhere.
 *
 * Every string on the page is fixed by the build. Nothing the redirect
 * carried — code, state, error — is ever interpolated into the document.
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
}

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
`;

export function accountLoopbackPage(page: LoopbackPage): string {
  // The same mark as the tab's icon, travelling inside the document like
  // everything else on it: a data URL fetches nothing from anywhere. Inked
  // outright, because `currentColor` resolves to black outside the page.
  const favicon = encodeURIComponent(markSvg("#f5f5f7"));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="dark">` +
    `<link rel="icon" href="data:image/svg+xml;utf8,${favicon}">` +
    `<title>${page.title}</title><style>${PAGE_STYLE}</style></head>` +
    `<body><main class="shell"><section class="card">` +
    markSvg() +
    `<div><span class="pill" data-tone="${page.tone}">${page.badge}</span></div>` +
    `<h1>${page.title}</h1><p>${page.body}</p>` +
    `</section></main></body></html>`
  );
}

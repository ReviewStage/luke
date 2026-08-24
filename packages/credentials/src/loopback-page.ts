import { FACE_ART, GOOGLE_CALENDAR_MARK_LAYERS, LINEAR_PATH } from "@sidecar/surface";

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

export const LOOPBACK_CONNECTION_SOURCE = {
  GOOGLE: "google",
  GITHUB: "github",
  GOOGLE_CALENDAR: "google-calendar",
  LINEAR: "linear",
} as const;

export type LoopbackConnectionSource =
  (typeof LOOPBACK_CONNECTION_SOURCE)[keyof typeof LOOPBACK_CONNECTION_SOURCE];

export interface LoopbackPage {
  tone: LoopbackPageTone;
  /** The pill's one word or two: "Signed in", "Not completed". */
  badge: string;
  title: string;
  body: string;
  source?: LoopbackConnectionSource;
}

/**
 * The face, drawn from the same generated constants the renderer draws it
 * from, so this copy cannot drift from the artwork. The tight viewBox is the
 * mark's own, as the landing page crops it.
 */
function markSvg(ink = "currentColor", className = "mark"): string {
  const { MARK_VIEW_BOX, TILT, SMILE, STROKE_WIDTH, EYE_X, EYE_Y, EYE_RADIUS } = FACE_ART;
  return (
    `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEW_BOX}" fill="none" aria-hidden="true">` +
    `<g transform="${TILT}">` +
    `<path d="${SMILE}" fill="none" stroke="${ink}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${EYE_X.LEFT}" cy="${EYE_Y}" r="${EYE_RADIUS}" fill="${ink}"/>` +
    `<circle cx="${EYE_X.RIGHT}" cy="${EYE_Y}" r="${EYE_RADIUS}" fill="${ink}"/>` +
    `</g></svg>`
  );
}

function googleMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-google" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" aria-hidden="true">` +
    `<path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>` +
    `<path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>` +
    `<path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>` +
    `<path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>` +
    `</svg>`
  );
}

const GITHUB_MARK_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z";

function githubMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-github" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">` +
    `<path fill="currentColor" d="${GITHUB_MARK_PATH}"/>` +
    `</svg>`
  );
}

function googleCalendarMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-google-calendar" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" aria-hidden="true">` +
    `<g transform="translate(3.75 3.75)">` +
    GOOGLE_CALENDAR_MARK_LAYERS.map(
      (layer) => `<path fill="${layer.fill}" d="${layer.path}"/>`,
    ).join("") +
    `</g></svg>`
  );
}

function linearMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-linear" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path fill="currentColor" d="${LINEAR_PATH}"/>` +
    `</svg>`
  );
}

function providerMarkSvg(source: LoopbackConnectionSource): string {
  switch (source) {
    case LOOPBACK_CONNECTION_SOURCE.GOOGLE:
      return googleMarkSvg();
    case LOOPBACK_CONNECTION_SOURCE.GITHUB:
      return githubMarkSvg();
    case LOOPBACK_CONNECTION_SOURCE.GOOGLE_CALENDAR:
      return googleCalendarMarkSvg();
    case LOOPBACK_CONNECTION_SOURCE.LINEAR:
      return linearMarkSvg();
  }
}

function connectionGraphic(source: LoopbackConnectionSource | undefined): string {
  if (!source) return `<div class="solo-mark">${markSvg()}</div>`;
  return (
    `<div class="connection" aria-hidden="true">` +
    providerMarkSvg(source) +
    `<svg class="arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    `<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>` +
    markSvg("currentColor", "mark mark-connection") +
    `</div>`
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
    width: min(100%, 430px);
    padding: 40px 32px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: #101114;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    text-align: center;
  }
  .solo-mark { display: inline-flex; margin-bottom: 4px; }
  .mark { width: 52px; height: auto; color: rgba(255, 255, 255, 0.92); }
  .connection {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 0 auto 20px;
  }
  .provider-mark { display: block; width: 38px; height: 38px; flex: 0 0 auto; color: rgba(255, 255, 255, 0.92); }
  .provider-mark-google { width: 38px; height: 38px; }
  .provider-mark-github { width: 38px; height: 38px; }
  .provider-mark-google-calendar { width: 42px; height: 42px; }
  .provider-mark-linear { width: 38px; height: 38px; color: #5e6ad2; }
  .mark-connection { width: 48px; flex: 0 0 auto; }
  .arrow { width: 24px; height: 24px; color: rgba(255, 255, 255, 0.56); flex: 0 0 auto; }
  .pill {
    display: inline-block;
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
    connectionGraphic(page.source) +
    `<div><span class="pill" data-tone="${page.tone}">${page.badge}</span></div>` +
    `<h1>${page.title}</h1><p>${page.body}</p>` +
    `</section></main></body></html>`
  );
}

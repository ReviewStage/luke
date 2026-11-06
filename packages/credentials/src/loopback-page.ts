import { BRAND_PALETTE, GITHUB_PATH, GOOGLE_MARK_LAYERS, MARK_ART } from "@repo/brand";

export const LOOPBACK_PAGE_TONE = {
  COMPLETE: "complete",
  ATTENTION: "attention",
} as const;

export type LoopbackPageTone = (typeof LOOPBACK_PAGE_TONE)[keyof typeof LOOPBACK_PAGE_TONE];

export const LOOPBACK_CONNECTION_SOURCE = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type LoopbackConnectionSource =
  (typeof LOOPBACK_CONNECTION_SOURCE)[keyof typeof LOOPBACK_CONNECTION_SOURCE];

interface LoopbackPage {
  tone: LoopbackPageTone;
  badge: string;
  title: string;
  body: string;
  source?: LoopbackConnectionSource | undefined;
}

function markSvg(ink = "currentColor", className = "mark"): string {
  return (
    `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_ART.VIEW_BOX}" aria-hidden="true">` +
    `<path d="${MARK_ART.PATH}" fill="${ink}"/></svg>`
  );
}

function googleMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-google" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" aria-hidden="true">` +
    GOOGLE_MARK_LAYERS.map((layer) => `<path fill="${layer.fill}" d="${layer.path}"/>`).join("") +
    `</svg>`
  );
}

function githubMarkSvg(): string {
  return (
    `<svg class="provider-mark provider-mark-github" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">` +
    `<path fill="currentColor" d="${GITHUB_PATH}"/>` +
    `</svg>`
  );
}

function providerMarkSvg(source: LoopbackConnectionSource): string {
  switch (source) {
    case LOOPBACK_CONNECTION_SOURCE.GOOGLE:
      return googleMarkSvg();
    case LOOPBACK_CONNECTION_SOURCE.GITHUB:
      return githubMarkSvg();
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

const INK = BRAND_PALETTE.DARK;

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${INK.GROUND};
    color: ${INK.TEXT};
    font-family: -apple-system, blinkmacsystemfont, "SF Pro Display", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card {
    width: min(100%, 430px);
    padding: 40px 32px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    background: ${INK.OVERLAY};
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    text-align: center;
  }
  .solo-mark { display: inline-flex; margin-bottom: 4px; }
  .mark { width: 52px; height: auto; color: ${INK.TEXT}; }
  .connection {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 0 auto 20px;
  }
  .provider-mark { display: block; width: 38px; height: 38px; flex: 0 0 auto; color: ${INK.TEXT}; }
  .provider-mark-google { width: 38px; height: 38px; }
  .provider-mark-github { width: 38px; height: 38px; }
  .mark-connection { width: 48px; flex: 0 0 auto; }
  .arrow { width: 24px; height: 24px; color: ${INK.TEXT_MUTED}; flex: 0 0 auto; }
  .pill {
    display: inline-block;
    padding: 3px 11px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 650;
    letter-spacing: 0.2px;
    background: color-mix(in srgb, ${INK.COMPLETE} 14%, transparent);
    color: ${INK.COMPLETE};
  }
  .pill[data-tone="attention"] { background: color-mix(in srgb, ${INK.ATTENTION} 14%, transparent); color: ${INK.ATTENTION}; }
  h1 { margin: 12px 0 8px; font-size: 1.375rem; line-height: 1.2; }
  p { margin: 0; color: ${INK.TEXT_MUTED}; font-size: 0.9375rem; line-height: 1.6; }
`;

export function accountLoopbackPage(page: LoopbackPage): string {
  const favicon = encodeURIComponent(markSvg(INK.TEXT));
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

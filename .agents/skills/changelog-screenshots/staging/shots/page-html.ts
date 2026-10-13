/**
 * page-html.ts -- shot H's pages: the plan's two page lines and the "Invite flow" mockup's HTML at each version, read by the renderer's staging and by main's `luke-page:` hook alike.
 *
 * Throwaway (`README.md`). Imports nothing, so `main` can import it without
 * pulling a renderer module in: in a fixture run under `--profile shot-pages`,
 * `main/services/window-service.ts` answers the page frame from here
 * (`shotPageRead`). Each version is one self-contained document, inline CSS
 * and JS, the system font, no network, as the page policy demands.
 */

/** The ids the shot's pages go by, so the planning view and main's answer agree. */
export const SHOT_PAGE_ID = {
  INVITE_FLOW: "f4a5b6c7-d8e9-4f0a-9b1c-2d3e4f5a6b7c",
  EXPIRY: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
} as const;

export const SHOT_PAGE_TITLE = {
  INVITE_FLOW: "Invite flow",
  EXPIRY: "Expiry options",
} as const;

/** The profile main serves these pages under; `RUN_PROFILE.SHOT_PAGES`, spelled here so main imports nothing of the renderer's. */
export const SHOT_PAGES_PROFILE = "shot-pages";

const STYLE = `
:root { color-scheme: light; --bg: #f3f1ec; --card: #ffffff; --raised: #f4f4f2; --line: #e2e0da;
  --text: #1b1d21; --muted: #5f646d; --faint: #8b9099; --accent: #0f766e; --accent-soft: rgba(15,118,110,.10); }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
body { padding: 28px 32px 36px; }
header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
h1 { margin: 0 0 4px; font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
.sub { color: var(--muted); }
.seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--card); border: 1px solid var(--line); border-radius: 9px; }
.seg button { border: 0; background: transparent; color: var(--muted); font: inherit; font-weight: 500;
  padding: 5px 12px; border-radius: 6px; cursor: pointer; }
.seg button.on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.stage { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.stage.one { grid-template-columns: 1fr; max-width: 440px; margin: 0 auto; }
.screen { display: flex; flex-direction: column; gap: 10px; }
.screen.hidden { display: none; }
.label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-weight: 500; }
.step { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
  background: var(--raised); border: 1px solid var(--line); color: var(--text); font-size: 11px; font-weight: 600; }
.frame { position: relative; flex: 1; min-height: 410px; border: 1px solid var(--line); border-radius: 14px;
  background: radial-gradient(120% 80% at 50% 0%, #fbfaf7 0%, #ece9e2 70%); padding: 26px 22px;
  display: flex; align-items: center; justify-content: center; overflow: hidden; }
.dialog { width: 100%; max-width: 360px; background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 18px 40px rgba(40,36,28,.14), 0 2px 6px rgba(40,36,28,.06); }
.dialog .head { padding: 18px 20px 4px; }
.dialog h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.dialog .body { padding: 14px 20px 6px; display: flex; flex-direction: column; gap: 14px; }
.field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 500; }
.input { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 11px; border-radius: 8px;
  background: #ffffff; border: 1px solid var(--line); color: var(--text); }
.input.focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.caret { width: 1px; height: 16px; background: var(--accent); animation: blink 1.1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.roles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.role { text-align: left; border: 1px solid var(--line); background: #ffffff; color: var(--text); border-radius: 8px;
  padding: 9px 11px; font: inherit; cursor: pointer; }
.role b { display: block; font-weight: 600; font-size: 13px; }
.role span { color: var(--faint); font-size: 11.5px; }
.role.on { border-color: var(--accent); background: var(--accent-soft); }
.role.on span { color: #0f766e; }
.note { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 12px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex: none; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px 18px; }
.btn { height: 32px; padding: 0 14px; border-radius: 8px; font: inherit; font-weight: 550; cursor: pointer; border: 1px solid var(--line);
  background: var(--raised); color: var(--text); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn.wide { width: 100%; height: 36px; }
.toast { position: absolute; left: 50%; bottom: 18px; transform: translate(-50%, 12px); opacity: 0;
  transition: opacity .2s, transform .2s; background: var(--raised); border: 1px solid var(--line); border-radius: 9px;
  padding: 8px 12px; font-size: 12px; display: flex; gap: 8px; align-items: center; white-space: nowrap; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.check { color: #5ad19a; font-weight: 700; }
.accept { width: 100%; max-width: 330px; text-align: center; }
.logo { width: 52px; height: 52px; margin: 0 auto 16px; border-radius: 13px; display: grid; place-items: center;
  font-size: 22px; font-weight: 700; color: #fff; overflow: hidden; box-shadow: 0 10px 28px rgba(15,118,110,.35); }
.avatars { display: flex; justify-content: center; margin: 0 0 14px; }
.avatars i { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #ffffff; margin-left: -6px; display: grid;
  place-items: center; font-style: normal; font-size: 9.5px; letter-spacing: -0.02em; font-weight: 650; color: #0c0c0d; }
.avatars i:first-child { margin-left: 0; }
.accept h2 { margin: 0 0 6px; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
.accept p { margin: 0 0 18px; color: var(--muted); }
.pill { display: inline-block; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); color: #0f766e; font-weight: 550; }
.who { margin-top: 14px; color: var(--faint); font-size: 12px; }
.who a { color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
.members { margin-top: 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); overflow: hidden; }
.members .label { padding: 12px 16px; border-bottom: 1px solid var(--line); }
.row { display: grid; grid-template-columns: 30px 1fr 90px 170px 80px; align-items: center; gap: 10px; padding: 10px 16px; }
.row + .row { border-top: 1px solid #ecebe6; }
.row .face { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 10.5px; font-weight: 650; color: #0c0c0d; }
.row .face.pending { background: transparent; border: 1px dashed #b9bcc3; color: var(--faint); }
.row .name b { display: block; font-weight: 550; }
.row .name span, .row .meta { color: var(--faint); font-size: 12px; }
.row .rolecell { color: var(--muted); }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 99px; font-size: 11.5px; font-weight: 550;
  background: var(--accent-soft); color: #0f766e; }
.row .act { text-align: right; color: var(--accent); font-weight: 550; cursor: pointer; }
.row .act.quiet { color: var(--faint); font-weight: 400; }
.changes { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 99px; background: var(--card);
  border: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.chip em { font-style: normal; color: var(--accent); font-weight: 600; }
`;

const SCRIPT = `
var role = "member";
function show(view) {
  document.querySelectorAll(".seg button").forEach(function (b) { b.classList.toggle("on", b.dataset.view === view); });
  var stage = document.getElementById("stage");
  stage.classList.toggle("one", view !== "both");
  document.getElementById("invite").classList.toggle("hidden", view === "accept");
  document.getElementById("accept").classList.toggle("hidden", view === "invite");
}
function pick(next) {
  role = next;
  document.querySelectorAll(".role").forEach(function (b) { b.classList.toggle("on", b.dataset.role === next); });
  document.getElementById("as").textContent = next === "admin" ? "Admin" : "Member";
  document.getElementById("pending-role").textContent = next === "admin" ? "Admin" : "Member";
}
function send() {
  var toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(function () { toast.classList.remove("show"); }, 1800);
}
document.querySelectorAll(".seg button").forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.view); }); });
document.querySelectorAll(".role").forEach(function (b) { b.addEventListener("click", function () { pick(b.dataset.role); }); });
document.getElementById("send").addEventListener("click", send);
`;

const INVITE_DIALOG = `
<div class="dialog">
  <div class="head"><h2>Invite a teammate</h2><div class="sub">They’ll join Acme once they open the link.</div></div>
  <div class="body">
    <div class="field"><label>Email</label><div class="input focus">sam@acme.dev<span class="caret"></span></div></div>
    <div class="field"><label>Role</label>
      <div class="roles">
        <button class="role on" data-role="member"><b>Member</b><span>Plans and agents</span></button>
        <button class="role" data-role="admin"><b>Admin</b><span>Plus billing and seats</span></button>
      </div>
    </div>
    <div class="note"><span class="dot"></span>The link expires in 7 days. You can withdraw it from Members.</div>
  </div>
  <div class="foot"><button class="btn">Cancel</button><button class="btn primary" id="send">Send invite</button></div>
</div>
<div class="toast" id="toast"><span class="check">✓</span>Invite sent to sam@acme.dev</div>`;

const ACCEPT_PAGE = `
<div class="accept">
  <div class="logo"><svg viewBox="0 0 64 64" width="52" height="52"><rect width="64" height="64" fill="#0f766e"/><path d="M14 46 L28 20 L42 46 Z" fill="#fff"/><path d="M30 46 L40 28 L50 46 Z" fill="#99f6e4"/></svg></div>
  <div class="avatars">
    <i style="background:#f2b880">DM</i><i style="background:#9fd8b4">JL</i><i style="background:#c7b4f5">RK</i><i style="background:#e7e5df;color:#5f646d">+9</i>
  </div>
  <h2>Dana invited you to Acme</h2>
  <p>You’ll join as <span class="pill" id="as">Member</span> alongside 12 teammates.</p>
  <button class="btn primary wide">Join workspace</button>
  <div class="who">Signed in as sam@acme.dev · <a>Not you?</a></div>
</div>`;

/** The page's newest version: the dialog beside the accept page, a view toggle, and a role picker the accept page follows. */
const INVITE_FLOW_V2 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Invite flow</title><style>${STYLE}</style></head>
<body>
<header>
  <div><h1>Invite flow</h1><div class="sub">What a member sends, and what the teammate opens.</div></div>
  <div class="seg">
    <button data-view="both" class="on">Side by side</button><button data-view="invite">Invite</button><button data-view="accept">Accept</button>
  </div>
</header>
<div class="stage" id="stage">
  <section class="screen" id="invite"><div class="label"><span class="step">1</span>Settings › Members › Invite</div><div class="frame">${INVITE_DIALOG}</div></section>
  <section class="screen" id="accept"><div class="label"><span class="step">2</span>acme.relay.dev/invites/7Qx…</div><div class="frame">${ACCEPT_PAGE}</div></section>
</div>
<section class="members">
  <div class="label"><span class="step">3</span>Settings › Members, after sending</div>
  <div class="row"><span class="face pending">S</span><div class="name"><b>sam@acme.dev</b><span>Invited by you</span></div>
    <span class="rolecell" id="pending-role">Member</span><span><span class="badge">Pending · 7 days left</span></span><span class="act">Withdraw</span></div>
  <div class="row"><span class="face" style="background:#f2b880">DM</span><div class="name"><b>Dana Moreno</b><span>dana@acme.dev</span></div>
    <span class="rolecell">Admin</span><span class="meta">Joined Mar 2025</span><span class="act quiet">···</span></div>
  <div class="row"><span class="face" style="background:#9fd8b4">JL</span><div class="name"><b>Jordan Lee</b><span>jordan@acme.dev</span></div>
    <span class="rolecell">Member</span><span class="meta">Joined Aug 2025</span><span class="act quiet">···</span></div>
</section>
<div class="changes">
  <span class="chip"><em>v2</em>Role picker: Member or Admin</span>
  <span class="chip">The accept page names the role</span>
  <span class="chip">Expiry shown before sending</span>
</div>
<script>${SCRIPT}</script>
</body></html>`;

/** The first version: the dialog alone, before the role picker and the accept page. */
const INVITE_FLOW_V1 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Invite flow</title><style>${STYLE}</style></head>
<body>
<header><div><h1>Invite flow</h1><div class="sub">What a member sends.</div></div></header>
<div class="stage one"><section class="screen"><div class="frame">
<div class="dialog">
  <div class="head"><h2>Invite a teammate</h2><div class="sub">They’ll join Acme once they open the link.</div></div>
  <div class="body"><div class="field"><label>Email</label><div class="input focus">sam@acme.dev<span class="caret"></span></div></div></div>
  <div class="foot"><button class="btn">Cancel</button><button class="btn primary">Send invite</button></div>
</div></div></section></div>
</body></html>`;

/** The expiry page's one version: two options compared. */
const EXPIRY_V1 = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Expiry options</title><style>${STYLE}</style></head>
<body>
<header><div><h1>Expiry options</h1><div class="sub">How long an invite link stays good.</div></div></header>
<div class="stage">
  <section class="screen"><div class="label"><span class="step">A</span>7 days</div><div class="frame"><div class="accept"><h2>7 days</h2><p>Matches password reset links. Fewer stale invites to clean up.</p></div></div></section>
  <section class="screen"><div class="label"><span class="step">B</span>14 days</div><div class="frame"><div class="accept"><h2>14 days</h2><p>Covers a teammate on two weeks’ leave. More open links at once.</p></div></div></section>
</div>
</body></html>`;

/** Each page's HTML by version, from one. */
const HTML: ReadonlyMap<string, readonly string[]> = new Map([
  [SHOT_PAGE_ID.INVITE_FLOW, [INVITE_FLOW_V1, INVITE_FLOW_V2]],
  [SHOT_PAGE_ID.EXPIRY, [EXPIRY_V1]],
]);

const TITLE: ReadonlyMap<string, string> = new Map([
  [SHOT_PAGE_ID.INVITE_FLOW, SHOT_PAGE_TITLE.INVITE_FLOW],
  [SHOT_PAGE_ID.EXPIRY, SHOT_PAGE_TITLE.EXPIRY],
]);

/** The newest version each page has, as the planning view lists it. */
export const SHOT_PAGE_VERSIONS = {
  INVITE_FLOW: 2,
  EXPIRY: 1,
} as const;

/** The HTML of one version of one of the shot's pages; none for any other. */
export function shotPageHtml(pageId: string, version: number): string | undefined {
  return HTML.get(pageId)?.[version - 1];
}

/**
 * Main's answer to a page frame's read in the shot: the version with its
 * HTML, or unanswered for a page or version the shot has not got.
 */
export function shotPageRead(params: {
  readonly pageId: string;
  readonly version: number;
}):
  | {
      readonly page: {
        readonly id: string;
        readonly title: string;
        readonly version: number;
        readonly at: number;
        readonly html: string;
      };
    }
  | { readonly failure: "unanswered" } {
  const html = shotPageHtml(params.pageId, params.version);
  const title = TITLE.get(params.pageId);
  if (html === undefined || title === undefined) return { failure: "unanswered" };
  return { page: { id: params.pageId, title, version: params.version, at: Date.now(), html } };
}

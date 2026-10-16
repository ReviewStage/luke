# Proposal: links that work on web and desktop, and a web version of Luke

Status: Part 1 decided by Dean on 2026-10-14 ("I agree with Luke links.
Let's do it. And save the web version for later."), and built as L1–L5
(§1.5). Part 2, the web version, is deferred: it stays here as the estimate
it was, and nothing of it is being built. Where what shipped differs from
the proposal, "What shipped" below says so.

## What shipped (Part 1)

- **The codec is `@luke/features/mention-link`**, the module @-mentions
  already wrote its provisional forms through (`docs/proposals/at-mentions.md`),
  not a second one. Its `encodeMention` writes the settled forms, and its
  `decodeMention` reads every provisional `luke://` form forever, as the same
  `Mention` the settled form names.
- **Old plans and messages are not rewritten.** The provisional forms stay
  in the words where they were written and are read through `decodeMention`;
  a heading renamed in the editor writes the settled form for each mention
  it renames.
- **A section's anchor is spelled from the heading's own Markdown source**,
  as `planSections` knows the heading, so `## Ship _today_` is
  `#ship-_today_`, where GitHub, which slugs the rendered words, would write
  `#ship-today`. The anchor only has to agree with itself inside Luke.
- **A mention of a section is its anchor, not its heading's words**, so the
  struck-through "No longer in the plan" state now means no heading of the
  plan spells that anchor, and the editor's rename rewrite (#2603) follows a
  section's anchor rather than its words: a heading renamed, or one laid in
  above another of the same words, moves each mention of the section whose
  anchor moved.
- **A file or a folder names the default branch as `HEAD`**:
  `https://github.com/<owner>/<name>/blob/HEAD/<path>` (`/tree/` for a
  folder). GitHub resolves `HEAD` to the repository's default branch, so the
  link needs no branch name and survives the default branch being renamed.
  A file's lines are pinned to a commit, `/blob/<commit>/<path>#L3-L5`.
- **A GitHub page is read as a file or a folder only of the plan's own
  repository, and only on `HEAD` or a commit**, which every reader is
  handed, and before anything else a GitHub address might name, so a later
  kind that reads GitHub pages (a pasted link's chip) never takes a file of
  the plan for a page. A branch's page is left a plain link, since a
  branch's name may hold a slash and leave no telling where the path begins.
- **In the window (L3)**, a Luke link pressed in a transcript, an agent's
  tab, or the Inbox opens its plan on the Plans tab at its section. No
  heading carries its anchor as an `id`, because session replay records
  attributes unmasked, and a plain link in a plan's own document stays
  words, as the document drew every link before; a mention's chip opens.
- **The "Open in Luke" page (L4)** is `apps/web/open.html`, served at
  `/<workspace>/plan/<id>`. It is static, opens nothing by itself (a
  browser with no app for the scheme answers an automatic hand-off with an
  error of its own), and counts no visit, since its address names a
  workspace and a plan.
- **The scheme (L5)** is declared through electron-builder's `protocols`.
  `open-url` is heard from module scope, and a link is held until a panel
  has painted (its `notifyReady`), so the link that launched the app opens
  once a window can open it.
- **An MCP server or tool keeps `luke://mcp/<provider>[/<tool>]`**, an
  internal form: it has no page of its own on the web to link to, and nothing
  outside the app opens `luke:`, which is a different scheme from the
  desktop's registered `tryluke:`.
- **Every other place has a link too (L6, copy-link-anything)**:
  `@luke/features/luke-link` writes and reads a link to a task's version,
  page, call, turn, agent, worker, Changes, and message, an agent with no
  task, the Inbox and an item in it, Automations, an automation and its
  run, Factory, and a Settings page, each under `/<workspace>/` by its ids
  alone; a task's own link and a section's stay `mention-link`'s. The host
  and the scheme are spelled once (`@luke/features/link-home`), with aliases
  every reader takes, so a rename of the product is one line. The Open in
  Luke page is served at each and names its kind.
- **Existing slugs were not checked against the reserved list**: no query
  of production was run. The list keeps new workspaces off Luke's own path
  steps, and a link never resolves by its slug, so a workspace already
  standing under one breaks no link; it would only shadow a page of the
  same name once the web app serves workspace pages (Part 2).

Dean's asks:

- "I eventually want to do whatever Linear, Notion, Slack, and GitHub do to
  support links for web/desktop. ... we will want web support down the road so
  we should pave the foundation for that."
- "How hard would it be to start supporting a web version of Luke that looks
  exactly the same as the desktop version? I know we already use Electron."

Every external source below was accessed on 2026-10-14.

---

# Part 1: links

## 1.1 What the others do

| Product | Canonical link | Desktop handoff | Mac Universal Links? | No access / signed out |
| --- | --- | --- | --- | --- |
| Linear | `linear.app/<workspace>/issue/ENG-123/<title-slug>`. An issue moved to another team gets a new ID, and "Old URLs will still work and redirect" ([creating issues][lin-move]). | A browser setting, "Open in desktop app" (Account > Preferences > Behavior). The page finds the app by probing localhost ports 44450, 18450 and 33234. A `linear://` scheme also exists, written as the https URL with its scheme swapped: `linear://linear.app/issue/ENG-123` ([get the app][lin-app]). | No. The AASA lists only the iOS app ([AASA][lin-aasa]). | Single-page app; any login redirect happens in the client (not verified). |
| Notion | `<slug>-<32-hex id>`, with a block's ID after `#` ([page content][no-id], [links][no-links]). Now served from `app.notion.com/p/...` and redirected from `www.notion.so`, slug passed through untouched (curl). | Web setting "Open links in desktop app". Desktop setting "Open Notion links in browser" ([desktop][no-desk]). | The AASA lists `LBQJ96FQ8D.notion.id` for `*` ([AASA][no-aasa]); whether that is the Mac app was not verified. | A "Request access" flow that the page's editors approve ([sharing][no-share]). |
| Slack | `<ws>.slack.com/archives/<C…>/p<ts>`, all IDs ([deep linking][sl-deep]). | Interstitial "Opening link in Slack… Or, you can open this link in your browser" ([example][sl-inter]). Custom `slack://channel?team=&id=`, where an unrecognized path falls back to `slack://open` ([deep linking][sl-deep]). | No. The Mac app appears only under `webcredentials` ([AASA][sl-aasa]). | 302 to a login page with the target in `?redir=` (curl). `app_redirect` returns 404 for a channel you cannot see ([deep linking][sl-deep]). |
| GitHub | `github.com/<owner>/<repo>/blob/<ref>/<path>#L10-L20`. A branch ref tracks the file; a SHA pins it ([permalinks][gh-perma]). Renamed repos redirect ([rename][gh-rename]). | "Open with GitHub Desktop" button ([docs][gh-desk]). GitHub Desktop is Electron and registers `x-github-client` and `github-mac` ([build.ts][gh-build]). | No. Mobile only. | 404 rather than 403, "to avoid confirming the existence of private repositories" ([REST docs][gh-404]). |
| Figma | `figma.com/<type>/<file key>/<name>?node-id=` ([REST][fi-url]). | Browser preference "Open links in desktop app" ([help][fi-pref]), through a local helper (FigmaAgent) that Chrome's Local Network Access gates ([help][fi-lna]). | Not verified. | 403 for an unknown key (curl). |
| Discord | `discord.com/channels/<guild>/<channel>/<message>`, all IDs ([discord.js][di-url]). | `discord://` scheme; a local RPC server on ports 6463–6472 ([RPC][di-rpc]). | No. Desktop appears only under `webcredentials` ([AASA][di-aasa]). | Client-side redirect (not verified). |

What all of them share:

1. **The link is the https web URL**, and it carries a stable ID. Readable
   parts (a title, a workspace, a file name) are decoration, and a move or
   rename redirects rather than breaking the link.
2. **The desktop handoff runs from the browser and is opt-in**: a web setting
   plus an interstitial, a custom scheme, or a localhost helper.
3. **None of the Electron apps uses Universal Links on the Mac.** Their AASA
   files list iOS apps. So a custom scheme is the real desktop path, and the
   https URL still has to work by itself. Apple warns that when two apps
   register the same scheme, "the app the system targets is undefined", and
   says to validate every parameter ([Apple][ap-scheme]). Electron's
   `open-url` must be registered before `ready`, and on macOS
   `setAsDefaultProtocolClient` only works for schemes listed in the
   `Info.plist` ([Electron app][el-app]).
4. **No access** is handled as login with a return-to, a request-access flow,
   or a deliberate 404 so a private object's existence is not confirmed.
5. No vendor documents how its desktop app catches its own https links
   clicked inside the app. In Electron the usual tool is the window's
   navigation and open handlers, with `shell.openExternal` held to an
   allowlist ([Electron security][el-sec], items 13–15).

## 1.2 What Luke has today

- **Domain.** `https://tryluke.dev`. The desktop hard-codes
  `https://tryluke.dev/api/auth` (`apps/desktop/src/main/bootstrap.ts:81-83`),
  overridden only in unpackaged runs. Previews are
  `luke-*-stage-review.vercel.app` (`apps/web/server/auth-deployment.ts:75`).
- **Web pages.** `apps/web` serves a landing page, about, privacy, changelog,
  admin, and the auth and connect pages (sign-in, consent, desktop-session,
  connect-github, github-installed, integration-connected, accept-invitation)
  (`apps/web/vite.config.ts:12-24`). No page shows a plan or a workspace, and
  every auth page ends with "Return to Luke" as plain text with no link back
  into the app (`apps/web/src/consent.tsx:51`).
- **No OS protocol.** Nothing calls `setAsDefaultProtocolClient`, there is no
  `protocols` entry in electron-builder, no `CFBundleURLTypes`
  (`apps/desktop/scripts/electron-builder-config.mjs:101-108`), and no
  associated-domains entitlement. The bundle ID is `dev.reviewstage.luke`
  (`:57`).
- **Sign-in returns over loopback**, not a scheme: a server on
  `127.0.0.1:<port>` (`packages/credentials/src/loopback-consent.ts:36`). The
  desktop-session page says Better Auth would normally use a custom scheme and
  that Luke chose loopback instead (`packages/features/src/desktop-session-wire.ts:13-17`).
- **Single instance.** The lock is taken at `apps/desktop/src/main/main.ts:85-92`.
  `second-instance` ignores its `argv` and only refocuses the panel
  (`apps/desktop/src/main/services/window-service.ts:372-376`). No `open-url`
  listener exists.
- **`luke-page:`** is a privileged in-app scheme that serves one version of an
  agent-written HTML page into a sandboxed iframe
  (`apps/desktop/src/shared/page-frame.ts:12-45`,
  `apps/desktop/src/main/window/page-protocol.ts`). It is not registered with
  the OS and has nothing to do with links.
- **Link clicks.** Every window denies `window.open` and blocks navigation
  (`apps/desktop/src/main/window/hardened-window.ts:30-35`). The one door is
  `useOpenLink` (`apps/desktop/src/renderer/planning/use-open-link.ts`), which
  sends `github.open` or `web.open`, both `shell.openExternal`. A test checks
  that `luke://plan/7` is refused (`apps/desktop/src/main/ipc/planning-acts.test.ts:309-317`).
  Links in a plan's document are not clickable at all: they are drawn as a
  `<span>` (`apps/desktop/src/renderer/markdown-message.tsx:217-237`), and
  headings have no id (`:238-249`).
- **Identifiers.** A plan is a random UUID (`packages/database/src/schemas/plan.ts:30`).
  A workspace is a Better Auth organization with a unique, NOT NULL `slug`
  (`packages/database/src/schemas/auth.ts:301-308`), spelled from its name at
  creation (`packages/database/src/models/workspace-store.ts:238`). A personal
  workspace's slug is `personal-<userId>` (`:287-289`). Nothing renames a slug:
  `/organization/update` is shut (`apps/web/server/auth-policy.ts:85`). The slug
  is not on the desktop's wire (`packages/features/src/workspace-wire.ts`).
  A section has no ID; it is known by its heading's words
  (`packages/features/src/plan-document.ts:4-16`).

## 1.3 Proposed link format

```
https://tryluke.dev/<workspace-slug>/plan/<plan-uuid>#<section-anchor>
```

For example:
`https://tryluke.dev/reviewstage/plan/3f6c…e21a#implementation`.

- **The plan UUID is the only part that resolves.** It is globally unique, so
  the server finds the plan's workspace from the ID and checks membership. The
  workspace slug is decoration that the codec reads but never trusts, as
  Notion's slug and Linear's title are. A later workspace rename, a nicer
  personal slug, or a plan moving between workspaces breaks no stored link;
  the web page redirects to the current slug.
- **Why a workspace segment at all:** every one of the four products Dean named
  scopes its links by workspace or owner. The web app will need the same
  namespace for its other routes (`/<ws>/agents/<id>`, `/<ws>/inbox`,
  `/<ws>/settings`), and it tells the web app which workspace's sidebar to draw
  before the plan loads.
- **No name slug.** A Markdown mention already carries the plan's name as its
  link text, and a name in the path goes stale on every rename. It can be
  added later as ignored decoration without breaking any stored link.
- **Section anchor**: the heading's words, slugged the way GitHub slugs
  Markdown headings (lowercase, spaces to `-`, punctuation dropped, `-1`, `-2`
  for repeats). Sections have no ID, so a renamed heading misses, and a miss
  opens the plan at the top. That is the same fallback the browser gives a
  stale `#fragment`. The fragment never reaches the server; the page reads it
  client-side.
- **Custom scheme form**: the same URL with its scheme swapped, as Linear does:
  `tryluke://tryluke.dev/<ws>/plan/<id>#<anchor>`. One codec reads both, so the
  scheme is a transport for the https link rather than a second format.
- **Reserved first segments.** The workspace slug sits at the root, so
  `slugOf` must refuse the names of Luke's own pages (`about`, `privacy`,
  `changelog`, `admin`, `api`, `sign-in`, `consent`, `plan`, `w`, `assets`,
  and so on), with a one-time check that no existing slug collides. The
  alternative is a `/w/<slug>/` prefix (decision 3).

**Mentions store the https URL in the document, as an ordinary Markdown
link**: `[Checkout redesign](https://tryluke.dev/reviewstage/plan/<id>#scope)`.
It is readable by the planning model and by a coding agent, clickable in a
GitHub copy of the plan, in Slack, and in a browser, and it never has to be
migrated when the web version ships.

### Files and folders: GitHub links, not Luke links

A file or folder already has a canonical, permissioned home on web and
desktop: GitHub. Luke would only shadow it. So:

- A file: `https://github.com/<owner>/<repo>/blob/HEAD/<path>`, `HEAD`
  being the default branch, whatever it is called.
- A folder: `https://github.com/<owner>/<repo>/tree/HEAD/<path>`.
- A line range: pinned to the commit Luke read it at,
  `…/blob/<sha>/<path>#L10-L20`, because lines drift and a range on a branch
  points at whatever moved into it. This is GitHub's own permalink advice
  ([permalinks][gh-perma]).
- A plan describes code as it will be when an agent picks the plan up, so a
  whole file names the branch, not a SHA.
- Inside the desktop, a GitHub link into the open plan's repository opens in
  the side panel's File tab through `SidePanelControl.onOpenFile` (the one door
  #2559 made). Any other GitHub link opens the browser, as today.
- Luke links are only for Luke's own objects: plans and sections now, and
  agents, inbox items and pages later.

## 1.4 The flow

```
 a Luke link: https://tryluke.dev/<ws>/plan/<id>#<anchor>
       │
       ├── clicked inside Luke (desktop) ──► useOpenLink → codec says "Luke link"
       │                                     → open the plan in-app, scroll to the section
       │                                     (never the browser)
       │
       └── clicked anywhere else (Slack, GitHub, mail) ──► browser opens tryluke.dev
              │
              ├── today: a bare "Open in Luke" page (static, fetches nothing)
              │       └── button → tryluke://tryluke.dev/<ws>/plan/<id>#<anchor>
              │              └── macOS → Luke's open-url → codec → open the plan
              │       └── "Don't have Luke? Download it"
              │
              └── later, with the web version: the plan itself, in the browser
                      ├── signed out → sign in, return to the link
                      ├── no access → 404 (as GitHub does: existence not confirmed)
                      └── setting "Open links in the desktop app" → hand off as above
```

## 1.5 What to build now, and what later

Now: the minimum so @-mentions store the future-proof form and a stored link
already does something useful everywhere.

| # | Piece | Where | Size |
| --- | --- | --- | --- |
| L1 | **Link codec**: `encodeMention(mention, place)` writes the settled forms, `decodeMention(target, repository)` reads them and every provisional `luke://` form, and `sectionAnchors(headings)` spells anchors. Every link is written under `https://tryluke.dev`, whichever service the app talks to, since only the plan's id finds a plan. | `packages/features/src/mention-link.ts`, the codec @-mentions already writes through. | M: the codec, every reader of a section, half a day more than proposed |
| L2 | **Workspace slug on the wire**, plus reserved first segments in `slugOf` and a check that no existing slug collides. | `packages/features/src/workspace-wire.ts`, `packages/database/src/models/workspace-store.ts` | S: half a day |
| L3 | **Desktop in-app opener**: `useOpenLink` gains a third branch that opens a Luke link in-app (select the plan, scroll to the anchor). Luke links and GitHub links in a plan's document become clickable through that door. Headings get their anchor as an id. | `apps/desktop/src/renderer/planning/use-open-link.ts`, `markdown-message.tsx`, plan-body | M: about 300 lines, 1 day, `verify.sh` |
| L4 | **"Open in Luke" page** at `/<ws>/plan/<id>`: static, reads nothing, reveals nothing, so a signed-out or unauthorized visitor learns no more than the URL already says. Offers a button to the `tryluke:` link and a download link. | `apps/web/plan-link.html` plus a `vercel.json` route | S: half a day |
| L5 | **Register `tryluke://`**: electron-builder `protocols` (writes `CFBundleURLTypes`), `open-url` registered in `main.ts` before `ready`, a cold-start URL held until the panel stands, and `second-instance` reading `argv` for the development build. Decode only, then open: a link can select and scroll, and never acts (no call started, nothing written). | `apps/desktop/src/main/main.ts`, `window-service.ts`, `electron-builder-config.mjs` | S–M: 1 day, `verify.sh` on a Mac |

About 3.5 agent-days over 5 PRs. **L1 alone unblocks @-mentions**: they can
store the https form as soon as L1 merges. L2 follows, because the encoder
needs the slug. L3–L5 can land in any order after L1.

Later: the web plan viewer (Part 2, phase 1), the "Open links in the desktop
app" setting (it lives on the web, so it needs the web app), links for agents,
inbox items and pages, opening GitHub links in the side panel, and Universal
Links (not needed: none of the four uses them on the Mac, and they need an
associated-domains entitlement plus a provisioning profile in the signed
build).

## 1.6 Decisions for Dean (links)

1. **Canonical form.**
   - (a) https on tryluke.dev, as above.
   - (b) `luke://plan/<id>` as the stored form.
   - (c) Store only an ID (`plan:<id>`) and render a URL on display.

   **Recommend (a).** It is what all four do, it works in places that will
   never run Luke (Slack, GitHub, mail), and it needs no migration when the web
   version ships. (b) does nothing in a browser, and macOS does not promise to
   route an unregistered or shared scheme. (c) is unreadable outside Luke.
2. **Workspace in the path.**
   - (a) `/<ws-slug>/plan/<id>`, slug decorative.
   - (b) `/plan/<id>` alone.

   **Recommend (a)**, for the web app's future namespace. The cost is that a
   personal plan's link reads `personal-<userId>`, which is ugly. It is not a
   secret, and it can be re-slugged later without breaking a link, because
   the slug never resolves.
3. **Root or prefixed workspace.**
   - (a) `tryluke.dev/<ws>/…` with a reserved-name list.
   - (b) `tryluke.dev/w/<ws>/…`.

   **Recommend (a)**, as Linear and GitHub do. A reserved list is about 20
   names and one check.
4. **Scheme name.**
   - (a) `tryluke://`, matching the domain.
   - (b) `luke://`.
   - (c) `dev.reviewstage.luke://`.

   **Recommend (a).** `luke` is a common word, and Apple says the target is
   undefined when two apps claim one scheme. `tryluke` is distinctive and
   readable. (c) is collision-proof but unreadable, which matters because
   browsers show the scheme in their "Open Luke?" prompt.
5. **Section anchors.**
   - (a) A heading slug, with a miss opening the plan at the top.
   - (b) Give sections stable IDs first.

   **Recommend (a) now.** Stable section IDs would change the plan document
   model (`plan-document.ts` knows sections by their words), which is a much
   larger change than links need.
6. **Files.** **Recommend GitHub links**: the branch for a file or folder,
   the SHA for a line range. Luke links only for Luke's own objects.
7. **Build now.** **Recommend L1 and L2 before @-mentions build, and L3–L5
   right after**, so the first stored mention already opens in the app and
   from Slack.

---

# Part 2: a web version that looks the same

**Deferred by Dean on 2026-10-14.** What follows is the estimate as it was
written; none of it is scheduled.

## 2.1 The short answer

The renderer is already a browser app. It is built by esbuild for
`platform: "browser"` (`apps/desktop/scripts/build.mjs:138-152`). Audio is
`getUserMedia`, voice is WebRTC from the renderer straight to OpenAI, dictation
is `MediaRecorder`, files come from GitHub through the service, and session
replay is `posthog-js`. Everything Electron-specific goes through one typed
interface, `window.sidecar: AppBridge` (`apps/desktop/src/shared/bridge.ts:73-385`,
exposed at `apps/desktop/src/preload/index.ts:42`).

The work is not the screens. It is three things behind that interface:

1. **The host.** Main hands nearly every act to `packages/host`, an in-process
   state machine. It holds the app-state document the renderer subscribes to,
   runs the held reads, and makes the bearer calls to `apps/web`
   (`packages/host/src/compose-planning.ts` alone is 1,736 lines). A web
   version runs that same host in the browser with browser layers under it.
   It is close to portable already: its only Node imports are `node:path`,
   `node:util`'s `isDeepStrictEqual`, a JSON state file, and the `ws` socket.
2. **Auth for a browser.** 56 route files accept only an OAuth bearer
   (`packages/service/src/auth/bearer.ts`); 13 accept a Better Auth session
   (`packages/service/src/auth/browser-session.ts`).
3. **Voice admission.** The voice socket refuses any upgrade that carries an
   `Origin` header and wants an `Authorization` header
   (`apps/web/server/voice/service.ts:466-468`). A browser always sends one and
   cannot send the other.

Rough size: about 25–30 PRs and 25–35 agent-days to parity, phased so a
read-only viewer arrives after about 8.

## 2.2 Inventory: what the renderer gets from Electron or the Mac

There are 98 act kinds (`apps/desktop/src/shared/messages/acts.ts:176-378`),
not about 45. Class key:

- **A**: server-backed; the host proxies to an `apps/web` route that exists.
- **B**: needs a server change or host logic ported.
- **C**: a browser API covers it.
- **D**: desktop-only; hide on web.

| Area | Acts / pieces | Today | On web | Class |
| --- | --- | --- | --- | --- |
| Plans: CRUD, files, tree, history, board, skills | `planning.start/delete/rename/pin/archive/edit/messages/file/tree/revisions/restore/boardSave/…` (17) | host → `/api/plans/*` | Same routes, once auth takes a browser session | A |
| Plans: list, open, close, scroll-back | `planning.refresh/select/close/workEarlier/conversationEarlier` | Host state machine; results land in the pushed document | Run the host in the browser | B |
| Code colouring | `planning.colourCode/pageSource` | Shiki in main | Shiki runs in a browser | B (small) |
| Coding agents, inbox | `codingAgents.*` (17) | host → `/api/agents`, `/api/inbox` | Same routes | A |
| Workspaces, members, invites | `workspace.*` (9) | host → `/api/workspaces*`, session auth | Works with a cookie as-is | A |
| Integrations, provider keys, plan template, feedback | `integrations.*`, `providerKeys.*`, `planTemplate.*`, `feedback.send` | host → routes | Same | A |
| Connect pages (GitHub, integrations) | `github.connect`, `workspace.githubConnect`, `integrations.connect` | Gets the URL, `shell.openExternal` | `window.open` | A + C |
| Links | `web.open`, `github.open` | `shell.openExternal` | `window.open`; Luke links route in-app | C |
| Sign-in | `account.beginSignIn/signInAgain/cancelSignIn` | Loopback PKCE, token in Keychain via `safeStorage` | Redirect to sign-in, HttpOnly cookie | B |
| Sign-out, delete | `account.signOut/delete` | host | Clear the cookie / same route | A |
| Settings | `setting.update`, `settings.reset` | Local JSON file (`packages/host/src/settings-store.ts`); only `voice` is on the server | localStorage, or a preferences route; hide Mac-only fields | B |
| Voice session | `voice.createLiveSession/endLiveSession/report*/stopSpeaking/diagnostics` | Host opens a `ws` socket with a bearer → `/api/voice/sessions`; the renderer holds the RTCPeerConnection | Ticket or cookie admission, plus the session holder in the browser | B |
| Voice between windows | `voice.command`, `call.showPlan`, `planning.talk` | Relayed to the hidden voice window | In-page | B |
| Dictation | `dictation.transcribe` | `MediaRecorder` in renderer → `/api/dictation` | Same | A + C |
| Microphone | `microphone.request` | `systemPreferences.askForMediaAccess` | `getUserMedia` prompt | C |
| Microphone route, OS settings panes | `microphone.route`, `microphone.openSettings`, `notifications.openSettings` | Swift helper, `x-apple.systempreferences:` | Hide (or approximate with `enumerateDevices`) | D |
| Clipboard, save file, mail | `window.copyText`, `window.saveFile`, `contact.email` | Electron `clipboard`, save dialog, `mailto:` | `navigator.clipboard`, Blob download, `mailto:` | C |
| Agent-written pages | `luke-page:` scheme | Main fetches with the bearer, serves a sandboxed CSP | A route on a **separate registrable domain** (as GitHub uses githubusercontent.com), sandboxed | B |
| Notifications, Dock badge | Host observations → Electron `Notification` | | Web Notification API; no badge | C |
| `run_on_mac` | `compose-mac-commands.ts` runs commands in the login shell | | Hide; agents see "no Mac listening", as when the Mac is asleep | D |
| Updates | `update.*` (4) | electron-updater | Hide (a deploy is the update) | D |
| Menus, global talk/stop keys, media ducking, output volume, login item | `Menu`, `TalkKey.swift`, `MediaDuck.swift`, `OutputVolume.swift` | | In-page keys while the tab is focused; the rest hidden | D |
| Windows: one panel per display, hidden voice window, floating call card | `panel-manager.ts`, `voice-window.ts`, `call-window.ts` | | One tab; the call lives in the page | D |
| Mac chrome in CSS | `-webkit-app-region`, traffic-light offsets (`apps/desktop/src/renderer/styles/desktop.css`) | | A web top bar instead | D |
| Session replay, analytics, Sentry | `posthog-js`; events via host → `/api/events`; `@sentry/electron` | | `posthog-js` as is; `@sentry/browser` | A + C |

Tally: about 67 A (12 of them with a C piece), 14 B, 6 C, 11 D. The renderer is
275 non-test files and about 62k lines. 42 files touch the bridge, and none
of them needs to change shape.

## 2.3 Architecture options

1. **The same renderer bundle with a web bridge (recommended).** A
   `web-bridge.ts` implements `AppBridge` in the page: `act` and the push
   subscriptions call the same `packages/host` composers, built over browser
   layers. Those layers are a fetch-only HTTP client on a cookie, a
   localStorage settings store, `window.open` for the opener, no Mac commands,
   and a browser WebSocket for voice. The host already runs on Effect over
   Context tags, so this means providing different layers, not writing a
   second host. Screens stay identical because they are the same files. A
   `RUN_SURFACE` value (desktop | web) hides the D rows. Effect's runtime edge
   for the web bridge is one new row in
   `tools/oxlint/anti-slop/effect-edges.json`.
2. **A thin bridge over a server-side host.** Run `packages/host` per user on
   the server and stream the app-state document to the browser. Less code in
   the browser, but it needs a stateful per-user process, which Vercel
   functions are not. **Not recommended.**
3. **A separate web app** (Next.js or similar) sharing components. Two UIs
   drift, and "looks exactly the same" becomes a standing cost. **Not
   recommended.**

**Hosting.** Serve the web build from `apps/web` on `tryluke.dev` under the
workspace routes (`/<ws>/…`), same-origin with `/api`, so there is no CORS at
all (none is configured today). The bundle is the desktop renderer's source
built a second time with the web bridge as its entry. Where that build lives
is decision 10.

**Auth.** Better Auth already sets cookies on tryluke.dev for sign-in,
consent and admin. Let `resolveHostedUserId` accept a session cookie beside
the bearer, with:

- the cookie `HttpOnly`, `Secure` and `SameSite=Lax`;
- an `Origin` check on every non-GET route (refuse any origin other than
  tryluke.dev);
- a strict CSP on the app page.

The other option is a public OAuth client with PKCE and the token held in page
JavaScript. That puts a bearer where any XSS can read it. The desktop renderer
never holds the token (main does), and AGENTS.md keeps credentials out of
renderer-visible places, so the cookie keeps the same property on the web.

**Voice in a browser.** The peer connection, microphone, and level meters
already run in the renderer. What changes:

- Admission: a cookie-authenticated `POST /api/voice/ticket` mints a
  one-time, 30-second ticket. The browser opens the socket with the ticket in
  its first frame, and the upgrade admits `Origin: https://tryluke.dev`
  alongside today's no-Origin desktop path.
- The voice window's job moves in-page. The call survives navigation because
  the web app is one page. Closing the tab detaches the device, and the
  existing sweep ends the session after its grace.
- Hold-to-talk works only while the tab is focused; the rest (ducking, route,
  output volume) stays Mac-only.

## 2.4 Phased plan and estimate

Agent-days are for one agent working through review and fixes. Phases are
sequential, and PRs inside a phase can mostly run in parallel.

| Phase | What ships | PRs | Agent-days |
| --- | --- | --- | --- |
| 0. Links (Part 1) | L1–L5 | 5 | 3.5 |
| 1. Read-only plan viewer | Cookie auth on the read routes plus the Origin check. Web build of the renderer with a web bridge that answers app state, plan list, open plan, messages, files, tree and revisions; every other act answers "not on the web" and its control is hidden. The `/<ws>/plan/<id>` page becomes the viewer, with sign-in and return-to and a 404 for no access. Web top bar in place of the Mac chrome. | 7–8 | 7–9 |
| 2. Full planning without voice | Every A row: editing, board, coding agents, inbox, workspaces, settings (localStorage plus preferences), integrations and connect pages, notifications through the Web Notification API. Agent pages on a sandbox domain. "Open links in the desktop app" setting. `@sentry/browser`. Playwright smoke run in Linux CI. | 8–10 | 9–12 |
| 3. Voice in the browser | Ticket admission and Origin allowlist on the voice socket; the session holder in the page; dictation; in-tab talk key; tab-close grace. Manual testing on Chrome and Safari (Firefox WebRTC as a follow-up). | 4–6 | 5–8 |
| 4. Parity and polish | Remaining B rows, empty states for hidden features, keyboard shortcuts that collide with the browser (⌘K, ⌘W, ⌘N), offline and reconnect, performance budget for a cold load. | 4–5 | 4–6 |
| **Total** | | **28–34** | **28–38** |

One side effect worth noting: a web build is the first Luke UI that CI can
open, because CI has no Mac. A Playwright smoke run over the web build would
catch a whole class of renderer breaks that today wait for `verify.sh` or the
release rehearsal.

## 2.5 Risks

- **Browser sessions.** A cookie brings CSRF. The defences are `SameSite=Lax`,
  an `Origin` check on every write, and no state change on GET. Long-lived web
  sessions also need the same sign-out-everywhere the desktop has.
- **Secrets.** No credential may reach page JavaScript. Concretely that means
  an HttpOnly cookie, not a token. Provider keys stay write-only, as they are
  on the desktop. `run_on_mac` output never reaches a browser, because the
  feature is hidden there.
- **XSS surface.** The plan document, transcripts and agent pages are
  model-written. On desktop, `luke-page:` is a separate origin. On the web,
  agent pages must be served from a different registrable domain: a
  `tryluke.dev` subdomain is the same site, so it would share cookie
  SameSite treatment. The app page needs a strict CSP (`script-src 'self'`,
  `connect-src 'self'` plus PostHog, `frame-src` the sandbox domain only).
- **CORS.** None needed if the app is same-origin. Do not add a CORS policy to
  the API; a second origin calling `/api` is exactly what the Origin check
  refuses.
- **Session replay.** It already masks every word
  (`apps/desktop/src/renderer/session-replay.ts`). The web build must load the
  same masking configuration, or AGENTS.md's "layout, not text" promise breaks
  on the web.
- **Voice quality.** Safari's WebRTC and autoplay rules differ, and browser
  echo cancellation interacts with `echoCancellation: false`
  (`apps/desktop/src/renderer/voice/microphone-choice.ts:17-21`). It needs real
  testing; it is the riskiest phase to estimate.
- **Bundle and build.** The renderer includes Excalidraw and Shiki. A web cold
  load needs code splitting that Electron never needed.
- **Stays Mac-only:** `run_on_mac`, global hold-to-talk outside the tab,
  media ducking, output volume and microphone route, the floating call card,
  one panel per display, the Dock badge, login item, and auto-update.

## 2.6 Decisions for Dean (web)

8. **Whether to start.**
   - (a) Phase 0 now, phase 1 next.
   - (b) Phase 0 only, web later.
   - (c) Phase 0–3 as one push.

   **Recommend (a).** Phase 1 turns every stored link into something a
   teammate without the Mac app can read, and proves the web bridge before
   the larger phases.
9. **Architecture.** **Recommend one renderer with a web bridge** (§2.3,
   option 1).
10. **Where the web build lives.**
    - (a) The desktop build script emits a second, web bundle that `apps/web`
      serves (Vercel's filter grows to include `@luke/desktop`).
    - (b) Move the renderer to its own app or package, which `apps/desktop`
      and `apps/web` both build.

    **Recommend (a) for phase 1**, and revisit (b) only if the two builds
    start pulling apart. `packages/` cannot hold React by the repository's
    rule (`packages/CLAUDE.md`).
11. **Browser auth.**
    - (a) Session cookie accepted beside the bearer, with an Origin check.
    - (b) Public OAuth client, with the token in the page.

    **Recommend (a)**, so no credential is ever readable by page JavaScript.
12. **Voice admission.**
    - (a) A one-time ticket minted over the cookie.
    - (b) A cookie on the socket upgrade with an Origin allowlist.

    **Recommend (a).** It keeps the upgrade free of cookies and keeps today's
    desktop path unchanged.
13. **Agent pages on the web.** **Recommend a separate registrable domain**
    for sandboxed pages, bought before phase 2.
14. **AGENTS.md.** Several rules here (no token in page JavaScript, Origin
    check on writes, the sandbox domain) would eventually belong there.
    **Nothing is added without Dean's explicit OK.**

[lin-move]: https://linear.app/docs/creating-issues
[lin-app]: https://linear.app/docs/get-the-app
[lin-aasa]: https://linear.app/.well-known/apple-app-site-association
[no-id]: https://developers.notion.com/docs/working-with-page-content
[no-links]: https://www.notion.com/help/create-links-and-backlinks
[no-desk]: https://www.notion.com/help/notion-for-desktop
[no-aasa]: https://www.notion.so/.well-known/apple-app-site-association
[no-share]: https://www.notion.com/help/sharing-and-permissions
[sl-deep]: https://docs.slack.dev/interactivity/deep-linking
[sl-inter]: https://app.slack.com/docs/T0KN1ADTR/F02QXUSPZ2M
[sl-aasa]: https://slack.com/.well-known/apple-app-site-association
[gh-perma]: https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files
[gh-rename]: https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository
[gh-desk]: https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-a-repository-from-github-to-github-desktop
[gh-build]: https://raw.githubusercontent.com/desktop/desktop/development/script/build.ts
[gh-404]: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
[fi-url]: https://developers.figma.com/docs/rest-api/file-endpoints/
[fi-pref]: https://help.figma.com/hc/en-us/articles/360039824334
[fi-lna]: https://help.figma.com/hc/en-us/articles/34458998159511
[di-url]: https://discord.js.org/docs/packages/formatters/main/messageLink:Function
[di-rpc]: https://docs.discord.com/developers/topics/rpc
[di-aasa]: https://discord.com/.well-known/apple-app-site-association
[ap-scheme]: https://developer.apple.com/documentation/xcode/defining-a-custom-url-scheme-for-your-app
[el-app]: https://www.electronjs.org/docs/latest/api/app
[el-sec]: https://www.electronjs.org/docs/latest/tutorial/security

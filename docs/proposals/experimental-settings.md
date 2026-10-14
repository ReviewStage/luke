# Proposal: an Experimental settings page that gates features

Status: proposed, waiting on Dean's decisions below. No product code until he
answers. On 2026-10-14 Dean asked for two changes to the page, now drawn here
and in the show: no intro text, and the empty Inbox's empty state in place of
a one-line note.

Dean's ask: "I want to build the thin version of Factory. HOWEVER, I want to
add an Experimental settings tab that gates features. Can we plan this out
first?"

Factory is the first gated feature: the thin v1 is a read-only
Plan → Build → Ship view beside the Inbox, built by worker 260. Others will
follow: Terminal, @-mentions, Automations, and avatar video are all in flight.

The design show is `docs/proposals/experimental-settings/index.html`. It is
one self-contained file, drawn from the desktop renderer's own stylesheet and
components in dark and light. It shows the page with Factory listed, Factory
switched on, the sidebar with Factory hidden and shown, Factory open, ⌘K,
Settings search, several experiments at once, and the empty state.

## Decisions for Dean

Each decision lists its options; **the recommendation is in bold**.

1. **Where the choice is stored.**
   - **(a) Per account, on the server.** It follows the developer to every
     Mac, and the web version (worker 273) can honour it later. Cost: one
     `jsonb` column on `account_preference`, one more part on the
     `/api/account/preferences` endpoint, and a cache on the Mac.
   - (b) Per device, as one more toggle in `settings.json`. This is the
     cheapest, about 200 fewer lines with no server change. Each Mac is
     switched on by hand, and the web can never see it.
   - (c) Per workspace, set by its admins. The first scope for a team
     product, but it adds an admin layer that Luke's one team doesn't need
     yet.
2. **Who can turn an experiment on.**
   - **(a) Anyone signed in, for their own account.**
   - (b) Only staff: accounts on an allowlist see the page, as Zed's staff
     flags work.
3. **Name and place.**
   - **(a) "Experimental", a page after This Mac,** so About and Keyboard
     shortcuts stay last, as #2501 ordered them.
   - (b) "Feature previews", in the same place (GitHub's and Claude's
     word).
   - (c) "Labs".
4. **When no experiment is in.**
   - **(a) The page stays and draws the empty state the empty Inbox draws:
     a large muted glyph, the title "No experiments right now", and one short
     line, "New features show up here to try before they ship."** It stays
     findable from search and ⌘K, and a link to it never dangles.
   - (b) The page disappears from the sidebar while the list is empty, as
     ChatGPT's Beta features tab did.
5. **How a gated feature is marked once it is on.**
   - **(a) A quiet "Experimental" badge and a Send feedback link in the
     feature's own toolbar.** The sidebar row is drawn like any other.
   - (b) The badge on the sidebar row too.
   - (c) No marking outside Settings.
6. **When a switch takes effect.**
   - **(a) At once, everywhere: the sidebar, ⌘K, the chord, and the
     application menu.** Switched off, the feature's place and tabs close,
     and the window goes back to where it was, or Home.
   - (b) "Relaunch to apply", as Chrome's flags work. That would be simpler
     for the menu, but worse everywhere else.
7. **Feedback.**
   - **(a) Each row's "Send feedback" opens Luke's own feedback dialog, titled
     "Feedback on Factory".** The submission carries the experiment's key, a
     fixed value, never free text.
   - (b) A link to a GitHub issue template.
   - (c) No per-experiment feedback.
8. **Analytics.**
   - **(a) Count a switch as `experiment:toggle`, carrying the experiment and
     on or off,** both from `as const` sets. Opening the page is already
     counted as `settings:view_open`.
   - (b) Also stamp every counted event with the experiments that are on.
   - (c) Count nothing.
9. **A remote kill switch.**
   - **(a) None in v1.** A broken experiment is fixed in a release, or by
     its graduation or removal PR. With the choice on the server, a
     server-forced "off" is about 20 lines later, if ever needed. PostHog
     feature flags are not used: the desktop deliberately declines them
     (`session-replay.ts:220-226`), and they would be a second source of
     truth.
   - (b) A `withdrawn` status in the registry that the server answers as off
     for everyone, taking effect on the next launch.
10. **How a feature graduates.**
    - **(a) One PR deletes the registry entry and every gate.** The feature is
      simply on, and the changelog says "Factory is out of Experimental".
      Deleting the key makes every gate fail to compile, so none can be
      missed. An old build that hasn't updated yet loses the feature until
      it updates.
    - (b) Two steps, GitHub's opt-out stage: one release where it is on unless
      switched off, then the deletion. This needs a third stored state
      (unset, on, off) and a `default` field.
11. **A guide paragraph.** An "Experiments" paragraph in
    `apps/desktop/src/renderer/AGENTS.md`: read a gate only through
    `useExperiment`, and tag a list entry rather than filtering at a call
    site.
    - **(a) Yes, added in PR 2.**
    - (b) No.

    Root `AGENTS.md` gets nothing.

## 1. How other products do it

The full notes, with a source for every claim, are in the research appendix
at the end. What matters for Luke:

| Product | Scope | Who | Live? | Feedback | Graduation |
| --- | --- | --- | --- | --- | --- |
| GitHub Feature preview | Account | Anyone | Live | A link per feature | Opt-in, then on by default, then default; the choice is kept at GA |
| ChatGPT Beta features (2023) | Account | Anyone (rolled out per feature) | Live | No per-feature link found | Toggle dropped at GA; the tab vanishes when empty |
| Claude.ai Feature preview | Account; today the org's owners | User; owners on Team and Enterprise | No source found | Support | "Some … become a permanent part of Claude. Others don't" |
| VS Code `Experimental` / `Preview` tags | User settings | Anyone | Live | Not per setting | Experimental, then Preview, then stable |
| Chrome flags | Browser install | Anyone | Relaunch | None | A flag expires one milestone after launch |
| Zed | User record, server flags | Zed invites | Hides and shows UI | Discord | `enabled_for_all`, then the code is removed |
| Figma betas | User, team, or org | Open, invite, or waitlist; admins can block some | Needed a refresh | Contact form | Announced in product |
| Linear Preview (2021) | Workspace | Admin, via ⌘K | No source found | In-app message | "released … to everyone" |
| Cursor Beta | Install (channel); toggles | Anyone; teams locked to Default | Channel needs an update | Forum | A toggle removed with its stored value left behind |

**Patterns**

- **Account-scoped switches are the norm for individuals,** with an admin
  layer added only by team products (GitHub Copilot, Claude Enterprise,
  Notion).
- **One switch, one line of description, and one feedback link per feature**
  (GitHub: "Each feature includes a link to give feedback").
- **Hidden when off:** Zed hides "UI elements related to the feature".
- **Live, not relaunch,** except for engine-level flags (Chrome).
- **Graduation deletes the toggle,** and Cursor shows what goes wrong when the
  stored value outlives it: a "Hide Agent Review" toggle "removed from the UI
  without clearing the stored value" left the feature hidden with no way
  back.
- **Expiry discipline:** Chromium gives every flag an owner and an expiry
  milestone.

**Copy worth borrowing**

- VS Code: "These features might change or be removed in the future."
- Claude: "The experience may change." and "we sometimes remove features
  that don't work out."
- Figma: "Beta features can change during the beta period."

Chrome's "Warning: Experimental features ahead!" is too alarming for a small
app.

**Sources**

- https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview
- https://github.blog/changelog/2026-04-23-global-pull-requests-dashboard-moves-to-opt-out-public-preview/
- https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- https://support.claude.com/en/articles/14503520-available-beta-and-research-preview-features
- https://code.visualstudio.com/docs/configure/settings
- https://chromium.googlesource.com/chromium/src/+/main/docs/flag_ownership.md
- https://developer.chrome.com/docs/web-platform/chrome-variations
- https://zed.dev/faq
- https://help.figma.com/hc/en-us/articles/4406787442711
- https://linear.app/changelog/2021-12-02-workspace-templates
- https://cursor.com/docs/account/update-access
- https://forum.cursor.com/t/can-t-re-enable-cursor-review/150425

Slack, Notion, Discord, Arc and Raycast have no user-facing preview panel
that could be confirmed. Slack's beta is a release channel per install, and
Discord's Experiments tab is internal.

## 2. What Luke has today

**Settings.** Settings lives only on the desktop. It has eleven pages since
#2501 ("every setting has one home"):

- The page ids are `SETTINGS_PAGE` in `packages/settings/src/schema-types.ts`.
- Their order is `SETTINGS_PAGE_LIST` in
  `apps/desktop/src/renderer/settings-views.ts`.
- Each page's name and glyph are in `apps/desktop/src/renderer/settings/pages.tsx`.
- A stored setting is declared once in `APP_SETTING_SCHEMA`
  (`packages/settings/src/schema.ts`). Both its row and the Settings search
  read that entry.
- The shared parts are `SwitchRow`, `SettingsGroup` and `Switch`. A row's
  detail is a `ReactNode`, so a link fits inside it.
- Every page counts its opening through a total `Record`
  (`packages/settings/src/counted.ts`), so a new page doesn't build until
  analytics names it.

**Storage.**

- Most settings live in `settings.json` on each Mac (`SettingsStore`,
  `packages/host/src/settings-store.ts`).
- Exactly one setting travels with the account: the voice
  (`ACCOUNT_PREFERENCE_FIELDS`). It is stored in the `account_preference`
  row (`packages/database/src/schemas/preferences.ts`) and served by
  `/api/account/preferences` (`apps/web/server/account-app.ts`).
- It is reconciled when the account gate opens, that is, at launch and at
  sign-in (`packages/host/src/compose-host.ts:194-197`). It is pushed on
  every local change.
- The coding agents' default model rides the same endpoint as a separate
  `codingAgent` part.

**No flag or gate exists anywhere.**

- Nothing reads PostHog flags. The desktop declines them explicitly with
  `hasFeatureFlags: false` (`apps/desktop/src/renderer/session-replay.ts:220-226`).
- The only visibility predicate is a schema row's
  `visible(view: SettingsVisibility)`.
- None of Terminal, @-mentions, Automations or avatar video is gated today:
  - each landed piece ships ungated, or is not wired to any UI yet;
  - avatar video was reverted off main (`1332f33e`).
- Factory has no code on main yet.

**Where a gated feature surfaces, and the one place each list is built:**

| Surface | Declared in | Where a gate goes |
| --- | --- | --- |
| Sidebar head rows (Home, Inbox) | `desktop/desktop-sidebar.tsx`: hand-written JSX | A conditional beside `SidebarInboxRow` |
| The view in the plan's place | `desktop/desktop-shell.tsx`: `inboxOpen ? … : …` | The branch, plus a `PLACE_KIND` in `navigation-history.ts` |
| ⌘K actions, the keymap, and a menu item's effect | `app-commands.ts`: an action exists only while `useAppCommand(command, run)` offers it | Offer `undefined` while off. That one move hides it from all three |
| The Keyboard shortcuts page and ⌘K's shortcut list | `shared/shortcuts.ts`: `APP_SHORTCUTS` (total) and `APP_SHORTCUT_GROUPS` | An `experiment` tag on the entry, filtered where the groups are built |
| The application menu | `main/app-menu.ts`: a static template, built once | Main passes the experiments in (as it passes `update`) and rebuilds on change |
| The side panel's "+" and the plan column's "+" | `desktop/side-panel.tsx` `panelEntries`, `desktop/main-tabs.tsx` `addEntries` | An `experiment` tag on the entry kind, filtered in that one function |
| Main → renderer "show" asks | `shared/bridge.ts` (`onShowInbox`, …) | Dropped while off |
| Deep links | None: there is no `luke://` handler (`mention-link.ts` is provisional) | Nothing today. A future handler checks the gate |

## 3. The design

### Storage and sync (decision 1a)

**The server.** A new nullable `experiments jsonb` column on
`account_preference` holds `{ "factory": true }`, keyed by the experiment's
own key.

- The migration is `pnpm db:generate --name=account_preference_experiments`.
- `GET /api/account/preferences` answers a third part, `experiments`. It
  answers only keys the registry knows; an unknown key is dropped and never
  refused.
- `PUT` takes `{ experiments: { factory: true } }` as a **patch per key**,
  merged with `jsonb ||`. An older Mac that doesn't know a newer experiment
  can never erase it, and nothing needs the voice's three-way merge.

**Unlike the voice, the server is the truth.**

- A switch writes to the server first. The `SwitchRow` shows a refusal
  under the row, as it already does, and stays where it was.
- The Mac caches the last answer in `settings.json`, so the window draws the
  right sidebar at launch before the network answers.
- The cache is refreshed on the same reconcile as the voice (launch and
  sign-in) and cleared at sign-out.
- Signed out, every experiment is off.

**The wire reader keeps known keys and ignores the rest.** This is the
opposite of `accountPreferencesFromWire`, which refuses a whole snapshot
over one unknown field. That refusal would break the voice's sync for every
older Mac the day a new experiment ships, so experiments get their own part
and their own tolerant reader.

**Path:**

1. The renderer sends `ACT_KIND.EXPERIMENT_SET {experiment, on}`.
2. The main process calls a gateway method `experiments.set` on the host.
3. The host makes the `PUT`, caches the answer, and publishes it.
4. App state carries the answer to every window, and main reads it to build
   the menu.

This follows the existing settings write path: one act, one router row, one
gateway method.

### The registry

One `as const` list in `packages/settings/src/experiments.ts`. It sits beside
the settings vocabulary, which the desktop, the host and the web all already
reach:

```ts
// experiments.ts -- the features a developer can turn on before they are finished.
export const EXPERIMENT = {
  FACTORY: "factory",
} as const;

export type Experiment = (typeof EXPERIMENT)[keyof typeof EXPERIMENT];

/** Newest first: the order the Experimental page lists them. */
export const EXPERIMENTS = [
  {
    key: EXPERIMENT.FACTORY,
    name: "Factory",
    detail: "Every plan on one board, from Plan to Build to Ship, beside the Inbox. Read-only for now.",
    owner: "Dean",
    since: "0.14.0",
  },
] as const satisfies readonly ExperimentEntry[];
```

- **An entry exists only while its feature is experimental.** Graduation
  deletes it (decision 10a), so there is no `status` to drift, and every
  experiment is off by default, so there is no `default` field either. Both
  come back only if Dean picks 9b or 10b.
- `owner` and `since` are Chromium's discipline at its smallest. A release's
  changelog review sees how long each experiment has stood.

**One way to read it:**

- The renderer uses `useExperiment(EXPERIMENT.FACTORY)`, read off
  `useAppState`, and `experimentOnNow(key)` for a callback that can't wait a
  render.
- Main reads the same app-state value.
- `SettingsVisibility` gains `experiments`, so a gated feature's own Settings
  rows hide through the `visible` predicate that already exists.

### The Settings › Experimental page (decisions 3, 4, 7)

**The page joins the existing structure:**

- `SETTINGS_PAGE.EXPERIMENTAL` in `schema-types.ts`;
- after `THIS_MAC` in `SETTINGS_PAGE_LIST`;
- "Experimental" with lucide's `FlaskConicalIcon` in `pages.tsx`;
- `PRODUCT_SETTINGS_VIEW.EXPERIMENTAL` in `counted.ts`.

**What it draws:**

- **No intro text** (Dean, 2026-10-14). The page is its title, then the
  rows.
- **One `SettingsGroup`, one `SwitchRow` per entry:** the name, the
  one-line detail, and "Send feedback" at the end of the detail. The switch
  writes at once, with no confirm.
- **The empty state,** when the registry is empty (Dean, 2026-10-14). It is
  the empty Inbox's own component, `EmptyState` (`empty-state.tsx`, drawn by
  `desktop-inbox.tsx` as `<EmptyState icon={<InboxIcon />}>`), centred in the
  page column under the title. It has the flask glyph, large and muted, the
  title "No experiments right now", and the line "New features show up here
  to try before they ship."
  - `EmptyState` draws a glyph and one line today. PR 3 gives it an optional
    `title`, drawn the way `ConversationEmptyState` (the component beneath
    it) draws its own: medium weight, in the primary ink, a small gap above
    the line.
  - The Inbox's call is unchanged.
  - Its comment is amended to name a Settings page with nothing on it among
    the places that draw one.

**Search.** Each entry joins the Settings search corpus: its name, its
detail, and the page's title. A result lands on the row. ⌘K's settings rows
reuse that corpus, so typing "factory" finds the switch even while Factory is
off. Each row's anchor is its experiment key, and a test holds the keys
apart from setting ids and `SETTINGS_SEARCH_ROW`.

**Feedback.**

- `FeedbackDialog` gains an optional `experiment`. Its title becomes
  "Feedback on Factory".
- `FeedbackSubmission` gains `experiment?: Experiment`, a fixed value read
  against the registry, so the email names the experiment.
- Nothing else rides along, as now.

### Gating rules (decisions 5, 6)

1. **Off means absent everywhere,** surface by surface:
   - no sidebar row;
   - no place the window can stand on;
   - no ⌘K action;
   - no chord on the Keyboard shortcuts page or in the keymap;
   - no application menu item;
   - no "+" entry.

   The Experimental row stays searchable, so the feature is one search
   away.
2. **One gate per list.** The `experiment` tag lives on the entry's
   declaration (a shortcut, an add-entry kind), and the one function that
   builds the list filters it. No call site carries a second copy of the
   check. `APP_SHORTCUTS` stays total; the tag is what the groups filter on.
3. **Commands gate by their offer.** `useAppCommand(APP_COMMAND.FACTORY, on
   ? open : undefined)` removes the action from ⌘K, frees the chord, and
   makes the menu's click inert, all in one place.
4. **The menu follows live.** Main builds `appMenuTemplate` with the
   experiments that are on and rebuilds it when they change.
   `update-service-host.ts` already rebuilds it through `showMenuBar` when
   an update arrives.
5. **Switched off while in use:**
   - **The switch flipped here.** Settings takes the whole window, so the
     feature isn't on screen. Leaving Settings by Back skips a place whose
     experiment is off and lands on the place before it, or Home.
   - **Turned off on another Mac.** This arrives at the next reconcile
     (launch or sign-in). If the window stands on the feature, it goes Home.
     A window restored onto it at launch opens Home instead.
   - **A tab-shaped experiment (Terminal, later).** Its open tabs close, the
     way a retired side-panel tab kind's are dropped
     (`RETIRED_SIDE_PANEL_TAB`). Turning it back on doesn't reopen them.
6. **Marking (decision 5a).** The feature's own toolbar wears one quiet
   "Experimental" badge, drawn as `.integration-tool-badge` is, and
   "Send feedback". The sidebar row is drawn like Home's and the Inbox's.
7. **Shortcuts.** A gated feature's chord is reserved in `APP_SHORTCUTS`
   from its first PR, so turning it on never collides with another
   command. The show uses ⇧⌘F for Factory, which is free today; the choice
   is Factory's PR's.

### Analytics (decision 8a)

- `PRODUCT_EVENT.EXPERIMENT_TOGGLE` (`experiment:toggle`) carries
  `{ experiment, value: on | off }`.
- The host records it after a write the server accepted.
- `PRODUCT_EXPERIMENT` in `packages/analytics/src/product-events.ts` is
  bridged from `EXPERIMENT` by a total `Record` in `counted.ts`, the pattern
  `SETTINGS_VIEW_COUNTED_AS` already uses. A new experiment doesn't build
  until analytics names it.
- No name, path, or free text can travel, and no credential is anywhere
  near.
- Session replay records the page masked, like every other.

### Graduation (decision 10a)

One PR, which the release that ships it names in the changelog:

1. **Delete the registry entry and its counted name.** Every
   `useExperiment(EXPERIMENT.FACTORY)` and every `experiment:` tag then fails
   to compile, so each one is found and deleted. The feature is simply on.
2. **The server stops answering the key,** because it is no longer in the
   registry. Its stored value is left inert and dropped on the account's
   next write.
3. **Cursor's trap can't happen,** because no gate is left to read a stale
   value.
4. **Write "Factory is out of Experimental"** in `CHANGELOG.md`.

An old build that hasn't auto-updated yet loses the feature until it does.
10b exists if that ever matters.

### Tests

The tests follow `AGENTS.md` "Testing": hermetic, at the smallest layer, and
built from the shared builders.

- **Helper.** `experimentsOn(...keys)` in `@sidecar/settings/testing` builds
  the app-state value. Renderer tests pass it through the existing state
  builders, and host tests pair it with `fakeHttpClientLayer`. There is no
  network and no real clock, and each test passes alone.
- **Store.** A new sibling `packages/database/src/models/__tests__/account-store.test.ts`
  on `getTestDB()`. The model has none yet; today it is covered from
  `apps/web/tests/hosted-account-store.test.ts`. It covers:
  - a patch merges per key;
  - an unknown key is dropped;
  - one account cannot read another's experiments.
- **Wire.** The reader ignores an unknown key rather than refusing the
  answer, which protects an older Mac against a newer server.
- **Renderer:**
  - with Factory off, the sidebar row is absent and the command is not
    offered;
  - the Keyboard shortcuts page hides the chord;
  - the page lists its rows, or the empty state;
  - the search finds a row by its name.
- **Main.** The menu template omits Go › Factory while it is off.
- **Evidence.** `./scripts/verify.sh` evidence for the page and the sidebar,
  in light and dark. The PR body says CI could not verify it.

## 4. The PRs

They form one stack, in order. Each is small enough to review in one sitting.

| # | PR | Size | Builds |
| --- | --- | --- | --- |
| 1 | `feat(web,settings): experiments stored on the account` | S–M, ~300 lines | The registry module (starting empty), the tolerant wire reader, the `experiments` column and migration, the store's read and per-key merge with tests, and the endpoint's third part with tests |
| 2 | `feat(desktop,host): read and write an experiment, gated in one place per list` | M, ~450 lines | The host cache, reconcile and write, `experiments.set`, `ACT_KIND.EXPERIMENT_SET`, app state, `useExperiment`, the `experiment` tags and their filters (shortcuts, "+" entries), the menu rebuild, history skipping an off place, and `experimentsOn` |
| 3 | `feat(desktop): Settings › Experimental` | M, ~350 lines | The page, its place and icon, counted names, rows and empty state (`EmptyState` gains an optional title), search entries, the feedback dialog's experiment, and `experiment:toggle`. With the registry still empty, it ships showing the empty state. `verify.sh` evidence |
| 4 | Factory's view (worker 260), gated | Worker 260's | Factory's registry entry, then its view, sidebar row, command, chord and Go menu item, each behind `useExperiment(EXPERIMENT.FACTORY)`, with the toolbar badge and Send feedback |

**Order.** Factory stacks on PR 3, because that is the only way to turn it on
in the app.

**Fewer PRs.** If Dean wants one, PRs 1 and 2 merge into one of about 750
lines. PR 1's web half deploys from main on merge, before any desktop build
asks for it.

## 5. Not in this proposal

- A build channel (Insiders or Nightly). That is a per-install updater
  setting, a different axis from these switches.
- An admin or workspace layer, and staged rollout to a percentage of
  accounts.
- PostHog feature flags, or any remote flag service.
- Factory's own design. That is worker 260's.
- Anything in root `AGENTS.md`.

## Appendix: research notes

The research, with a source for every quote, was gathered on 2026-10-14.

- **GitHub.** "click your profile picture, then click **Feature preview**."
  You "enable or disable each feature for your personal account", and
  "Each feature includes a link to give feedback."
  (docs.github.com, above)
  - On opt-out graduation, the dashboard "will be on by default for all
    GitHub users". It can still be switched off from an in-page "Preview"
    label with "Give feedback" (github.blog changelog, 2026-04-23).
  - Copilot: "If you opt into a preview and it later becomes generally
    available, your existing choice will be preserved."
    (https://github.blog/changelog/2026-09-24-default-enablement-of-copilot-features-for-copilot-business-and-enterprise/)
- **VS Code.** Experimental is "Exploratory features available for early
  adopters. These features might change or be removed in the future."
  - Preview features "have the final functionality but might still be
    iterated on for stability and polishing."
  - "VS Code applies changes to settings directly as you change them."
    (code.visualstudio.com)
- **Chrome.** "Warning: Experimental features ahead! … Enabled features apply
  to all users of this browser."
  (https://chromium.googlesource.com/chromium/src/+/64.0.3273.2/components/flags_ui_strings.grdp)
  - A flag should "expire at least one milestone after you expect your
    feature to have launched" (flag_ownership.md).
  - Variations "can be used as a safety mechanism to turn off a feature,
    although this happens rarely" (developer.chrome.com).
- **Zed.** "If you are not associated with the feature flag, UI elements
  related to the feature will be hidden." (zed.dev/faq)
  - `enabled_for_all` turns a flag on "without needing to remove all of the
    call sites."
    (https://raw.githubusercontent.com/zed-industries/zed/main/crates/feature_flags/src/feature_flags.rs)
- **ChatGPT (2023).** Beta features are "accessible via a new beta panel in
  your settings."
  - The kill switch: "As of July 3, 2023, we've disabled the Browse with
    Bing beta feature".
  - Graduation: users "no longer need to switch the beta toggle".
    (help.openai.com release notes, via search excerpt)
  - The empty tab: "there are not currently any features in beta, thus no
    beta settings tab."
    (https://community.openai.com/t/i-don-t-see-beta-features-in-my-settings/744078,
    via search excerpt)
- **Claude.ai.** "The experience may change." / "Performance and reliability
  may vary." / "Some beta and research preview features become a permanent
  part of Claude. Others don't, and we sometimes remove features that don't
  work out." (support.claude.com)
- **Figma.** "Beta features can change during the beta period." Access "may
  be granted to an individual, a team, or an entire organization", and
  graduation is announced "directly in-product". (help.figma.com)
- **Linear (2021).** "To enable it for your workspace, ask an admin to open
  the command menu with Cmd/Ctrl K and search for "Preview"." (linear.app
  changelog)
- **Cursor.** "Team and Enterprise accounts use Default mode."
  (cursor.com/docs)
  - A Beta toggle "was removed from the UI without clearing the stored
    value" (forum.cursor.com).
- **Slack.** The desktop beta is a release channel, chosen per install under
  Preferences → Advanced
  (https://slack.com/help/articles/226192087-Join-Slack%E2%80%99s-desktop-app-beta-program).
  No user feature-preview panel was found.
- **Notion, Discord, Arc, Raycast.** No user-facing preview panel could be
  confirmed:
  - Notion labels betas inline, and its admins gate some.
  - Discord's Experiments tab is internal; users get PTB and Canary builds.
  - Arc Max had one master switch plus a switch per feature
    (https://tidbits.com/2023/10/06/arc-web-browser-introduces-focused-ai-features/).
  - Raycast's experiments toggle is unverified.

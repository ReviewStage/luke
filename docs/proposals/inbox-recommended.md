# Proposal: a recommended option you can see

Status: **decided by Dean on 2026-10-15** and built in the same PR. Dean
went with (a) and every recommendation in §5: no pre-select, no
reordering, and the badge goes quiet once the item is answered, with the
focus-ring fix alongside.

The design show lives at `docs/proposals/inbox-recommended/index.html`. It
is one self-contained file that fetches nothing. Every frame is main's
desktop stylesheet as built at `79d807e8`, light and dark, over the DOM the
real `InboxPane` drew for synthetic questions, with each option's CSS added.
It shows today's state and four options: unanswered at 600px beside the list
and at 400px in the narrow tier, with hover, keyboard focus, and pressed
states, and answered with the pick and the recommendation the same and
different. The research behind it is
`docs/proposals/inbox-recommended/research.md`.

Dean's ask: "The 'Recommended' badge on Inbox items isn't prominent enough.
Let's see some proposed designs on a show."

## 1. Today

`ChoiceOptions` and `Proposal` (`apps/desktop/src/renderer/planning/inbox-pane.tsx`)
say the recommendation as " · Recommended" after the label, in the muted ink
every option's detail is drawn in. A long label pushes it onto a second line,
which in the narrow tier is common, and in a list of four it reads like one
more detail. Once answered it stays the same muted words.

While drawing the states, a second problem turned up. The keyboard's ring on
an option is clipped at the left and bottom edges, because the message body
holding the options is `overflow: hidden`.

## 2. The options

| | Treatment | Verdict |
|---|---|---|
| **(a)** | A small filled "Recommended" badge in the accent at the option's top right, in the app's badge geometry (`.integration-tool-badge`: 10.5px, 560, a 16px line, a 4px corner). Once answered it goes to the quiet grey badge. | **Pick** |
| (b) | The recommended card gets an accent hairline ring and a faint accent ground, plus a tinted badge. | It reuses the selection look: with another option picked, two cards are ringed. |
| (c) | A sparkle and "Recommended" in accent ink lead the label. | A sparkle reads as "made by AI" and would be the app's only one. The accent as small ink is 3.8:1 on dark and 4.2:1 on light, short of AA. |
| (d) | Listed first, with an accent eyebrow over the label, optionally pre-selected with the keyboard on it. | Reordering overrides the agent's order. The eyebrow has (c)'s contrast shortfall. Pre-selection makes Send accept without reading. |

## 3. The pick, and why

**(a).** It is the clearest of the four at a glance and stays in one place
in every width. It says the word rather than relying on colour (Primer and
Atlassian both require this), holds 4.7:1 in both themes, and reuses a shape
the app already has. The option's pressed ring stays the only "picked" look.
The Send button is drawn in ink, not the accent, so the badge doesn't
compete with it.

## 4. Build

One small desktop PR, about 40 lines of TSX and CSS plus tests:
`feat(desktop): an Inbox option the agent recommends wears a Recommended badge`.

- `inbox-pane.tsx`: `ChoiceOptions` and `Proposal` draw an option's head as
  one shared component, the label and then the badge, with the badge
  settled in `Proposal`.
- `planning.css`: `.inbox-option-head` and `.inbox-recommended`, as shown
  under (a).
- The badge lives entirely inside the option element. It doesn't depend on
  the pane's width or on any wrapper only `InboxPane` has, so the Inbox
  narrow-tier redesign's list cards, which also draw `ChoiceOptions` and
  `Proposal`, get it unchanged.
- The clipped ring: the message body clips with `overflow: clip` and
  `overflow-clip-margin: var(--focus-ring-reach)`, as `.inbox-crumbs`
  already does.
- Tests, in `desktop-inbox.test.ts`, through the real Inbox, assert:
  - the badge appears on the recommended option only;
  - an item with no recommendation draws no badge;
  - once answered, both the pick and the recommendation are shown when they
    differ.

## 5. Decisions

1. **Pre-select the recommended option?** Recommended: no. An Inbox answer
   is acted on by an agent, so it should be a deliberate press. The HIG
   leaves no default where people need to read first, and a multiple-choice
   question has no single option to pre-select.
2. **List it first?** Recommended: no in the window, since the agent's order
   may carry meaning. If first position is wanted too, a clause in the
   `inbox_post` tool's description
   (`packages/service/src/agents/coder-host/inbox.ts`) can ask agents to put
   it first, in a separate one-line service PR.
3. **Once answered, quiet or still accent?** Recommended: quiet.

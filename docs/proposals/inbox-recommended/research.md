# How products mark a recommended choice

A survey of how polished products visually set one option apart as the
recommended or default choice among several. Each section says what the
treatment is and where it is documented. Where a source did not describe the
styling, the section says so rather than guessing.

## Linear

Triage Intelligence suggests a team, project, assignees, and labels for an
issue in triage. The suggestions sit in a pane under the issue title, in a
suggestions header, and each one can be accepted, declined, or opened to show
why it was made. A suggestion is a proposed value waiting for a decision, not a
value already set. Auto-applied properties are "clearly marked in the
suggestions header" apart from ones that are "only suggested", and hovering one
shows its reasoning. Neither page names the icon or colour, so the visible rule
is a separate pending state with an explanation one hover away, not a badge.
Sources: https://linear.app/docs/triage-intelligence,
https://linear.app/changelog/2025-09-19-auto-apply-triage-suggestions

## GitHub

Suggested reviewers appear in the Reviewers section of the pull request
sidebar, chosen from git blame data. Each one is an ordinary row with a small
**Request** text link beside the username, so the suggestion is marked by its
place in the list and an inline action, not by colour. On the Actions "Choose a
workflow" page, templates GitHub picks from the repository's language and
framework are shown as "a selection of recommended workflow templates" above
the searchable catalogue. Here the recommendation is a grouping and an order,
not a per-card badge. When Primer, GitHub's design system, needs a word-shaped
marker, it uses its `Label` component: a small outlined label whose `variant`
(`default`, `primary`, `secondary`, `accent`, `success`, `attention`, `severe`,
`danger`, `done`, `sponsors`) sets its text and border colour, in `small`
(the default) or `large`. Primer's accessibility page says "you can't rely on
the scheme/variant alone to give meaning to your content": the label's text has
to carry the meaning.
Sources: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/requesting-a-pull-request-review,
https://docs.github.com/en/actions/how-tos/write-workflows/use-workflow-templates,
https://primer.style/product/components/label,
https://primer.style/product/components/label/accessibility

## Stripe pricing table

Stripe's embeddable pricing table shows up to four products side by side. In
the Dashboard's **Display settings** step you can "highlight a specific
product" and set the language, colours, font, and button design. The docs do
not describe the highlighted card's badge wording or styling, so I could not
confirm a fixed "Most popular" label from Stripe's own pages. The model is one
highlighted card among a small set of equal ones, with its colour set by the
merchant's theme.
Source: https://docs.stripe.com/payments/checkout/pricing-table

## Vercel pricing page

Vercel's pricing page shows three plan cards in order: Hobby, Pro, and
Enterprise. Pro, the middle card, has a **Popular** chip right after the plan
name, on the same title line. In the page's markup the chip is a fully rounded
pill 20 px tall with 11 px medium text, a pale grey (`gray-200`) fill, and
near-black (`gray-1000`) text. It is neutral, not brand-coloured. Pro's call to
action ("Start a free trial") also uses the filled, dark primary button style,
while Hobby's "Start deploying" and Enterprise's "Get a demo" carry the
secondary style. The chip says why the card is set apart, and the button
weight says which action is expected.
Source: https://vercel.com/pricing

## Claude Code and ChatGPT

Claude Code's AskUserQuestion tool has the model mark a recommendation in the
option itself: "If you recommend a specific option, make that the first option
in the list and add "(Recommended)" at the end of the label". That is a
text suffix plus first position, with no colour or badge, and it reads the same
in a terminal or a screen reader. ChatGPT's "Which response do you prefer?"
comparison does the opposite on purpose: it shows two candidate replies and
marks neither, because the user's unprompted choice is the signal being
collected. Users describe it in OpenAI's community forum, not in OpenAI's own
docs.
Sources: https://dev.to/_94be737e156beb4d74df2/claude-code-tools-deep-dive-1-askuserquestion-4ck1
(quoting the tool prompt),
https://community.openai.com/t/incorrect-use-of-ui-ux-when-choosing-which-response-do-you-prefer/596139

## macOS default buttons (Apple HIG)

A macOS push button with the **primary** role "is the default button — the
button people are most likely to choose". It is filled with the app's accent
colour, and "when a primary button responds to the Return key, it makes it easy
for people to quickly confirm their choice". In a sheet or alert, Return also
closes the view. The HIG says to "use style — not size — to visually
distinguish the preferred choice", and to keep prominent buttons to one or two
per view. In alerts, "always place the default button on the trailing side of a
row or at the top of a stack", with Cancel on the leading side or at the
bottom. Never make a destructive or Cancel button the default. To make people
read before acting, leave no default at all.
Sources: https://developer.apple.com/tutorials/data/design/human-interface-guidelines/buttons.md
(the HIG "Buttons" page),
https://developer.apple.com/tutorials/data/design/human-interface-guidelines/alerts.md
(the HIG "Alerts" page)

## Raycast

Raycast marks the default by position and key: the primary action is the first
action in the selected item's Action Panel. It is "displayed prominently at the
top and is the action that runs when you press ↵ without opening the panel".
The developer API assigns the shortcuts by order: in List, Grid, and Detail
views the first action gets ↵ and the second gets ⌘↵. In a Form the first gets
⌘↵ and the second ⌘⇧↵. The ↵ glyph next to the action's name is the
recommendation marker. There is no badge.
Sources: https://manual.raycast.com/action-panel,
https://developers.raycast.com/api-reference/user-interface/action-panel

## Atlassian lozenge

Atlassian's `Lozenge` is the status marker of its design system. It is a
compact filled tag whose `appearance` is one of `success`, `information`,
`discovery`, `warning`, `danger`, `neutral`, or an accent colour, and it is now
bold (filled) by default. The guidance is to keep the text to "just a word or
two", avoid truncation, and "don't use color alone to signify an important
state. Instead, use an accurate label." For categories rather than status it
points to `Tag`.
Source: https://developer.atlassian.com/platform/forge/ui-kit/components/lozenge/

## What it says for Luke

- Make the recommended choice the first one and the default one. Raycast's ↵,
  macOS's default button, and Claude Code's first-position rule all tie the
  recommendation to where the eye lands first and to the key that confirms
  without a pointer. Where Return is in play, the recommended option should be
  the one Return takes, and it should never be a destructive one.
- Say it in words, and keep the words small. Vercel's "Popular" pill, Primer's
  `Label`, Atlassian's lozenge, and Claude Code's "(Recommended)" suffix are
  all one or two words, sit on the option's own title line, and are no taller
  than the text. A badge that overpowers the option's name is louder than any
  of these products allow.
- Never rely on colour alone. Primer and Atlassian both say so outright, and
  Claude Code's convention uses no colour at all. Colour or tint can reinforce
  the label but must not replace it.
- Prefer neutral emphasis over brand colour for the badge. Vercel's chip is
  grey on a pale grey ground, and the accent colour is saved for the one filled
  action. Use one accent per view, as the HIG's "one or two prominent buttons"
  rule suggests.
- Keep ring and tint for a few side-by-side cards. A highlighted card is the
  pricing-table pattern (Stripe, Vercel), for three or four peers compared at a
  glance. In a list or inbox, GitHub's and Linear's pattern fits better: an
  ordinary row with an inline action or a pending state, and the reason one
  hover away.
- Withhold a recommendation when the user's own judgement is the point.
  ChatGPT's comparison marks neither reply, and the HIG says to leave no
  default when people should read before acting.

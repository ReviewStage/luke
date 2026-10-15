# Proposal: one polished style for plain links and URLs

Status: **decided by Dean on 2026-10-15**: "For links, let's do (c). And
plan/history/notes links should also open in the browser." Built as one PR:
the `.text-link` rule, `@luke/ui/link-face`'s `linkFace`, the window's
tooltip naming the address, and plain links in the plan, its versions and
Luke's notes opening in the browser. History and notes drawing mentions as
chips shipped with the mention chips' own PR (#2795).

The show is `docs/proposals/plain-links/index.html`, one self-contained
file that fetches nothing. Open it in a browser. Each frame uses main's
compiled desktop stylesheet, in its light and dark appearance, over the DOM
the real components drew for the same synthetic words: `TranscriptWords`,
`MarkdownMessage`, TipTap's editor, and the mention chip. Only the Inbox's
link blocks and the states rows are written by hand, with the components'
own classes.

Dean's ask: "I don't really like the style of plain URLs. Can you have a
worker make a conductor show with today's styling and some proposed more
polished options."

Recognised links are becoming mention chips: plans and sections, repository
files and lines, and Linear, GitHub, Sentry and other integration pages.
This proposal covers everything else: unknown pages, docs, and bare
`https://…` text.

## Today

Six surfaces draw plain links three different ways.

| Surface | Renderer and class | Look | Opens? |
| --- | --- | --- | --- |
| Agent and Call-tab replies | Streamdown, `TranscriptLink`, `.agent-link` | `--state-working` cyan, full-strength underline, 2px offset | Browser |
| Inbox body and link blocks | Same, and `LinkBlock`, `.agent-link` | Same | Browser |
| Plan read view | react-markdown, `plainLink`, `span.markdown-link` | Text colour, underline at 28%, 0.15em offset, native `title` | Nothing |
| Version history, Code-tab notes | Same, with no link drawer | Same | Nothing |
| Plan edit mode | TipTap link mark, `.plan-document-text a` | Same as the read view | Nothing (`openOnClick: false`) |

Beyond the table:

- **No surface has a hover or focus state.** A transcript link shows its
  address nowhere, since it has no `title` and Electron has no status bar.
- **The cyan is `--voice-luke`, the voice's colour.** A bare URL prints as a
  cyan bar of up to 90 characters, broken at any letter by
  `overflow-wrap: anywhere`. This is the part Dean dislikes.
- **Some surfaces show a mention as a plain link.** Version history,
  Code-tab notes and the Inbox draw one as underlined `@Rollout`, while the
  plan draws a chip. History and notes pass no link drawer; the Inbox
  stands outside `PlanMentions`.
- **An address that is not a web page is drawn two ways:** dotted in a
  transcript, plain words in the plan.

## What other tools do

Fuller notes with sources are in `plain-links/research.md`.

- The modern prose default is text colour with a thin (1px), offset
  (about 0.2em), low-contrast underline that strengthens on hover. Vercel's
  brand CSS and Notion verifiably do this.
- GitHub and VS Code use accent blue. GitHub has underlined links by
  default since 2023, so that a link is not told by colour alone.
- None of the verified sources puts ↗ on plain links.
- Shortening is semantic: recognised URLs shorten and other bare URLs print
  whole. Favicons belong to citations and mentions, not plain links.

## Options

- **(a) Quiet underline.** Text colour, a 1px underline 0.24em below at
  32% of the text's colour, full strength on hover or focus. Bare URLs stay
  whole.
- **(b) Accent colour, underline on hover.** A link blue (`#0b63c4` light,
  `#6cb2ff` dark), no underline until hover. This tells a link by colour
  alone.
- **(c) Quiet underline with short bare URLs.** (a)'s look. Link words that
  are the link's own address draw as `domain/path`, with a small ↗ and the
  full address in the window's tooltip. Labelled links keep their label.
  In the editor, the address is the text being edited, so it stays whole.
- **(d) Link pill for bare URLs.** Labelled links as in (a). A bare URL
  becomes an outlined pill with a globe and the short address.
  - It sits close to a gone chip's outline.
  - Real favicons would need main to fetch and cache them, because the
    window refuses to request images.

## Pick: (c)

- **It removes what Dean dislikes.** The raw cyan URL loses both its colour
  and its length, and the full address moves to one hover away instead of
  nowhere.
- **It cannot be mistaken for a chip.** A chip is a filled pill with a
  leading glyph at medium weight. A text-colour underline has no fill, no
  colour and nothing in front of it.
- **It is the verified modern default**, and the underline means it does
  not rely on colour alone.
- **The ↗ marks a real difference.** A chip opens in Luke; a plain link
  leaves it.

If Dean wants nothing shortened, (a) is the same build without the helper.

### How the short address is made

1. Drop the host's `www.`.
2. Add the path. Keep a short query and drop the `#fragment`.
3. If the result is over 44 characters, fold the middle steps to `…` and
   cut a long last step.

| Address | Drawn as |
| --- | --- |
| `https://vercel.com/docs/functions/runtimes/node-js#node-js-version-…` | `vercel.com/docs/functions/runtimes/node-js` |
| `https://www.postgresql.org/docs/current/sql-createindex.html#SQL-…` | `postgresql.org/docs/…/sql-createindex.html` |
| `https://news.ycombinator.com/item?id=41234567` | `news.ycombinator.com/item?id=41234567` |

### Build size

About one small PR:

1. **One CSS rule**, `.text-link` in `markdown.css`, with its hover and the
   ↗'s size. It replaces `.agent-link`, `.markdown-link` and
   `.plan-document-text a`. TipTap's link mark gets
   `HTMLAttributes: { class: "text-link" }`.
2. **One DOM-free helper**, `linkFace(href, words)`, in `packages/ui`, used
   by both `TranscriptLink` and `plainLink`. It is tested through its export.
3. **The address on hover** through the window's own `Tooltip` on both
   renderers.
4. **Version history and Code-tab notes get the plan's link drawer**, so
   their mentions are chips.

One question for Dean, separate from the style: should a plain link in the
plan's read view, history and notes open in the browser, as a transcript's
does? Today it opens nothing. `useOpenLink` already exists, and the read
view would stop the click there, as a chip does. It is a few lines, and the
build can carry it or leave it.

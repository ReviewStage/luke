# How polished tools style plain links

This research backs `../plain-links.md`, gathered on 2026-10-15. Each claim
cites its source. A claim marked unverified is from memory.

- **GitHub** ([github-markdown-css](https://raw.githubusercontent.com/sindresorhus/github-markdown-css/main/github-markdown.css))
  - Links are accent blue: `#0969da` light, `#4493f8` dark.
  - The underline offset is `.2rem`.
  - The markdown CSS has no underline until hover. Focus-visible draws a 2px
    accent outline.
  - On github.com itself, links in text have been underlined by default since
    October 2023, so that a link stands out by more than colour
    ([changelog](https://github.blog/changelog/2023-10-17-new-default-underlined-links-for-improved-accessibility/),
    [GA](https://github.blog/changelog/2024-04-28-link-underline-setting-now-ga/)).
  - A bare URL prints whole. Only issue, pull request and commit URLs shorten,
    to `#26`, `owner/repo#26`, or a short SHA
    ([docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)).
- **Vercel** ([vercel-brand.css](https://vercel.com/geist/vercel-brand.css))
  - Links take the text colour (`color: inherit`).
  - The underline is 1px, 3px below the text, in `--vbg-gray-600`.
  - On hover the underline turns `currentColor`.
  - Geist's Link page now redirects, so there is no component page to cite.
- **Notion**
  - These values come from react-notion-x's copy of Notion's CSS
    ([styles.css](https://raw.githubusercontent.com/NotionX/react-notion-x/master/packages/react-notion-x/src/styles.css)),
    a community replica rather than Notion's own.
  - Links take the text colour. A `0.05em` bottom border in a faint
    foreground colour stands for the underline, at opacity 0.7.
  - On hover the border darkens and the opacity goes to 1, over 100ms.
  - A pasted URL can be kept as a bookmark card or as an inline mention with
    an icon and the page title
    ([help](https://www.notion.com/help/embed-and-connect-other-apps)).
- **Linear** ([docs](https://linear.app/docs/editor))
  - A pasted URL becomes a link.
  - YouTube, Loom and Figma links embed; "Keep as link" keeps the plain URL
    instead.
  - The link's colour and underline are unverified (from memory: text colour,
    subtle underline).
- **Slack**
  - Plain URLs are autolinked
    ([formatting](https://api.slack.com/reference/surfaces/formatting)).
  - A link with no app behind it unfurls into an OpenGraph card
    ([docs](https://docs.slack.dev/messaging/unfurling-links-in-messages/)).
  - A link labelled with its own address, minus the protocol, does not
    unfurl.
- **VS Code, and so Cursor**
  - Links use the `textLink.foreground` blue with no underline. An underline
    comes from an accessibility setting, a high-contrast theme, or hover
    ([style.css](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/browser/media/style.css),
    [theme colours](https://code.visualstudio.com/api/references/theme-color)).
  - Cursor's own chat link styling is unverified.
- **ChatGPT**
  - Citations are pills with a favicon and a truncated publisher name
    ([teardown](https://www.aiuxplayground.com/teardowns/chatgpt/citations),
    a secondary source).
  - That plain links are underlined in the text colour is unverified.
- **Claude.ai and Raycast**
  - I found no citable source for either one's plain-link CSS. Claude.ai's
    help centre only says that web-search replies carry citations
    ([help](https://support.claude.com/en/articles/10684626-enable-and-use-web-search)).

## Patterns

- **Text colour with a quiet underline is the modern prose default.** The
  underline is thin (1px), offset (about 0.2em) and low-contrast, and it
  strengthens on hover. Vercel and Notion verifiably do this.
- **Blue survives in developer tools,** but GitHub now adds an underline for
  accessibility.
- **No verified source puts ↗ on a plain link.** Previews and cards carry
  rich context instead.
- **Shortening is semantic.** Recognised links shorten and other bare URLs
  print whole.
- **Favicons belong to citations and mentions, not to plain links.**

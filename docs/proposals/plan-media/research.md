# Research: images and media in documents

How seven products and four coding agents handle images and other media in
a document that is Markdown or close to it. This backs
`docs/proposals/plan-media.md`.

How it was gathered, on 2026-10-15:

- Each product's own docs, changelogs and API references were read.
- GitHub's rendering was tested with `gh api markdown`, and its uploads with
  unauthenticated requests.
- TipTap's and prosemirror-markdown's source was read for the editor
  questions.
- Anything not confirmed on a first-party page is marked **UNVERIFIED** or
  credited to its community source.

## GitHub (issues, pull requests, comments)

**Inserting.**
- Drag and drop, paste, or the attach control under an issue's box or in a
  PR's formatting bar. The upload is immediate, and the box then shows the
  file's address.
- Limits:
  - images and GIFs, 10 MB;
  - video, 10 MB on a free plan and 100 MB on a paid one;
  - other files, 25 MB.
- Media formats: PNG, GIF, JPEG, SVG, MP4, MOV, WebM. Many document and code
  types are accepted too.
- Source: [attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).
- The CLI gained a repeatable `--attach` flag in September 2026
  ([changelog](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments)).

**Storage and who sees an image.**
- **Before May 2023**, uploads lived at `user-images.githubusercontent.com`,
  and "anyone can view the anonymized URL without authentication, even if the
  pull request or issue is in a private repository"
  ([GHES 3.5 docs](https://docs.github.com/en/enterprise-server@3.5/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)).
- **Since May 2023**, new attachments on private repositories "can only be
  viewed after logging in" ([changelog](https://github.blog/changelog/2023-05-08-more-secure-private-attachments)).
  The change was not retroactive.
- Today's addresses are `github.com/user-attachments/assets/<uuid>` and
  `…/files/<id>/<name>` (tested).
- A rendered body rewrites each image to
  `private-user-images.githubusercontent.com/…?jwt=…`, a token good for five
  minutes, even on a public repository (tested; staff confirm "5-minute-limited
  active attachment links" in
  [discussion 54551](https://github.com/orgs/community/discussions/54551)).
- External images are proxied through Camo, so the image's host never sees
  the reader ([anonymized URLs](https://docs.github.com/en/enterprise-cloud@latest/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)).

**Markdown.**
- A paste inserts HTML, not Markdown:
  `<img width="1252" height="625" alt="Image" src="https://github.com/user-attachments/assets/<uuid>" />`
  (tested on `cli/cli` issues; not documented).
- Videos insert a bare address on their own line. Other files insert
  `[name.pdf](…)`.
- The sanitizer keeps `width`, `height`, `align`, `title` and `alt`, and strips
  `style` and `class` (tested).
- `<picture>` with `prefers-color-scheme` sources picks a light or dark image
  ([GA changelog](https://github.blog/changelog/2022-08-15-specify-theme-context-for-images-in-markdown-ga)).

**Sizing, captions, lightbox, alt.**
- Sizing is through HTML `width` alone.
- There is no caption: `<figure>` and `<figcaption>` are stripped (tested).
- Every image is wrapped in a link to itself that opens in a new tab.
- Current uploads get `alt="Image"` (tested). GitHub's own alt-text bot
  exists because "GitHub's UI does not remind individuals to add alt text"
  ([blog](https://github.blog/2023-06-12-make-your-github-projects-more-accessible-with-accessibility-alt-text-bot)).

**Other media.**
- Mermaid, GeoJSON, TopoJSON and STL fences render, in the browser
  ([creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)).
- Math renders through MathJax.
- `<iframe>` is escaped by the GFM tagfilter, and a YouTube address stays a
  plain link (tested).

**Orphans and history.**
- There is no retention policy and no self-service delete of an upload.
  Assets go when the repository does (staff, discussion 54551).
- Image diffs in repositories offer 2-up, swipe and onion skin
  ([non-code files](https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files)).
- How a comment's edit history shows an image swap is UNVERIFIED.

## Linear (issue descriptions, documents)

**Inserting.**
- `/file` or `/insert`, ⌘⇧U, and drag and drop, including from websites, with
  uploads you can cancel
  ([editor](https://linear.app/docs/editor),
  [2024-04-24](https://linear.app/changelog/2024-04-24-editor-improvements)).
- The macOS desktop app gained "Insert screenshot" in the slash menu on
  2026-09-24 ([changelog](https://linear.app/changelog)).
- Pasting from the clipboard and the in-app size limit are UNVERIFIED. The
  only documented limit is 25 MB for issues created by email.

**Storage and who sees an image.**
- Files live in "Linear's private cloud storage" at `uploads.linear.app`, and
  "you must authenticate to access them". An API client sends its token, or
  asks for signed URLs with `public-file-urls-expire-in`
  ([file storage authentication](https://linear.app/developers/file-storage-authentication)).
- An API upload is a pre-signed PUT, which "must be executed on the server"
  ([uploading a file](https://linear.app/developers/how-to-upload-a-file-to-linear)).

**Markdown.**
- The API writes `![alt text](url)` into a description and re-hosts it
  automatically ([uploading a file](https://linear.app/developers/how-to-upload-a-file-to-linear)).
- The editor copies an issue as Markdown.

**Sizing, captions, lightbox, alt.**
- Drag handles resize, and images snap to each other's sizes
  ([2023-09-28](https://linear.app/changelog/2023-09-28-resize-images)).
- Click opens a lightbox, and a second click zooms to fit
  ([2024-04-24](https://linear.app/changelog/2024-04-24-editor-improvements)).
- Captions and alt text are UNVERIFIED.

**Other media.**
- YouTube, Descript and Loom links embed, with "Keep as link" to undo
  ([editor](https://linear.app/docs/editor)).
- Figma previews are snapshots through the integration
  ([Figma](https://linear.app/docs/figma)).
- Video uploads have been supported since 2019
  ([changelog](https://linear.app/changelog/2019-09-02-video-uploads-and-player)).
- **Mermaid** arrived 2025-11-20, through `/diagram` or a `mermaid` code block
  ([changelog](https://linear.app/changelog/2025-11-20-form-templates)).
  Comments on diagrams and zoom followed in 2026.

**History.**
- Documents and descriptions keep a version history and restore earlier
  versions ([documents](https://linear.app/docs/documents)).
- Whether removed images stay in history, and whether their uploads are
  deleted, is UNVERIFIED.

## Notion

**Inserting.**
- Drag and drop, paste, `/image`, `/file`, `/video`, `/embed`
  ([images, files and media](https://www.notion.com/help/images-files-and-media)).
- Limits: 5 MB per file on the free plan. The paid limit is given as 5 GB
  per file, but a note on the same page caps images at 5 MB and PDFs at
  20 MB, and Notion doesn't reconcile the two.

**Storage and who sees an image.**
- An uploaded file's URL "is valid for one hour", and Notion says don't cache
  it ([file object](https://developers.notion.com/reference/file-object)).
- The help centre says 24 hours instead, a conflict Notion doesn't explain
  ([help](https://www.notion.com/help/cant-upload-or-view-a-file)).
- A file upload can't be deleted or revoked through the API, and it outlives
  the content it was attached to
  ([uploading small files](https://developers.notion.com/guides/data-apis/uploading-small-files)).

**Markdown.**
- API Markdown writes `![Caption](URL)`, and files and video as tags
  ([enhanced Markdown](https://developers.notion.com/guides/data-apis/enhanced-markdown)).
- The URLs it emits are pre-signed and expire.

**Sizing, captions, lightbox, alt.**
- Drag guides resize, with left, centre or right alignment.
- The caption and the alt text are separate fields, and full screen opens
  with space.
- Source: [images, files and media](https://www.notion.com/help/images-files-and-media).

**Other media.**
- Over 1,900 domains embed through Iframely
  ([embeds](https://www.notion.com/help/embed-and-connect-other-apps)).
- Link previews show live views of GitHub, Figma, Linear and others to anyone
  who can view the page ([link previews](https://www.notion.com/help/link-previews)).
- **Mermaid** code blocks have a Preview or Split view
  ([2021-12-23](https://www.notion.com/releases/2021-12-23)).

**History.**
- Page history runs 7, 30 or 90 days by plan
  ([restore](https://www.notion.com/help/duplicate-delete-and-restore-content)).
- Whether old versions keep showing a removed image is UNVERIFIED.

## Google Docs

**Inserting.**
- Insert › Image offers upload, Drive, a URL and the camera. Drag and drop
  and paste also work ([help](https://support.google.com/docs/answer/97447?hl=en)).
- The API limits an image to 50 MB, 25 megapixels, and PNG, JPEG or GIF
  ([InsertInlineImageRequest](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request#insertinlineimagerequest)).
  Whether the editor has the same limits is UNVERIFIED.

**Storage and who sees an image.**
- "The image is fetched once at insertion time and a copy is stored", so the
  doc holds its own copy.
- An image's `contentUri` has "a default lifetime of 30 minutes" and is
  "tagged with the account of the requester"
  ([documents](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents)).

**Markdown.**
- Import and export as Markdown arrived in July 2024
  ([Workspace updates](https://workspaceupdates.googleblog.com/2024/07/import-and-export-markdown-in-google-docs.html)).
- A community gist shows the export writes images as reference-style base64
  data URIs at the end of the file
  ([gist](https://gist.github.com/thrasher/f07fb66db0dfdb77b93a94d02085274a)).
  UNVERIFIED officially.

**Sizing, captions, lightbox, alt.**
- Size, rotation, wrap modes and crop are available. Alt text is combined
  from `title` and `description`.
- Native captions and a lightbox are UNVERIFIED.

**Other media.**
- File smart chips, and third-party chips for Figma, Loom and Miro since 2023
  ([chips](https://developers.googleblog.com/2023/12/create-smart-chips-for-link-previewing-in-google-docs.html)).
- No native Mermaid.

## Coda (Superhuman Docs since July 2026)

**Inserting.**
- `/image` and drag and drop.
- Attachments accept many types, at 10 MB per file on free plans and 250 MB
  on paid ([attach files](https://help.superhuman.com/hc/en-us/articles/46210126829453-Attach-files-in-docs-and-tables)).

**Storage.**
- Files sit in an encrypted S3 bucket and are virus-scanned on upload.
- The API's `browserLink` is a `codahosted.io` address.
- Whether URLs are signed is UNVERIFIED.

**Markdown.**
- Markdown imports. The API exports Markdown, and a community report says
  "Coda exports markdown without images"
  ([issue](https://github.com/coderpush/coda-mover/issues/27)).

**Sizing, captions, lightbox, alt.**
- Drag bars, crop, caption, full screen, and alt text from full screen, for
  uploaded images only
  ([images](https://help.superhuman.com/hc/en-us/articles/46210089399821-Add-images-to-docs-and-tables)).

**Other media.**
- oEmbed embeds with an iframe fallback.
- Attachments draw inline, as a title, or as a card.
- Mermaid only through a community Pack ([pack](https://coda.io/packs/mermaid-10537)).

**History.** "You can always go back to version history to find any deleted
images" (images article).

## Craft

**Inserting.**
- The `/` menu, Insert, and drag and drop.
- PNG, JPEG, GIF, WebP, AVIF and HEIC. An SVG shows as an attachment block
  ([media](https://support.craft.do/en/write-and-edit/media)).

**Storage.**
- Files sit on AWS, encrypted
  ([data storage](https://support.craft.do/en/account-and-subscription/data-and-security/data-storage)).
- A third-party blog says image URLs are public and expire within days.
  UNVERIFIED.

**Markdown.**
- Plain `.md` export keeps structure. TextBundle carries the images
  ([export](https://support.craft.do/en/import-and-export/export/document)).

**Sizing, captions, lightbox, alt.**
- Size is Auto or Large, and similar images group side by side.
- Double-click opens a gallery.
- A caption is a text style, not a field.

**Other media.**
- **Native Mermaid**: `/mermaid`, or paste a fence. It exports back as a
  fence ([Mermaid](https://support.craft.do/en/write-and-edit/mermaid-diagrams)).
- No video embeds from external platforms.

## Coding agents' plans

**Cursor.**
- Plan Mode writes an editable Markdown plan, saved as a file
  ([blog](https://cursor.com/blog/plan-mode),
  [planning](https://cursor.com/docs/agent/planning)).
- 2.2 added "inline Mermaid diagrams" in plans
  ([changelog](https://cursor.com/changelog/2-2)).
- Images can be pasted or dropped into the chat
  ([prompting](https://cursor.com/docs/agent/prompting)).
- Cloud agents attach "videos, screenshots, and logs to the pull request"
  ([background agents](https://cursor.com/help/ai-features/background-agents)).
- Raster images inside a plan are UNVERIFIED.

**Devin.**
- The plan is a session message.
- Devin "can capture screenshots and videos of the browser and submit them
  back to you", and test recordings are attached to session messages
  ([recordings](https://docs.devin.ai/work-with-devin/testing-and-recordings)).
- DeepWiki draws Mermaid with pan and zoom
  ([release notes](https://docs.devin.ai/release-notes/2025)).

**Claude Code.**
- Plan files live in `~/.claude/plans/` or `plansDirectory`
  ([permission modes](https://code.claude.com/docs/en/permission-modes)).
- Images go in by drag, paste or path
  ([common workflows](https://code.claude.com/docs/en/common-workflows)).
- The API takes JPEG, PNG, GIF and WebP up to 8,000 px and 10 MB
  ([vision](https://platform.claude.com/docs/en/build-with-claude/vision)).
- Images or Mermaid in plans are UNVERIFIED.

**OpenAI Codex.**
- The plan is a `<proposed_plan>` block of Markdown in the reply
  ([template](https://github.com/openai/codex/blob/main/codex-rs/collaboration-mode-templates/templates/plan.md)).
- Images go in by paste or `-i`
  ([image inputs](https://learn.chatgpt.com/docs/image-inputs)).
- Cloud tasks show UI screenshots for review
  ([changelog](https://learn.chatgpt.com/docs/changelog)).

**Across the four.**
- Plans are Markdown everywhere.
- Mermaid is the only documented visual inside a plan (Cursor).
- Images are input, and screenshots are proof attached to the session or the
  PR.

## Markdown standards and TipTap

- **CommonMark 0.31.2**: `![alt](url "title")`. Alt is "the plain string
  content of the image description". There is no width, figure or caption
  ([spec](https://spec.commonmark.org/0.31.2/#images)).
- **GFM**: adds nothing to images. Raw `<img>` passes; the tagfilter escapes
  `<iframe>` and its kin ([GFM](https://github.github.com/gfm/)).
- **Captions.** No spec uses the title as a caption.
  - Pandoc's implicit figures caption with the **alt** text
    ([manual](https://pandoc.org/MANUAL.html#extension-implicit_figures)).
  - `markdown-it-implicit-figures` can caption with the title
    (`figcaption: 'title'`,
    [repo](https://github.com/arve0/markdown-it-implicit-figures)).
- **Width syntaxes** are all dialects:
  - Pandoc `{width=50%}` ([link attributes](https://pandoc.org/MANUAL.html#extension-link_attributes));
  - kramdown `{:height="36px"}` ([syntax](https://kramdown.gettalong.org/syntax.html#images));
  - Obsidian `![alt|100](url)` ([syntax](https://obsidian.md/help/syntax));
  - MkDocs `{ width="300" }` ([images](https://squidfunk.github.io/mkdocs-material/reference/images/)).
- **TipTap Image** ([docs](https://tiptap.dev/docs/editor/extensions/nodes/image);
  [source](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/extension-image/src/image.ts)):
  - `inline` defaults to false, `allowBase64` to false, and `resize` to off
    (added in 3.10).
  - Its attributes are `src`, `alt`, `title`, `width` and `height`.
  - `FileHandler` gives `onPaste` and `onDrop` hooks but uploads nothing
    ([FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)).
- **`@tiptap/markdown`** ([docs](https://tiptap.dev/docs/editor/markdown)):
  - It writes `![alt](src "title")` and **drops `width` and `height`**.
  - It **escapes nothing**, so a `]` in the alt text, a `"` in the title or a
    `)` in the address writes broken Markdown. prosemirror-markdown escapes
    all three ([to_markdown.ts](https://github.com/ProseMirror/prosemirror-markdown/blob/master/src/to_markdown.ts)).
  - The fix is a custom `renderMarkdown`
    ([custom serializing](https://tiptap.dev/docs/editor/markdown/advanced-usage/custom-serializing)).
- **TipTap's Paragraph** (`@tiptap/extension-paragraph` 3.31.4, read in
  `node_modules`) returns a paragraph whose only token is an image as the
  image itself, a block. With `Image.configure({ inline: true })`, as Luke's
  plan editor has it, that is an invalid document. This was verified in the
  show's harness on main: `Called contentMatchAt on a node with invalid
  content`.

## Summary

| | Paste, drop | Stored | Gated | Markdown | Resize | Caption | Alt | Lightbox | Mermaid |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GitHub | Yes | Own, S3 | Login (private), 5-min JWT | `<img width>` | HTML width | No | "Image" | New tab | Yes |
| Linear | Drop, `/file` | `uploads.linear.app` | Auth or signed | `![alt](url)` | Handles | UNVERIFIED | UNVERIFIED | Yes | Yes |
| Notion | Yes | Own | Signed, 1 h | `![Caption](url)` | Handles | Yes | Yes | Full screen | Yes |
| Google Docs | Yes | Copy in doc | 30-min, per account | Base64 (community) | Handles | UNVERIFIED | Yes | UNVERIFIED | No |
| Coda | Drop, `/image` | S3 | UNVERIFIED | No images | Drag bars | Yes | Yes | Full screen | Pack |
| Craft | Drop, `/` | AWS | UNVERIFIED | TextBundle | Auto, Large | Style only | UNVERIFIED | Gallery | Yes |
| Cursor plans | n/a | Files | n/a | Markdown | n/a | n/a | n/a | n/a | Yes |

## Patterns worth copying

1. **Upload at once, write an address.** Every product stores the bytes apart
   and puts a reference in the text.
2. **Gate the address by the document's own access.** GitHub (since 2023),
   Linear, Notion and Google Docs never leave private pictures on a bare
   public URL.
3. **Keep the Markdown plain.** Alt text and title survive every reader.
   Width and captions are dialects, so a tool that needs them keeps them
   apart.
4. **Make alt text a field and give it a default worth replacing.** GitHub's
   "Image" shows the cost of a default nobody changes.
5. **Reuse one viewer** for every picture, as Craft's gallery and Linear's
   lightbox do.
6. **Never fetch outside images on the reader's behalf.** GitHub's Camo
   exists so the image's host never learns who read the page.
7. **Draw Mermaid from a fence and keep the fence as the source.** GitHub,
   Linear, Notion, Craft and Cursor all do, and every one exports the code.
8. **Screenshots are agents' proof.** Cursor, Devin and Codex attach them to
   the run or the PR, which is where a plan's verification section would
   carry one.

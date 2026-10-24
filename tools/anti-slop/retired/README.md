# Retired classes, glyphs and patterns

`anti-slop/retired` reads every `*.json` file here. Each file is one kind's
guard: what that kind's last PR deleted, kept from coming back. A kind adds its
own file, named for the kind (`toolbar.json`), and never edits another kind's,
so guard PRs that land together never touch the same file.

```json
{
  "instead": "Draw the bar with Toolbar from @luke/ui.",
  "classes": [{ "class": "desktop-toolbar*", "allow": ["packages/ui/src/components/toolbar/"] }],
  "glyphs": [{ "glyph": "ArrowLeft", "allow": ["packages/ui/src/components/back-button/"] }],
  "patterns": [
    { "prop": "contextMenu", "allow": [] },
    { "import": "cmdk", "names": ["Command"], "allow": ["packages/ui/src/components/command/"] }
  ]
}
```

- `instead` is what the error tells someone to use.
- A **class** is refused in any string that reads as a class list, in a
  `className` or kept in a constant (the oxlint rule), and in a stylesheet's
  selectors (the style guard, `style-guard.ts`). A trailing `*` matches every
  class it starts.
- A **glyph** is a name imported from `@luke/ui/icons`, Lucide's aliases alike
  (`ArrowLeft`, `ArrowLeftIcon`, `LucideArrowLeft`), or a concept read off the
  registry (`GLYPH.BACK`).
- A **pattern** is a JSX prop by name, or an import of a module or its
  subpaths; `names` narrows an import to the imported names listed.
- `allow` lists path prefixes from the repository's root where the entry still
  stands: the one component that owns it.
- `baseline` (optional, per entry) maps a file to how many places it may still
  hold. It may only shrink: a file holding more fails, and so does one holding
  fewer until its count is lowered or its row deleted at 0.

A file the schema refuses (a missing or unknown field, a count below 1) fails
the lint run, naming the file. No disable comment silences the rule:
`press-guard-check.ts` refuses one, and an `.oxlintrc.json` that weakens it.
`example.json` retires nothing real; leave it as the format's sample.

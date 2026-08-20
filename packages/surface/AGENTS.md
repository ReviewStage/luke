## Shared surface vocabulary

`design/generate-surface-shared.mjs` is the only place the motion tokens, the
layout sizes the window and the drawing share, the provider-mark path data,
and the session urgency value set, labels, and order are described. It writes
four committed outputs into `packages/sidecar-core/src/`: `motion-tokens.css`,
`motion-tokens.ts`, `provider-mark-paths.ts`, and `session-display.ts`. None of
the four may be hand-edited — change the tables in the script, re-run it, and
commit what it writes. `repository-checks.sh` runs it with `--check`.

The desktop renderer and the marketing mock both consume those outputs. The
React that traces a mark stays in each app, because the desktop ships marks
the mock does not, and a shared component would pull that into the web bundle.

## `provider-marks.tsx` is duplicated on purpose

The desktop's copy and the web's differ by more than two hundred lines,
because the desktop draws marks the marketing mock does not. A shared
component would pull every one of them into the web bundle, so the React that
traces a mark stays in each app and only the path data is shared from here.
Do not "fix" it without reversing that decision deliberately.

`react-css.ts` is the opposite case and shows where the line is: it is six
lines, byte-identical in both apps, and type-only. It lives behind its own
`./react-css` door rather than the barrel, so a package that reads the surface
vocabulary does not need React's types to typecheck.

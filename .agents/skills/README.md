# Vendored agent skills

The skills in this directory are checked in, not fetched at run time. The file
is byte-identical to its upstream source at the commit pinned below, and
`skills-lock.json` at the repository root records the same install with the
content hash the installer computed.

| Skill | Upstream | Pinned commit |
| --- | --- | --- |
| `effect-ts` | [`Effect-TS/skills`](https://github.com/Effect-TS/skills) `skills/effect-ts/SKILL.md` | `2309e6f27d9955b434c0e3f394b945c136e89fd2` |

This is the directory the repository's tooling already leaves alone: Biome's
`files.includes` and `.oxlintrc.json`'s `ignorePatterns` both exclude
`.agents`, so a skill's Markdown is guidance for an agent rather than a file
the formatter owns.

An agent that reads skills from its own directory (Claude Code's
`.claude/skills`, and the others the installer knows) reaches them through
symlinks into this directory. Those directories are local agent state and are
not committed, so a fresh clone restores them from the lock file:

```sh
npx skills experimental_install
```

Nothing in the repository depends on that command having been run. The skills
are read by agents, never by the build, and no workspace declares the installer
as a dependency.

## What matches this repository's version line and what does not

This repository is on Effect 3.x — `effect` at `3.22.2` in the pnpm catalog,
`@effect/platform` at `0.97.2`, `@effect/sql` at `0.52.1`, `@effect/rpc` at
`0.76.2` — and `docs/adr/0001-effect.md` records why, along with the trigger
that re-evaluates Effect 4. The vendored set follows that line, so two things
are true of it and both are deliberate.

Upstream's `effect-v3-to-v4` skill is a migration workflow toward Effect 4 and
is **not** vendored. It would be a workflow for a version this repository has
decided against, and the ADR's re-evaluation is where it becomes relevant; it is
installed then, not kept here unreferenced in the meantime.

`effect-ts`, the one skill vendored, is upstream's general skill, and its two
instructions are written against the 4.x line rather than this one. Read the
skill for the discipline it states — answer an Effect API from the installed
Effect's own source rather than from memory — and not for these two steps:

- Its install step (`pnpm add effect@rc`) would move this repository off the
  pinned line. `effect` is added to a workspace as `"effect": "catalog:"` and
  the version lives in `pnpm-workspace.yaml` alone; `repository-checks.sh`
  refuses a literal version in a workspace manifest.
- The guide it names, `node_modules/effect/AGENTS.md`, ships only on the 4.x
  line. `effect@3.22.2` publishes no such file, so there is no repository-local
  Effect guide to read completely. What 3.22.2 does publish is its full
  `src/`, which is the escalation the skill's own last line names and the one
  that works here.

The standing guidance for writing Effect in this repository is therefore the
root `AGENTS.md`'s "Effect idioms" section and the ADR, with
`node_modules/effect/src` for an API neither covers.

## Updating one

A skill is updated by installing the newer commit and recording it here, so the
three records — the file, the lock's hash, and the table above — move together.
An edit to a vendored `SKILL.md` is not an update: it makes the file no longer
the upstream text the hash names. The whole set is revisited when the ADR's
Effect 4 trigger fires, since that is when upstream's own skills stop being
split across the boundary this section describes.

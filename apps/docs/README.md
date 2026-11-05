# Vespin docs

The source of [docs.vespin.dev](https://docs.vespin.dev), built by
[Mintlify](https://mintlify.com) from `docs.json` and the `.mdx` pages
beside it. Mintlify deploys `main` on every push that changes this folder.

Preview locally with Mintlify's CLI:

```sh
cd apps/docs
npx mint dev
```

The logos and favicon are copies of `packages/brand`'s artwork; its
`README.md` lists the commands that refresh them.

Each page opens by defining what it is about, names controls exactly as
the app spells them, and states only what a reader needs in order to act
(`docs/DESIGN.md`, "Copy: delete what describes, keep what instructs").
Screenshots go in `images/` and are taken the way the changelog's are
(`.agents/skills/changelog-screenshots`).

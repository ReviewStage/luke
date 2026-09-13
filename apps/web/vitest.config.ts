import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    // The whole suite stands up a database, and a PGlite test exceeds vitest's
    // 5 s default on a loaded machine; node:test, which ran it before, had no
    // default at all. Suite-wide so the next database test meets the same bar.
    testTimeout: 30_000,
    // A layer hook opens its own PGlite and runs every migration before the
    // file's first test, so it does the same work as a database test and is
    // held to the same bar; vitest's 10 s hook default is marginal under the
    // full suite's contention.
    hookTimeout: 30_000,
    // This workspace is the one that pins `@types/node` to the `web` catalog's
    // 22.x, matching Vercel's own runtime, and `@types/node` is a peer of
    // `vitest`, so pnpm stands a second `vitest` copy up for it. `@effect/vitest`
    // v4 reads the collector's current suite out of the `vitest` it resolves
    // itself, and, externalised, that is this workspace's copy rather than the
    // one the runner is collecting into: `it.effect` fails to find the current
    // suite and `it.layer` reads `config` off nothing. Inlining routes its
    // `vitest` import through Vite, which the runner aliases to its own copy,
    // so one collector holds every suite in this project.
    server: { deps: { inline: ["@effect/vitest"] } },
  },
});

/**
 * sandbox-oci-image.ts -- the coding agent's image as an OCI image, for a sandbox outside Vercel: the template's own recorded preparation, replayed by a Dockerfile.
 *
 * A host or a Mac runs each agent in a microVM booted from an OCI image
 * (smolvm), and its agents must find the tools a Vercel sandbox gives them.
 * So the image is built from the very preparation Luke's Vercel template is
 * (`native-sandbox-template.ts`'s `recordImageBuild`, which records
 * `prepareImage`): the same files and the same `build.sh`, replayed on eve's
 * own public image of the same release, which eve builds its Docker and
 * microsandbox runtimes on. It is the image Vercel's base is made from, but
 * Vercel's registry asks for an account and this one does not, and it is
 * built for arm64 as well as x86-64.
 *
 * The replay runs as the default user holding the whole capability set, as
 * a Vercel Sandbox runs every command (`sandbox-capabilities.ts`): the
 * preparation's last check empties the bounding set, which takes a
 * capability. BuildKit grants a step that set only where the step asks for
 * `--security=insecure` and the build allows it; `setpriv` then hands it on
 * to the default user as ambient capabilities, which survive its exec.
 *
 * The image's tag is a digest of the recording and the Dockerfile, so it
 * moves whenever the script, a pin in it, eve's tooling, or either base
 * does, as the template's key does. CI publishes each tag once
 * (`scripts/sandbox-image.sh`) and never writes over it.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Effect } from "effect";
import { BUILD_DIRECTORY, recordImageBuild } from "./native-sandbox-template.js";

export const SANDBOX_OCI_IMAGE = {
  /** Where CI publishes the image, each tag a key. */
  REPOSITORY: "ghcr.io/reviewstage/luke-sandbox",
  /**
   * eve's public image of the release `EVE_BASE_IMAGE` names, pinned to the
   * index digest it was read with, so a tag pushed again builds nothing new;
   * `anti-slop`'s agent-pins guard holds its tag to the installed eve.
   */
  BASE: "ghcr.io/vercel/eve:0.74.0@sha256:13059d8c160f72f71f582795b47b9bcdc10a6da0ab01f2aa696c7dc24c2d3a47",
  /** The repository the published package is linked to, which GitHub reads off the image's label. */
  SOURCE: "https://github.com/ReviewStage/luke",
} as const;

/**
 * The Dockerfile frontend that takes `RUN --security`, which only the labs
 * channel does, pinned like every action CI runs.
 */
const FRONTEND =
  "docker/dockerfile:1-labs@sha256:ad43eec41369d9ef94412c0d1eb3203d12218d01da225afc92a3aeba3a0e7796";

/** The base's default user, the one a Vercel Sandbox runs the preparation as. */
const DEFAULT_USER = "vercel-sandbox";

/**
 * Replays the recording from the build context, mounted where the template
 * uploads it, so nothing of it is left in a layer. Note that the step runs as
 * root only to hand the default user its capabilities, and that `HOME` is
 * that user's, as it is in a sandbox, where npm and Playwright write.
 */
const DOCKERFILE = [
  `# syntax=${FRONTEND}`,
  `FROM ${SANDBOX_OCI_IMAGE.BASE}`,
  `LABEL org.opencontainers.image.source=${SANDBOX_OCI_IMAGE.SOURCE}`,
  "USER root",
  `RUN --security=insecure --mount=type=bind,target=${BUILD_DIRECTORY} \\`,
  `    setpriv --reuid=${DEFAULT_USER} --regid=${DEFAULT_USER} --init-groups --inh-caps=+all --ambient-caps=+all -- \\`,
  `    env HOME=/home/${DEFAULT_USER} bash ${BUILD_DIRECTORY}/build.sh`,
  `USER ${DEFAULT_USER}`,
  "",
].join("\n");

/** The image's build: its key, the reference it is published under, and the build context's files, by their paths in it. */
interface OciImageBuild {
  readonly key: string;
  readonly reference: string;
  readonly files: readonly { readonly path: string; readonly contents: Uint8Array }[];
}

/** The template's preparation recorded, and the context that builds it into the OCI image. */
export const recordOciImageBuild = Effect.fn("web/recordOciImageBuild")(function* () {
  const build = yield* recordImageBuild();
  const key = createHash("sha256")
    .update(build.key)
    .update("\0")
    .update(DOCKERFILE)
    .digest("hex")
    .slice(0, 16);
  // Every recorded file lies directly in the template's build directory, where the context is mounted.
  const files = [
    ...build.files.map((file) => ({
      path: posix.relative(BUILD_DIRECTORY, file.path),
      contents: file.contents,
    })),
    { path: "Dockerfile", contents: Buffer.from(DOCKERFILE, "utf8") },
  ];
  return {
    key,
    reference: `${SANDBOX_OCI_IMAGE.REPOSITORY}:${key}`,
    files,
  } satisfies OciImageBuild;
});

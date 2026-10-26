/**
 * sandbox-oci-image.ts -- the coding agent's image as an OCI image, for a sandbox outside Vercel: the template's own recorded preparation, replayed by a Dockerfile a layer per step.
 *
 * A host or a Mac runs each agent in a microVM booted from an OCI image
 * (smolvm), and its agents must find the tools a Vercel sandbox gives them.
 * So the image is built from the very preparation Luke's Vercel template is
 * (`native-sandbox-template.ts`'s `recordImageBuild`, which records
 * `prepareImage`): the same files and the same steps, replayed on eve's own
 * public image of the same release, which eve builds its Docker and
 * microsandbox runtimes on. It is the image Vercel's base is made from, but
 * Vercel's registry asks for an account and this one does not, and it is
 * built for arm64 as well as x86-64.
 *
 * Each recorded step is a `RUN` of its own, and so a layer of its own, in
 * the order `prepareImage` takes its stages, from what changes rarely to
 * what changes often (`PREPARE_STAGES`). A step's `RUN` mounts only that
 * step's own files, so BuildKit's cache of it holds until the step itself
 * changes, and a box that pulls the image again after a pin moved pulls the
 * layers from that pin's step on. That holds only where CI builds with the
 * cache of the build before (`scripts/sandbox-image.sh`), since a step run
 * afresh writes a layer that differs in its bytes.
 *
 * The replay runs as the default user holding the whole capability set, as
 * a Vercel Sandbox runs every command (`sandbox-capabilities.ts`): the
 * preparation's last check empties the bounding set, which takes a
 * capability. BuildKit grants a step that set only where the step asks for
 * `--security=insecure` and the build allows it; `setpriv` then hands it on
 * to the default user as ambient capabilities, which survive its exec.
 *
 * The image's tag is a digest of the recording and the build context, so it
 * moves whenever the script, a pin in it, eve's tooling, or either base
 * does, as the template's key does. CI publishes each tag once and never
 * writes over it.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Effect } from "effect";
import {
  BASE_SETUP,
  BUILD_DIRECTORY,
  type ImageBuild,
  type RecordedStep,
  recordImageBuild,
  replayWrite,
} from "./native-sandbox-template.js";

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

/** The script in each layer's folder that runs its step. */
const LAYER_SCRIPT = "run.sh";

/** A file of the build context, by its path in it. */
interface ContextFile {
  readonly path: string;
  readonly contents: Uint8Array;
}

/** The image's build: its key, the reference it is published under, and the build context's files. */
interface OciImageBuild {
  readonly key: string;
  readonly reference: string;
  readonly files: readonly ContextFile[];
}

/** The folder of the context a step's files lie in, mounted where the template uploads them. */
function layerFolder(index: number): string {
  return `layer-${index}`;
}

/**
 * The files one step's layer reads: the script that puts its writes in
 * place and runs it, the writes, and the step itself. The first also does
 * what the template's entry does before any step.
 */
function layerFiles(build: ImageBuild, step: RecordedStep, index: number): ContextFile[] {
  const contents = new Map(build.files.map((file) => [file.path, file.contents]));
  const script = [
    "set -e",
    ...(index === 0 ? [BASE_SETUP] : []),
    ...step.writes.map((write) => replayWrite(write.file, write.destination)),
    `bash ${step.script}`,
  ].join("\n");
  const read = [...step.writes.map((write) => write.file), step.script];
  return [
    { path: `${layerFolder(index)}/${LAYER_SCRIPT}`, contents: Buffer.from(script, "utf8") },
    ...read.map((path) => ({
      path: `${layerFolder(index)}/${posix.relative(BUILD_DIRECTORY, path)}`,
      contents: contents.get(path) ?? new Uint8Array(),
    })),
  ];
}

/**
 * One step's `RUN`. Note that it runs as root only to hand the default user
 * its capabilities, and that `HOME` is that user's, as it is in a sandbox,
 * where npm and Playwright write.
 */
function layerRun(index: number): string {
  return [
    `RUN --security=insecure --mount=type=bind,source=${layerFolder(index)},target=${BUILD_DIRECTORY} \\`,
    `    setpriv --reuid=${DEFAULT_USER} --regid=${DEFAULT_USER} --init-groups --inh-caps=+all --ambient-caps=+all -- \\`,
    `    env HOME=/home/${DEFAULT_USER} bash ${BUILD_DIRECTORY}/${LAYER_SCRIPT}`,
  ].join("\n");
}

/** The template's preparation recorded, and the context that builds it into the OCI image. */
export const recordOciImageBuild = Effect.fn("web/recordOciImageBuild")(function* () {
  const build = yield* recordImageBuild();
  const dockerfile = [
    `# syntax=${FRONTEND}`,
    `FROM ${SANDBOX_OCI_IMAGE.BASE}`,
    `LABEL org.opencontainers.image.source=${SANDBOX_OCI_IMAGE.SOURCE}`,
    "USER root",
    ...build.steps.map((_, index) => layerRun(index)),
    `USER ${DEFAULT_USER}`,
    "",
  ].join("\n");
  const files: ContextFile[] = [
    ...build.steps.flatMap((step, index) => layerFiles(build, step, index)),
    { path: "Dockerfile", contents: Buffer.from(dockerfile, "utf8") },
  ];
  const digest = createHash("sha256").update(build.key).update("\0");
  for (const file of files)
    digest.update(file.path).update("\0").update(file.contents).update("\0");
  const key = digest.digest("hex").slice(0, 16);
  return {
    key,
    reference: `${SANDBOX_OCI_IMAGE.REPOSITORY}:${key}`,
    files,
  } satisfies OciImageBuild;
});

/**
 * agent-sandbox-image.ts -- the snapshot a native harness's sandbox opens from: the coding agent's image, prepared in Luke's own template.
 *
 * eve prepares the coding agent's image (`agent-runtime/sandbox-image.ts`'s
 * `prepareImage`) into a snapshot of its own and hands no code of Luke's its
 * id. A sandbox Luke opens itself for Claude Code or Codex opens from the
 * snapshot this seam answers: Luke's own template of the same image
 * (`native-sandbox-template.ts`), keyed by the preparation's digest, so a
 * launch always opens on the image as it stands now.
 *
 * The first launch after the image changed finds its template being built,
 * which takes minutes. The seam waits on it a bounded while, then fails with
 * `ImagePreparing`, which a launch answers with `IMAGE_PREPARING_STATUS` for
 * its caller to show as the agent's status and to retry; the build goes on
 * meanwhile, moved on by the next launch or the scheduled sweep. A launch
 * that runs past its request's answer waits on the build's own end
 * (`prepared`) before it asks again. A launch
 * whose create finds the snapshot gone hands it back (`snapshotGone`), and
 * answers `ImagePreparing` too.
 */

import { Context, Data, type Duration, Effect, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import {
  awaitTemplate,
  forgetSnapshot,
  NATIVE_TEMPLATE,
  recordImageBuild,
  TEMPLATE_STATE,
} from "./native-sandbox-template.js";
import {
  deploymentOidcToken,
  type OidcTokenRead,
  type SandboxUnavailable,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

/** The status a launch fails with while the image it opens from is still being prepared: HTTP's Too Early, for its caller to retry. */
export const IMAGE_PREPARING_STATUS = 425;

/** The image is still being prepared, past the while a launch waits on it. */
export class ImagePreparing extends Data.TaggedError("ImagePreparing") {}

export interface AgentSandboxImageService {
  /**
   * The snapshot to open from, waiting a bounded while on a template being
   * built; none where its preparation failed, which opens no sandbox.
   */
  readonly snapshotId: Effect.Effect<Option.Option<string>, ImagePreparing | SandboxUnavailable>;
  /**
   * The snapshot `snapshotId` answered, which a create found gone: the image
   * prepared again, so the next launch waits on it rather than failing on the
   * same snapshot.
   */
  readonly snapshotGone: (snapshotId: string) => Effect.Effect<void, SandboxUnavailable>;
  /**
   * Waits on a template being built until its build ends, for at most
   * `NATIVE_TEMPLATE.WAIT` whatever `snapshotId` waits, and answers whether
   * the image is no longer being prepared, so a launch past its request's
   * answer that found it preparing asks again the moment it is worth asking.
   */
  readonly prepared: Effect.Effect<boolean, SandboxUnavailable>;
}

export class AgentSandboxImage extends Context.Service<
  AgentSandboxImage,
  AgentSandboxImageService
>()("AgentSandboxImage") {}

/**
 * The seam over Luke's own template, asked of Vercel under the token the
 * reader hands, waiting on a build for at most `wait`: a request whose
 * client cannot hold a build's minutes names less, down to none, and its
 * caller asks again instead.
 */
export const agentSandboxImageFromTemplate = (
  readToken: OidcTokenRead = deploymentOidcToken,
  wait: Duration.Duration = NATIVE_TEMPLATE.WAIT,
): Layer.Layer<AgentSandboxImage, never, HttpClient.HttpClient> =>
  Layer.effect(
    AgentSandboxImage,
    Effect.gen(function* () {
      const api = yield* vercelSandboxApi(readToken);
      const build = yield* Effect.cached(Effect.orDie(recordImageBuild()));
      return {
        snapshotId: Effect.gen(function* () {
          const template = yield* awaitTemplate(api, yield* build, wait);
          if (template.state === TEMPLATE_STATE.PREPARING) return yield* new ImagePreparing();
          return template.state === TEMPLATE_STATE.READY
            ? Option.some(template.snapshotId)
            : Option.none();
        }),
        snapshotGone: (snapshotId) =>
          Effect.asVoid(Effect.flatMap(build, (built) => forgetSnapshot(api, built, snapshotId))),
        prepared: Effect.map(
          Effect.flatMap(build, (built) => awaitTemplate(api, built, NATIVE_TEMPLATE.WAIT)),
          (template) => template.state !== TEMPLATE_STATE.PREPARING,
        ),
      };
    }),
  );

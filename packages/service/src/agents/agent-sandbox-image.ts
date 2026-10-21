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
 * meanwhile, moved on by the next launch or the scheduled sweep.
 */

import { Context, Data, type Duration, Effect, Layer, Option } from "effect";
import type { HttpClient } from "effect/http";
import {
  awaitTemplate,
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
      };
    }),
  );

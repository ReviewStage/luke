/**
 * agent-sandbox-image.ts -- the snapshot a native harness's sandbox opens from: the coding agent's image, prepared.
 *
 * eve prepares the coding agent's image (`agent-runtime/sandbox.ts`'s
 * `PREPARE_SCRIPT`) into a snapshot of its own at build time and opens each
 * of its sessions' sandboxes from it, but hands no code of Luke's the
 * snapshot's id: it is read only inside eve's runtime, and an eve app serves
 * no route of its own to tell it. A sandbox Luke opens itself for Claude Code
 * or Codex opens from the snapshot this seam answers.
 *
 * TODO(native agents): the deployment's `LUKE_AGENT_SANDBOX_SNAPSHOT`, set
 * by hand, goes stale each time `PREPARE_SCRIPT` changes the image. Replace
 * it before P11's workflow runs on Preview with Luke's own template, prepared
 * from the same script and keyed by its `LUKE_SANDBOX_IMAGE` digest, behind
 * this same seam.
 */

import { Context, Effect, Layer, Option } from "effect";
import { HostedEnvironment } from "../environment.js";

export interface AgentSandboxImageService {
  /** The snapshot to open from; none where the deployment names none, which opens no sandbox. */
  readonly snapshotId: Effect.Effect<Option.Option<string>>;
}

export class AgentSandboxImage extends Context.Service<
  AgentSandboxImage,
  AgentSandboxImageService
>()("AgentSandboxImage") {}

/** The seam as the deployment fills it today: the snapshot its environment names. */
export const agentSandboxImageFromEnvironment: Layer.Layer<
  AgentSandboxImage,
  never,
  HostedEnvironment
> = Layer.effect(
  AgentSandboxImage,
  Effect.map(HostedEnvironment, (environment) => ({
    snapshotId: Effect.succeed(Option.fromNullishOr(environment.agentSandboxSnapshot)),
  })),
);

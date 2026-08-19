import { Effect } from "effect";
import type {
  ProviderControlRequest,
  ProviderControlResult,
  ProviderMessageResult,
  ProviderSessionMessage,
  ProviderWorkspaceAgentRequest,
  ProviderWorkspaceRequest,
  ProviderWorkspaceResult,
  SessionProviderAdapter,
  WorkspaceProject,
} from "../providers.js";
import type { ProviderSessionObservation, SessionProvider } from "../session.js";
import { runPromiseOrDie } from "./runtime-bridge.js";

export interface EffectSessionProviderAdapter {
  readonly provider: SessionProvider;
  observe(): Effect.Effect<readonly ProviderSessionObservation[], never, never>;
  executeControl(
    request: ProviderControlRequest,
  ): Effect.Effect<ProviderControlResult, never, never>;
  sendMessage(message: ProviderSessionMessage): Effect.Effect<ProviderMessageResult, never, never>;
  workspaceProjects(): readonly WorkspaceProject[];
  createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never>;
  spawnWorkspaceAgent(
    request: ProviderWorkspaceAgentRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, never>;
  readTranscript(providerSessionId: string): Effect.Effect<string | undefined, never, never>;
}

function wrapPromise<A>(promise: () => Promise<A>): Effect.Effect<A, never, never> {
  return Effect.async((resume) => {
    void promise().then(
      (value) => resume(Effect.succeed(value)),
      (error) => resume(Effect.die(error)),
    );
  });
}

export function fromPromiseAdapter(adapter: SessionProviderAdapter): EffectSessionProviderAdapter {
  return {
    provider: adapter.provider,
    observe: () => wrapPromise(() => adapter.observe()),
    executeControl: (request) => wrapPromise(() => adapter.executeControl(request)),
    sendMessage: (message) => wrapPromise(() => adapter.sendMessage(message)),
    workspaceProjects: () => adapter.workspaceProjects(),
    createWorkspace: (request) => wrapPromise(() => adapter.createWorkspace(request)),
    spawnWorkspaceAgent: (request) => wrapPromise(() => adapter.spawnWorkspaceAgent(request)),
    readTranscript: (providerSessionId) =>
      wrapPromise(() => adapter.readTranscript(providerSessionId)),
  };
}

export function toPromiseAdapter(adapter: EffectSessionProviderAdapter): SessionProviderAdapter {
  return {
    provider: adapter.provider,
    observe: () => runPromiseOrDie(adapter.observe()),
    executeControl: (request) => runPromiseOrDie(adapter.executeControl(request)),
    sendMessage: (message) => runPromiseOrDie(adapter.sendMessage(message)),
    workspaceProjects: () => adapter.workspaceProjects(),
    createWorkspace: (request) => runPromiseOrDie(adapter.createWorkspace(request)),
    spawnWorkspaceAgent: (request) => runPromiseOrDie(adapter.spawnWorkspaceAgent(request)),
    readTranscript: (providerSessionId) =>
      runPromiseOrDie(adapter.readTranscript(providerSessionId)),
  };
}

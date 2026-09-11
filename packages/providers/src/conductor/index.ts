import { type ProviderSessionObservation, WORKSPACE_TASK_SUPPORT } from "@sidecar/session";
import type { CloudFetch } from "@sidecar/wire";
import type { AdapterDiagnosticCallback } from "../shared/adapter-diagnostics.js";
import { type CloudSessionPlugin, cloudPass } from "../shared/cloud-pass.js";
import { runAdapterRead } from "../shared/promise-face.js";
import { conductorActions } from "./actions.js";
import {
  conductorConversationEnds,
  readConductorConversation,
  readConductorTranscript,
  readConductorTranscriptSince,
} from "./conversation.js";
import { type ConductorPassCache, conductorObservations } from "./observe.js";
import {
  CONDUCTOR_DEFAULT_API_URL,
  CONDUCTOR_ENVIRONMENT,
  CONDUCTOR_PROVIDER,
} from "./vocabulary.js";

export interface ConductorPluginOptions {
  readApiKey: () => Promise<string | undefined>;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  onDiagnostic?: AdapterDiagnosticCallback;
  /**
   * The roster the brain's transcript reads answer for, when a host holds
   * one the plugin did not read itself: the hosted brain reads against the
   * stored snapshot its turns were shown. Absent, the latest pass's own.
   */
  reported?: () => readonly ProviderSessionObservation[];
}

/**
 * Observes Conductor cloud sessions through the documented public API. It
 * reads only workspaces the authenticated user created and left open — a
 * workspace filed away on Conductor's own surface is dropped whole, its chats
 * with it — observation issues no request that can change provider state, and
 * it reports nothing at all without a credential. Each chat is reported as
 * its own session carrying the workspace around it as its group: the
 * workspace is the unit Conductor's own surface shows, but the chat is the
 * thing a press opens and a write reaches, and a workspace holding two chats
 * in two states is two facts, not one.
 *
 * No observation pass reads a word of a conversation. Its three reads are
 * the `conversation` handler, reached at a developer's own press on a chat's
 * screen, the `transcript` handler, reached by the brain's own read tool in a
 * turn, and the `transcriptSince` handler, reached by the brain's observation
 * turn for a chat the roster diff named, each behind the cursor Conductor's
 * own last answer handed back; between them they keep nothing but where in
 * each transcript the last read got to. None takes anything from a pass: the
 * pass still judges a cloud chat from what Conductor reports about it, and
 * the brain's own reads are what open its messages.
 */
export function conductorPlugin(options: ConductorPluginOptions): CloudSessionPlugin {
  /**
   * What the identity read learned and the projects the latest pass listed.
   * A creation ask is honoured only against these, so it can never name a
   * project observation did not see; `cloudPass` clears them whenever the
   * credential changes or is rejected, so nothing read as one user can be
   * offered to another.
   */
  const cache: ConductorPassCache = { projects: [] };
  const ends = conductorConversationEnds();

  const pass = cloudPass({
    provider: CONDUCTOR_PROVIDER,
    defaultBaseUrl: CONDUCTOR_DEFAULT_API_URL,
    baseUrlEnvironmentVariable: CONDUCTOR_ENVIRONMENT.API_URL,
    ...options,
    forget() {
      cache.userId = undefined;
      cache.projects = [];
      ends.reached.clear();
    },
    collect: (request, now) => conductorObservations(request, now, cache),
  });

  const reported = options.reported ?? (() => pass.latest());

  return {
    provider: CONDUCTOR_PROVIDER,
    observe: () => runAdapterRead(pass.run()),
    latest: () => pass.latest(),
    lastObservationFailure: () => pass.lastFailure(),

    /**
     * Where Conductor will create a workspace: the projects the last pass
     * listed. An opening task is optional — Conductor makes an idle workspace
     * happily — and is handed over after creation, through the documented
     * message endpoint on the first session the creation response names.
     */
    projects: () =>
      cache.projects.map((project) => ({
        providerProjectId: project.id,
        repository: project.repositoryLabel,
        taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
      })),

    actions: conductorActions(pass),

    reads: {
      transcript: (providerSessionId) =>
        readConductorTranscript(pass, ends, reported, providerSessionId),
      transcriptSince: (providerSessionId, cursor) =>
        readConductorTranscriptSince(pass, ends, reported, providerSessionId, cursor),
      conversation: ({ request, observation }) =>
        readConductorConversation(pass, ends, observation.providerSessionId, request),
    },
  };
}

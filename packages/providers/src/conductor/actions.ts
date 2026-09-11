import {
  ACTION_RESULT_STATUS,
  type ActionHandlers,
  isListedWorkspaceAgentModel,
  type ProviderActionResult,
  type ProviderWorkspaceResult,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import type { CloudPass } from "../shared/cloud-pass.js";
import { WRITE_SUBJECT } from "../shared/cloud-pass.js";
import {
  CLOUD_ADAPTER_DEFAULTS,
  type CloudWriteRoute,
  textFromRecord,
} from "../shared/cloud-wire.js";
import { runAdapterRead } from "../shared/promise-face.js";
import {
  CONDUCTOR_ARCHIVE_WORKSPACE_CONTROL_ID,
  CONDUCTOR_CANCEL_ADVERTISEMENT,
  CONDUCTOR_PROVIDER_ID,
  CONDUCTOR_PROVIDER_NAME,
} from "./vocabulary.js";
import {
  CONDUCTOR_MESSAGE_FIELD,
  CONDUCTOR_RENAME_FIELD,
  CONDUCTOR_ROUTE_SEGMENT,
  CONDUCTOR_SESSION_CREATE_FIELD,
  CONDUCTOR_WORKSPACE_FIELD,
} from "./wire.js";

/**
 * The actions Conductor documents, each as the route it takes and the write that
 * carries it. Every target here arrived from the observation `dispatchAction`
 * resolved — the advertised control, the `add-agent` and `rename-workspace`
 * targets, the offered project — so nothing an ask sent decides where a write
 * lands.
 */

export const CONDUCTOR_WRITE_ROUTE = {
  message: (providerSessionId: string, text: string): CloudWriteRoute => ({
    segments: [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      providerSessionId,
      CONDUCTOR_ROUTE_SEGMENT.MESSAGES,
    ],
    body: { [CONDUCTOR_MESSAGE_FIELD.MESSAGE]: text },
  }),

  cancelTurn: (providerSessionId: string): CloudWriteRoute => ({
    segments: [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      providerSessionId,
      CONDUCTOR_ROUTE_SEGMENT.CANCEL,
    ],
    // Conductor documents no body for a cancel, so none is sent.
  }),

  archiveWorkspace: (workspaceId: string): CloudWriteRoute => ({
    segments: [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.WORKSPACES,
      workspaceId,
      CONDUCTOR_ROUTE_SEGMENT.ARCHIVE,
    ],
    // Conductor documents no body for an archive, so none is sent. The answer
    // comes back only once the workspace is actually filed away — measured
    // near eleven seconds against the live API, past the shared request bound
    // — so the write rides the slow deadline. On a shorter one the fetch gives
    // up mid-action and an archive that landed is reported as one that may not
    // have.
    timeoutMs: CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  }),

  renameSession: (providerSessionId: string, name: string): CloudWriteRoute => ({
    segments: [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.SESSIONS,
      providerSessionId,
      CONDUCTOR_ROUTE_SEGMENT.RENAME,
    ],
    body: { [CONDUCTOR_RENAME_FIELD.NAME]: name },
  }),

  renameWorkspace: (workspaceId: string, name: string): CloudWriteRoute => ({
    segments: [
      CONDUCTOR_ROUTE_SEGMENT.V0,
      CONDUCTOR_ROUTE_SEGMENT.WORKSPACES,
      workspaceId,
      CONDUCTOR_ROUTE_SEGMENT.RENAME,
    ],
    body: { [CONDUCTOR_RENAME_FIELD.NAME]: name },
  }),
} as const;

/**
 * The credential is read at action time, not held from the observation pass, so
 * a key the user just replaced or removed is honoured immediately. Its
 * absence is a rejection with the actual reason, not the unsupported answer:
 * the session advertised the action while a key stood behind it, and a key that
 * has since gone is a different fact than a session that moved on.
 */
const MISSING_KEY: ProviderActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: `${CONDUCTOR_PROVIDER_NAME}'s API key is no longer configured.`,
};

/** One documented write, under the key as it stands at the moment of the action. */
async function write(
  pass: CloudPass,
  route: CloudWriteRoute,
  subject?: (typeof WRITE_SUBJECT)[keyof typeof WRITE_SUBJECT],
): Promise<{ outcome: ProviderActionResult; body?: WireRecord }> {
  const apiKey = await pass.readApiKey();
  if (!apiKey) return { outcome: MISSING_KEY };
  return runAdapterRead(pass.write(apiKey, route, subject));
}

export function conductorActions(pass: CloudPass): ActionHandlers {
  return {
    async message({ request, observation }) {
      return (
        await write(
          pass,
          CONDUCTOR_WRITE_ROUTE.message(observation.providerSessionId, request.text),
        )
      ).outcome;
    },

    async control({ request, observation }) {
      const { control } = request;
      if (control.id === CONDUCTOR_CANCEL_ADVERTISEMENT.id) {
        return (await write(pass, CONDUCTOR_WRITE_ROUTE.cancelTurn(observation.providerSessionId)))
          .outcome;
      }
      if (control.id === CONDUCTOR_ARCHIVE_WORKSPACE_CONTROL_ID && control.target) {
        return (await write(pass, CONDUCTOR_WRITE_ROUTE.archiveWorkspace(control.target))).outcome;
      }
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "This provider has no such control.",
      };
    },

    async renameSession({ request, observation }) {
      return (
        await write(
          pass,
          CONDUCTOR_WRITE_ROUTE.renameSession(observation.providerSessionId, request.name),
        )
      ).outcome;
    },

    async renameWorkspace({ request }) {
      // The workspace to rename is the observation's own advertised target, so
      // a rename lands on the workspace of the row the user acted on, under
      // the credential that observed it.
      return (
        await write(
          pass,
          CONDUCTOR_WRITE_ROUTE.renameWorkspace(request.renameTarget, request.name),
          WRITE_SUBJECT.WORKSPACE,
        )
      ).outcome;
    },

    async spawnAgent({ request }) {
      // The model and effort arrive only when the stored selection names
      // exactly this agent kind, and are held to the build's table once more
      // here as the whole they were chosen as: the provider answers for its
      // own writes, and an effort must not outlive the model it was chosen
      // beside.
      const chosen =
        request.model &&
        isListedWorkspaceAgentModel(CONDUCTOR_PROVIDER_ID, {
          agent: request.agent,
          model: request.model,
          ...(request.effort ? { effort: request.effort } : undefined),
        })
          ? { model: request.model, effort: request.effort }
          : undefined;
      return (
        await write(pass, {
          segments: [CONDUCTOR_ROUTE_SEGMENT.V0, CONDUCTOR_ROUTE_SEGMENT.SESSIONS],
          body: {
            // The target is the workspace id the observation itself
            // advertised, so the route acts on what the user was shown.
            [CONDUCTOR_SESSION_CREATE_FIELD.WORKSPACE_ID]: request.spawnTarget,
            [CONDUCTOR_SESSION_CREATE_FIELD.AGENT]: request.agent,
            ...(chosen ? { [CONDUCTOR_SESSION_CREATE_FIELD.MODEL]: chosen.model } : undefined),
            ...(chosen?.effort
              ? { [CONDUCTOR_SESSION_CREATE_FIELD.EFFORT]: chosen.effort }
              : undefined),
            ...(request.name ? { [CONDUCTOR_SESSION_CREATE_FIELD.NAME]: request.name } : undefined),
            // The opening task rides the creation itself: `POST /v0/sessions`
            // documents taking the first message inline.
            ...(request.task
              ? { [CONDUCTOR_SESSION_CREATE_FIELD.MESSAGE]: request.task }
              : undefined),
          },
        })
      ).outcome;
    },

    createWorkspace: (input) => createWorkspace(pass, input),
  };
}

/**
 * Creates one workspace in a project the latest pass reported, and — when the
 * developer gave the new agent an opening task — hands that over through the
 * documented message endpoint on the first session the creation response
 * named. The task deliberately does not ride the creation: Conductor's
 * creation endpoint documents no prompt field.
 */
async function createWorkspace(
  pass: CloudPass,
  input: Parameters<ActionHandlers["createWorkspace"]>[0],
): Promise<ProviderWorkspaceResult> {
  const { project, name, task, agentSelection } = input;
  // The chosen agent, model, and effort ride together, and only as a
  // selection the build's table lists — the provider answers for its own
  // writes, so a value that slipped past the store is dropped here rather
  // than sent.
  const chosen =
    agentSelection && isListedWorkspaceAgentModel(CONDUCTOR_PROVIDER_ID, agentSelection)
      ? agentSelection
      : undefined;
  const created = await write(
    pass,
    {
      segments: [CONDUCTOR_ROUTE_SEGMENT.V0, CONDUCTOR_ROUTE_SEGMENT.WORKSPACES],
      body: {
        [CONDUCTOR_WORKSPACE_FIELD.PROJECT_ID]: project.providerProjectId,
        ...(name ? { [CONDUCTOR_WORKSPACE_FIELD.NAME]: name } : undefined),
        ...(chosen
          ? {
              [CONDUCTOR_WORKSPACE_FIELD.AGENT]: chosen.agent,
              [CONDUCTOR_WORKSPACE_FIELD.MODEL]: chosen.model,
              ...(chosen.effort
                ? { [CONDUCTOR_WORKSPACE_FIELD.EFFORT]: chosen.effort }
                : undefined),
            }
          : undefined),
      },
    },
    WRITE_SUBJECT.PROJECT,
  );
  if (created.outcome.status !== ACTION_RESULT_STATUS.ACCEPTED) return created.outcome;

  // The id the response named rides the acceptance — an identifier only,
  // never an address — so the surface can open the workspace once an
  // observation pass reports that session itself. The body it was read from
  // never leaves this module.
  const createdSessionId = textFromRecord(created.body ?? {}, CONDUCTOR_WORKSPACE_FIELD.SESSION_ID);
  const landed: ProviderWorkspaceResult = {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    ...(createdSessionId ? { providerSessionId: createdSessionId } : undefined),
  };
  if (!task) return landed;

  if (!createdSessionId) {
    return {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason:
        "The workspace was created, but its opening task was not delivered: " +
        "Conductor did not say which session takes the opening message.",
    };
  }
  const delivered = await write(
    pass,
    CONDUCTOR_WRITE_ROUTE.message(createdSessionId, task),
    WRITE_SUBJECT.SESSION,
  );
  if (delivered.outcome.status === ACTION_RESULT_STATUS.ACCEPTED) return landed;
  return {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: `The workspace was created, but its opening task was not delivered: ${
      delivered.outcome.status === ACTION_RESULT_STATUS.REJECTED
        ? delivered.outcome.reason
        : "the provider documents no way to hand it over."
    }`,
  };
}

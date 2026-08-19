import {
  ISSUE_ACTION_KIND,
  type IssueTracker,
  type IssueTrackerAdapter,
  type IssueTransition,
  isRecord,
  isWireNumber,
  maximumIssueTransitions,
  TRACKER_ACTION_RESULT_STATUS,
  type TrackerIssueAction,
  type TrackerIssueObservation,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/core";
import { Effect } from "effect";
import { Http } from "./services/http";
import { CREDENTIAL_PROVIDER_ID, CREDENTIAL_PROVIDERS } from "./shared/credential-providers";
import { unparsedWire, wireRecord } from "./wire-boundary";

// Shared with the credential registry so the key the user saves and the
// tracker Luke reads with it can never name different things.
const LINEAR_TRACKER_ID = CREDENTIAL_PROVIDER_ID.LINEAR;
const LINEAR_TRACKER_NAME = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR].displayName;

const LINEAR_ENVIRONMENT = {
  API_URL: "LINEAR_API_URL",
} as const;

/** Linear's GraphQL API answers at one endpoint for reads and writes alike. */
const LINEAR_DEFAULT_API_URL = "https://api.linear.app/graphql";

const REQUEST_TIMEOUT_MS = 10_000;
/** More issues than anyone holds in their head at once, and the roster says fewer. */
const ISSUE_PAGE_SIZE = 25;

/**
 * The one read this client makes, fixed by this build. GraphQL has no method
 * to make a request read-only the way a GET is, so the separation is held
 * where it can be held: `observe` only ever sends this document, and the two
 * write documents below are sent only by `execute`, only for an action the
 * main process already validated against its own latest observation.
 *
 * The fields ask for what the roster says and nothing wider — no description,
 * no comment thread, no other assignee's work. Completed and cancelled issues
 * are not a board anyone is asked to act on, so they are filtered at the
 * source rather than carried and hidden.
 */
const LINEAR_READ_ASSIGNED_ISSUES = `query AssignedIssues($first: Int!) {
  viewer {
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes {
        id
        identifier
        title
        url
        state { id name }
        team { states { nodes { id name position } } }
      }
    }
  }
}`;

/** The two writes Linear documents for the two acts Luke can be asked for. */
const LINEAR_WRITE = {
  [ISSUE_ACTION_KIND.SET_STATE]: `mutation SetIssueState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`,
  [ISSUE_ACTION_KIND.COMMENT]: `mutation CommentOnIssue($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success }
}`,
} as const;

export interface LinearTrackerOptions {
  /**
   * Resolved at observation time, so a connection made or ended in settings
   * takes effect on the next pass without the tracker being rebuilt. Nothing
   * here knows how the token was come by or when it lapses: it arrives
   * already renewed, or it does not arrive.
   */
  readAccessToken: () => Effect.Effect<string | undefined>;
  now?: () => number;
}

interface LinearState {
  id: string;
  name: string;
  position: number;
}

interface GraphQlPayload {
  data?: WireRecord;
  errors?: readonly unknown[];
}

function stateFrom(value: UnparsedWireValue): LinearState | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id);
  const name = text(value.name);
  if (!id || !name) return undefined;
  const position = isWireNumber(value.position) ? value.position : 0;
  return { id, name, position };
}

/**
 * The states an issue can be asked into: its team's workflow in board order,
 * minus the state it is already in. Linear accepts any state on the team, so
 * the whole workflow is the advertisement and the bound in core caps it.
 */
function transitionsFrom(node: WireRecord, currentStateId: string): IssueTransition[] {
  const team = isRecord(node.team) ? node.team : undefined;
  const states = isRecord(team?.states) ? team.states : undefined;
  const nodes = Array.isArray(states?.nodes) ? states.nodes : [];
  return nodes
    .map(stateFrom)
    .filter((state): state is LinearState => state !== undefined && state.id !== currentStateId)
    .sort((left, right) => left.position - right.position)
    .slice(0, maximumIssueTransitions)
    .map((state) => ({ id: state.id, name: state.name }));
}

/**
 * Reads the issues Linear lists for the user, and carries the two acts the
 * user can ask of one, through Linear's own GraphQL API under the user's own
 * key. With no key it observes nothing and issues no request at all.
 */
export class LinearIssueTracker implements IssueTrackerAdapter {
  readonly tracker: IssueTracker = {
    id: LINEAR_TRACKER_ID,
    displayName: LINEAR_TRACKER_NAME,
  };

  readonly #readAccessToken: () => Effect.Effect<string | undefined>;
  readonly #now: () => number;
  readonly #endpoint: string;

  constructor(options: LinearTrackerOptions) {
    this.#readAccessToken = options.readAccessToken;
    this.#now = options.now ?? Date.now;
    this.#endpoint = process.env[LINEAR_ENVIRONMENT.API_URL]?.trim() || LINEAR_DEFAULT_API_URL;
  }

  observe() {
    return Effect.gen(this, function* () {
      const accessToken = yield* this.#readAccessToken();
      // No token, no request: the tracker is not connected, which is a different
      // answer from a connected tracker listing nothing.
      if (!accessToken) return undefined;

      const payload = yield* this.#post(accessToken, LINEAR_READ_ASSIGNED_ISSUES, {
        first: ISSUE_PAGE_SIZE,
      });
      if (payload.errors)
        return yield* Effect.fail(new Error("Linear answered the read with errors"));
      const viewer =
        isRecord(payload.data) && isRecord(payload.data.viewer) ? payload.data.viewer : undefined;
      const issues = isRecord(viewer?.assignedIssues) ? viewer.assignedIssues : undefined;
      const nodes = Array.isArray(issues?.nodes) ? issues.nodes : [];
      const observedAt = this.#now();

      // A malformed issue is skipped rather than failing the pass: the roster
      // should say what Linear could say, not go silent over one broken node.
      return nodes.flatMap((node): TrackerIssueObservation[] => {
        if (!isRecord(node)) return [];
        const trackerIssueId = text(node.id);
        const identifier = text(node.identifier);
        const title = text(node.title);
        const state = stateFrom(node.state);
        if (!trackerIssueId || !identifier || !title || !state) return [];
        const url = text(node.url);
        return [
          {
            trackerIssueId,
            identifier,
            title,
            stateName: state.name,
            observedAt,
            ...(url ? { url } : undefined),
            transitions: transitionsFrom(node, state.id),
            canComment: true,
          },
        ];
      });
    });
  }

  execute(action: TrackerIssueAction) {
    return Effect.gen(this, function* () {
      const accessToken = yield* this.#readAccessToken();
      if (!accessToken) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };

      const [document, variables, resultField] =
        action.kind === ISSUE_ACTION_KIND.SET_STATE
          ? ([
              LINEAR_WRITE[ISSUE_ACTION_KIND.SET_STATE],
              { id: action.trackerIssueId, stateId: action.transition.id },
              "issueUpdate",
            ] as const)
          : ([
              LINEAR_WRITE[ISSUE_ACTION_KIND.COMMENT],
              { issueId: action.trackerIssueId, body: action.body },
              "commentCreate",
            ] as const);

      // What became of the act is an answer for the conversation, never a
      // throw: the developer asked for something, and the reply has to say.
      const posted = yield* this.#post(accessToken, document, variables).pipe(Effect.either);
      if (posted._tag === "Left") {
        return {
          status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
          reason: "The request to Linear did not complete.",
        };
      }
      const payload = posted.right;
      if (payload.errors) {
        return {
          status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
          reason: "Linear rejected that change.",
        };
      }
      const result = isRecord(payload.data) ? payload.data[resultField] : undefined;
      if (!isRecord(result) || result.success !== true) {
        return {
          status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
          reason: "Linear did not confirm that change.",
        };
      }
      return { status: TRACKER_ACTION_RESULT_STATUS.ACCEPTED };
    });
  }

  #post(
    accessToken: string,
    document: string,
    variables: WireRecord,
  ): Effect.Effect<GraphQlPayload, unknown, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      const response = yield* http.request(this.#endpoint, {
        method: "POST",
        headers: {
          // What the consent page granted is an OAuth access token, which
          // Linear reads under the scheme every OAuth token is sent with.
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: document, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return yield* Effect.fail(new Error(`Linear answered ${response.status}`));
      const payload = yield* http.readJson(response);
      const wirePayload = wireRecord(
        unparsedWire(payload as import("./wire-boundary").WireBoundaryInput),
      );
      if (!wirePayload)
        return yield* Effect.fail(new Error("Linear answered with something other than GraphQL"));
      const data = wireRecord(unparsedWire(wirePayload.data));
      return {
        ...(data ? { data } : undefined),
        ...(Array.isArray(wirePayload.errors) && wirePayload.errors.length > 0
          ? { errors: wirePayload.errors }
          : undefined),
      };
    });
  }
}

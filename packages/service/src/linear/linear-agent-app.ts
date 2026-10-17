import { createHmac, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { createTask } from "@luke/database/models/task-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { LINEAR_BOUNDS, type TaskLinearIssue } from "@luke/features/linear-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { EXCESS_KEYS } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { workspaceStepOf } from "../agents/written-mentions.js";
import { text } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * linear-agent-app.ts -- Luke as a Linear agent, as a trial: an issue delegated to Luke, or Luke @mentioned on one, starts a Luke task from it and answers in Linear with the task's link.
 *
 * Linear's agent platform (https://linear.app/developers/agents) sends an
 * `AgentSessionEvent` to the app's webhook when someone delegates an issue
 * to the app or @mentions it. Its `created` action is read here: the
 * signature over the body's own bytes is checked under the app's webhook
 * secret before anything of it is read, a delivery older or newer than a
 * minute is refused as a replay, and then, inside the five seconds Linear
 * waits, a task is started in the one Luke workspace the deployment names,
 * as the one member it names, with the issue attached as a plan started
 * from the New task picker has it (`linearIssue`); the session in Linear is
 * given the task's address as its external link and a response naming it.
 * A `prompted` action, a follow-up typed in Linear, is answered and read no
 * further yet.
 *
 * This is a trial over one Linear workspace and one Luke workspace, so it
 * stores nothing of its own: the app speaks with a client-credentials token,
 * an app-actor token Linear mints for the workspace the app was made in
 * (https://linear.app/developers/oauth-2-0-authentication), asked for afresh
 * on each delivery, and the Luke workspace and member are deployment
 * variables. A deployment missing any of them refuses every delivery as
 * unavailable. What Linear sends is the issue's words, written by whoever
 * wrote them; they are kept on the task as a picked issue's are, and a
 * coding agent reads them fenced (`coder-host/start.ts`).
 */

/** The path Linear delivers to, as the app's settings name it under the deployment's origin. */
const LINEAR_AGENT_WEBHOOK_PATH = "/api/linear/agent";

/** The deployment variables the trial reads. */
const LINEAR_AGENT_ENVIRONMENT = {
  /** The Linear OAuth app's client id. */
  CLIENT_ID: "LINEAR_AGENT_CLIENT_ID",
  /** The Linear OAuth app's client secret, which mints the app's client-credentials token. */
  CLIENT_SECRET: "LINEAR_AGENT_CLIENT_SECRET",
  /** The secret Linear signs the app's webhook deliveries with. */
  WEBHOOK_SECRET: "LINEAR_AGENT_WEBHOOK_SECRET",
  /** The Luke workspace a delegated issue starts its task in. */
  WORKSPACE_ID: "LINEAR_AGENT_WORKSPACE_ID",
  /** The member of that workspace the task is started as, who owns it. */
  USER_ID: "LINEAR_AGENT_USER_ID",
} as const;

/** The trial's configuration, every part present, or nothing where any is missing. */
export interface LinearAgentSettings {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly webhookSecret: Redacted.Redacted;
  readonly workspaceId: string;
  readonly userId: string;
}

export class LinearAgentConfig extends Context.Service<
  LinearAgentConfig,
  { readonly settings: LinearAgentSettings | undefined }
>()("LinearAgentConfig") {}

/** A secret trimmed, and a blank one dropped, as the hosted environment reads its own. */
function presentSecret(value: Option.Option<Redacted.Redacted>): Redacted.Redacted | undefined {
  const revealed = text(Option.getOrUndefined(Option.map(value, Redacted.value)));
  return revealed === undefined ? undefined : Redacted.make(revealed);
}

/** The trial as this deployment's environment configures it; unconfigured where any variable is missing. */
export const linearAgentFromEnvironment: Layer.Layer<LinearAgentConfig, Config.ConfigError> =
  Layer.effect(
    LinearAgentConfig,
    Effect.map(
      Config.all({
        clientId: Config.option(Config.String(LINEAR_AGENT_ENVIRONMENT.CLIENT_ID)),
        clientSecret: Config.option(Config.Redacted(LINEAR_AGENT_ENVIRONMENT.CLIENT_SECRET)),
        webhookSecret: Config.option(Config.Redacted(LINEAR_AGENT_ENVIRONMENT.WEBHOOK_SECRET)),
        workspaceId: Config.option(Config.String(LINEAR_AGENT_ENVIRONMENT.WORKSPACE_ID)),
        userId: Config.option(Config.String(LINEAR_AGENT_ENVIRONMENT.USER_ID)),
      }),
      (read) => {
        const clientId = text(Option.getOrUndefined(read.clientId));
        const clientSecret = presentSecret(read.clientSecret);
        const webhookSecret = presentSecret(read.webhookSecret);
        const workspaceId = text(Option.getOrUndefined(read.workspaceId));
        const userId = text(Option.getOrUndefined(read.userId));
        return {
          settings:
            clientId === undefined ||
            clientSecret === undefined ||
            webhookSecret === undefined ||
            workspaceId === undefined ||
            userId === undefined
              ? undefined
              : { clientId, clientSecret, webhookSecret, workspaceId, userId },
        };
      },
    ),
  );

const HTTP_METHOD = { POST: "POST" } as const;

/** The header Linear signs a delivery under: the HMAC-SHA256 of the body's bytes, in hex. */
const SIGNATURE_HEADER = "linear-signature";

/** A delivery is a few kilobytes; this bounds it generously. */
const MAXIMUM_DELIVERY_BYTES = 1024 * 1024;

/** How far a delivery's own timestamp may stand from now, as Linear recommends against a replay. */
const REPLAY_WINDOW_MS = 60 * 1000;

/** The event this webhook reads, and its actions. */
const AGENT_SESSION_EVENT = "AgentSessionEvent";
const SESSION_ACTION = { CREATED: "created" } as const;

/** Linear's token endpoint and GraphQL API. */
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

/** The scopes the app's token carries: read and write, and being delegated and mentioned. */
const APP_SCOPES = "read,write,app:assignable,app:mentionable";

/** How long one call to Linear may take, so the delivery answers inside Linear's five seconds. */
const CALL_TIMEOUT = Duration.seconds(2);

/** The label the session's link to its task wears in Linear. */
const OPEN_IN_LUKE = "Open in Luke";

/** The few fields of a delivery read here; every other key Linear sends is dropped unread. */
const DeliverySchema = Schema.Struct({
  type: Schema.String,
  action: Schema.String,
  webhookTimestamp: Schema.Number,
  agentSession: Schema.Struct({
    id: Schema.String,
    issue: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          identifier: Schema.String,
          title: Schema.String,
          url: Schema.String,
          description: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
});

type Delivery = typeof DeliverySchema.Type;

const TokenSchema = Schema.Struct({ access_token: Schema.String });
const MutationSchema = Schema.Struct({ data: Schema.Unknown });

/** Why the work a delivery asked for could not be done; the kind alone is logged. */
class LinearAgentFailure extends Data.TaggedError("LinearAgentFailure")<{
  readonly step: "token" | "workspace" | "task" | "linear";
}> {}

/** Whether the header is the HMAC-SHA256 of the body's own bytes under the secret, compared in constant time. */
function signatureMatches(
  body: Uint8Array,
  header: string | undefined,
  secret: Redacted.Redacted,
): boolean {
  if (header === undefined) return false;
  const offered = Buffer.from(header, "hex");
  // The secret is revealed here alone, into the HMAC the compare reads.
  const wanted = createHmac("sha256", Redacted.value(secret)).update(body).digest();
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/** The issue a session is on, as a task keeps a picked one: its description bounded, empty where it has none. */
function taskIssueOf(issue: NonNullable<Delivery["agentSession"]["issue"]>): TaskLinearIssue {
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: (issue.description ?? "").slice(0, LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS),
  };
}

/** A client-credentials token for the app, minted afresh. */
const appToken = (settings: LinearAgentSettings) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(LINEAR_TOKEN_URL).pipe(
        HttpClientRequest.basicAuth(settings.clientId, settings.clientSecret),
        HttpClientRequest.bodyUrlParams({ grant_type: "client_credentials", scope: APP_SCOPES }),
      ),
    );
    if (response.status >= 400) return yield* new LinearAgentFailure({ step: "token" });
    const answered = yield* Schema.decodeUnknownEffect(TokenSchema)(yield* response.json);
    return Redacted.make(answered.access_token);
  }).pipe(
    Effect.timeout(CALL_TIMEOUT),
    Effect.mapError(() => new LinearAgentFailure({ step: "token" })),
  );

/** What an activity in a session says: a final response, or an error. */
type ActivityType = "response" | "error";

/** The variables of the two mutations the app sends. */
type MutationVariables =
  | {
      readonly input: {
        readonly agentSessionId: string;
        readonly content: { readonly type: ActivityType; readonly body: string };
      };
    }
  | {
      readonly id: string;
      readonly input: {
        readonly externalUrls: readonly { readonly label: string; readonly url: string }[];
      };
    };

/** One GraphQL mutation as the app; a refusal or an answer carrying no data fails. */
const mutate = (token: Redacted.Redacted, query: string, variables: MutationVariables) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.bodyJsonUnsafe({ query, variables }),
      ),
    );
    if (response.status >= 400) return yield* new LinearAgentFailure({ step: "linear" });
    yield* Schema.decodeUnknownEffect(MutationSchema)(yield* response.json);
  }).pipe(
    Effect.timeout(CALL_TIMEOUT),
    Effect.mapError(() => new LinearAgentFailure({ step: "linear" })),
  );

const MUTATION = {
  ACTIVITY:
    "mutation LukeAgentActivity($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }",
  SESSION:
    "mutation LukeAgentSession($id: String!, $input: AgentSessionUpdateInput!) { agentSessionUpdate(id: $id, input: $input) { success } }",
} as const;

/** An activity in the session: a final response, or an error. */
const activity = (token: Redacted.Redacted, sessionId: string, type: ActivityType, body: string) =>
  mutate(token, MUTATION.ACTIVITY, {
    input: { agentSessionId: sessionId, content: { type, body } },
  });

/** The task a delegated issue starts, as the configured member in the configured workspace; its address. */
const startedTask = (settings: LinearAgentSettings, issue: TaskLinearIssue) =>
  Effect.gen(function* () {
    const member = yield* isWorkspaceMember(settings.userId, settings.workspaceId).pipe(
      Effect.mapError(() => new LinearAgentFailure({ step: "workspace" })),
    );
    if (!member) return yield* new LinearAgentFailure({ step: "workspace" });
    const started = yield* createTask(settings.userId, {
      organizationId: settings.workspaceId,
      name: issue.title.slice(0, TASK_BOUNDS.MAX_NAME_CHARS),
      linearIssue: issue,
    }).pipe(Effect.mapError(() => new LinearAgentFailure({ step: "task" })));
    const workspace = yield* workspaceStepOf(settings.userId, settings.workspaceId).pipe(
      Effect.orElseSucceed(() => settings.workspaceId),
    );
    return encodeMention(
      { kind: MENTION_KIND.TASK, taskId: started.id },
      { workspace, repository: null },
    );
  });

/**
 * A created session's work: the token, the task, then the session's link
 * to it and the response naming it. Where the task could not be started,
 * the session is told so as an error, which ends it in Linear rather than
 * leaving it waiting; where Linear itself could not be told, the failure's
 * kind is logged and the delivery is still answered, since Linear asking
 * again would start a second task.
 */
const answerCreated = (settings: LinearAgentSettings, delivery: Delivery) =>
  Effect.gen(function* () {
    const sessionId = delivery.agentSession.id;
    const token = yield* appToken(settings);
    const issue = delivery.agentSession.issue;
    if (issue === undefined || issue === null) {
      yield* activity(
        token,
        sessionId,
        "error",
        "Luke starts a task from an issue, and this session is on none.",
      );
      return { started: false };
    }
    const link = yield* Effect.result(startedTask(settings, taskIssueOf(issue)));
    if (Result.isFailure(link)) {
      yield* Effect.logWarning("linear agent: no task was started", { step: link.failure.step });
      yield* activity(token, sessionId, "error", "Luke could not start a task for this issue.");
      return { started: false };
    }
    yield* mutate(token, MUTATION.SESSION, {
      id: sessionId,
      input: { externalUrls: [{ label: OPEN_IN_LUKE, url: link.success }] },
    });
    yield* activity(
      token,
      sessionId,
      "response",
      `I started a task in Luke for ${issue.identifier}: ${link.success}`,
    );
    return { started: true };
  }).pipe(
    Effect.catchTag("LinearAgentFailure", (failure) =>
      Effect.as(
        Effect.logWarning("linear agent: Linear could not be told", { step: failure.step }),
        { started: false },
      ),
    ),
  );

/** POST: one delivery, its signature and its age confirmed before anything of it is read. */
const deliveryEndpoint = /* @__PURE__ */ Effect.fn("web/linearAgentEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    | HttpServerRequest.HttpServerRequest
    | LinearAgentConfig
    | DatabaseServices
    | HttpClient.HttpClient
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const { settings } = yield* LinearAgentConfig;
    if (settings === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);
    if (!signatureMatches(body, request.headers[SIGNATURE_HEADER], settings.webhookSecret)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const read = readEither(DeliverySchema, { excess: EXCESS_KEYS.DROP })(
      yield* parseJsonBytes(body),
    );
    // Another kind of delivery is answered and ignored, so Linear does not ask again.
    if (Result.isFailure(read) || read.success.type !== AGENT_SESSION_EVENT) {
      return hostedJsonResponse(200, { started: false });
    }
    const now = yield* Clock.currentTimeMillis;
    if (Math.abs(now - read.success.webhookTimestamp) > REPLAY_WINDOW_MS) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    if (read.success.action !== SESSION_ACTION.CREATED) {
      return hostedJsonResponse(200, { started: false });
    }
    return hostedJsonResponse(200, yield* answerCreated(settings, read.success));
  },
);

/** The group: the one delivery path, and the hosted vocabulary's own refusal for any other. */
export function linearAgentApp(): WebRoutes<
  LinearAgentConfig | DatabaseServices | HttpClient.HttpClient
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, LINEAR_AGENT_WEBHOOK_PATH, hostedRefusing(deliveryEndpoint())),
    hostedNotFoundRoute,
  );
}

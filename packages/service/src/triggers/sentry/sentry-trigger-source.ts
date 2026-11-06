import { createHash } from "node:crypto";
import {
  activeInstallationWorkspace,
  markIntegrationInstallationDeleted,
} from "@repo/database/models/integration-installation-store";
import {
  INTEGRATION_TRIGGER_FILTER,
  SENTRY_TRIGGER_EVENT,
  TRIGGER_PROVIDER,
} from "@repo/features/trigger-catalog";
import { EXCESS_KEYS, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  hmacVerifier,
  type NormalizedEvent,
  TRIGGER_VERIFICATION,
  type TriggerDelivery,
  type TriggerSource,
} from "../trigger-source.js";
import { SentryApp } from "./sentry-app-config.js";

const SENTRY_TRIGGER_PATH = "/api/triggers/sentry";

const SENTRY_HEADER = {
  SIGNATURE: "sentry-hook-signature",
  RESOURCE: "sentry-hook-resource",
  REQUEST_ID: "request-id",
} as const;

const SENTRY_RESOURCE = {
  INSTALLATION: "installation",
  EVENT_ALERT: "event_alert",
  ISSUE: "issue",
} as const;

const SENTRY_ACTION = {
  TRIGGERED: "triggered",
  CREATED: "created",
  DELETED: "deleted",
} as const;

const SUMMARY_MAX_BYTES = 4096;

const SUMMARY_VALUE_CHARS = 512;

const SUMMARY_FRAMES = 5;

const SUMMARY_CUT = "\n…";

const verifySignature = hmacVerifier({ header: SENTRY_HEADER.SIGNATURE, encoding: "hex" });

const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));
const OptionalCount = Schema.optionalKey(
  Schema.NullOr(Schema.Union([Schema.String, Schema.Number])),
);

const InstallationSchema = Schema.Struct({ uuid: Schema.String });

const EnvelopeSchema = Schema.Struct({
  action: Schema.String,
  installation: InstallationSchema,
});

const FrameSchema = Schema.Struct({
  filename: OptionalText,
  function: OptionalText,
  module: OptionalText,
  lineno: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  in_app: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});

const ExceptionSchema = Schema.Struct({
  values: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          stacktrace: Schema.optionalKey(
            Schema.NullOr(Schema.Struct({ frames: Schema.optionalKey(Schema.Array(FrameSchema)) })),
          ),
        }),
      ),
    ),
  ),
});

const EventAlertSchema = Schema.Struct({
  data: Schema.Struct({
    event: Schema.Struct({
      issue_id: Schema.Union([Schema.String, Schema.Number]),
      title: OptionalText,
      culprit: OptionalText,
      level: OptionalText,
      environment: OptionalText,
      release: OptionalText,
      datetime: OptionalText,
      url: OptionalText,
      web_url: OptionalText,
      tags: Schema.optionalKey(
        Schema.NullOr(Schema.Array(Schema.Array(Schema.NullOr(Schema.String)))),
      ),
      exception: Schema.optionalKey(Schema.NullOr(ExceptionSchema)),
    }),
    triggered_rule: OptionalText,
  }),
});

const IssueSchema = Schema.Struct({
  data: Schema.Struct({
    issue: Schema.Struct({
      id: Schema.Union([Schema.String, Schema.Number]),
      shortId: OptionalText,
      title: OptionalText,
      culprit: OptionalText,
      level: OptionalText,
      permalink: OptionalText,
      web_url: OptionalText,
      count: OptionalCount,
      userCount: OptionalCount,
      firstSeen: OptionalText,
      lastSeen: OptionalText,
      project: Schema.optionalKey(Schema.NullOr(Schema.Struct({ slug: OptionalText }))),
    }),
  }),
});

type EventAlert = typeof EventAlertSchema.Type;
type Issue = typeof IssueSchema.Type;
type Frame = typeof FrameSchema.Type;

function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

function present(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}

function dedupeKeyOf(delivery: TriggerDelivery): string {
  const requestId = present(delivery.headers[SENTRY_HEADER.REQUEST_ID]);
  return requestId === undefined
    ? createHash("sha256").update(delivery.body).digest("hex")
    : createHash("sha256").update(requestId).digest("hex");
}

function projectOfEventUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  return /\/projects\/[^/]+\/([^/]+)\/events\//u.exec(url)?.[1];
}

function issueUrlOfEventUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const issue = /^(.*\/issues\/[^/]+\/)events\//u.exec(url)?.[1];
  return issue ?? url;
}

function tagOf(tags: EventAlert["data"]["event"]["tags"], name: string): string | undefined {
  const found = (tags ?? []).find((tag) => tag[0] === name);
  return present(found?.[1]);
}

function frameLine(frame: Frame): string {
  const where = present(frame.filename) ?? present(frame.module) ?? "?";
  const line = frame.lineno == null ? where : `${where}:${frame.lineno}`;
  const name = present(frame.function);
  return name === undefined ? line : `${name} (${line})`;
}

function topFrames(exception: EventAlert["data"]["event"]["exception"]): readonly string[] {
  const values = exception?.values ?? [];
  const primary = values[values.length - 1];
  const frames = primary?.stacktrace?.frames ?? [];
  return frames
    .filter((frame) => frame.in_app === true)
    .slice(-SUMMARY_FRAMES)
    .reverse()
    .map(frameLine);
}

function field(label: string, value: string | number | null | undefined): readonly string[] {
  const text = present(value);
  return text === undefined ? [] : [`${label}: ${text.slice(0, SUMMARY_VALUE_CHARS)}`];
}

function boundedSummary(lines: readonly string[]): string {
  const joined = lines.join("\n");
  const encoder = new TextEncoder();
  if (encoder.encode(joined).byteLength <= SUMMARY_MAX_BYTES) return joined;
  const budget = SUMMARY_MAX_BYTES - encoder.encode(SUMMARY_CUT).byteLength;
  let spent = 0;
  let end = 0;
  for (const character of joined) {
    spent += encoder.encode(character).byteLength;
    if (spent > budget) break;
    end += character.length;
  }
  return `${joined.slice(0, end)}${SUMMARY_CUT}`;
}

function alertEvent(alert: EventAlert, dedupeKey: string): NormalizedEvent {
  const { event, triggered_rule } = alert.data;
  const issueId = String(event.issue_id);
  const title = present(event.title);
  const url = issueUrlOfEventUrl(present(event.web_url));
  const project = projectOfEventUrl(present(event.url));
  const environment = present(event.environment) ?? tagOf(event.tags, "environment");
  const level = present(event.level);
  const frames = topFrames(event.exception);
  return {
    event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
    dedupeKey,
    subject: {
      id: issueId,
      ...(title === undefined ? undefined : { title }),
      ...(url === undefined ? undefined : { url }),
    },
    attributes: {
      ...(project === undefined ? undefined : { [INTEGRATION_TRIGGER_FILTER.PROJECT]: [project] }),
      ...(environment === undefined
        ? undefined
        : { [INTEGRATION_TRIGGER_FILTER.ENVIRONMENT]: [environment] }),
      ...(level === undefined ? undefined : { [INTEGRATION_TRIGGER_FILTER.LEVEL]: [level] }),
    },
    summary: boundedSummary([
      ...field("Alert rule", triggered_rule),
      ...field("Title", title),
      ...field("Culprit", event.culprit),
      ...field("Level", level),
      ...field("Project", project),
      ...field("Environment", environment),
      ...field("Release", event.release ?? tagOf(event.tags, "release")),
      ...field("Seen", event.datetime),
      ...field("Issue", issueId),
      ...field("Link", url),
      ...(frames.length === 0
        ? []
        : ["In-app frames, innermost first:", ...frames.map((each) => `  ${each}`)]),
    ]),
  };
}

function issueEvent(read: Issue, dedupeKey: string): NormalizedEvent {
  const { issue } = read.data;
  const issueId = String(issue.id);
  const title = present(issue.title);
  const url = present(issue.permalink) ?? present(issue.web_url);
  const project = present(issue.project?.slug);
  const level = present(issue.level);
  return {
    event: SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
    dedupeKey,
    subject: {
      id: issueId,
      ...(title === undefined ? undefined : { title }),
      ...(url === undefined ? undefined : { url }),
    },
    attributes: {
      ...(project === undefined ? undefined : { [INTEGRATION_TRIGGER_FILTER.PROJECT]: [project] }),
      ...(level === undefined ? undefined : { [INTEGRATION_TRIGGER_FILTER.LEVEL]: [level] }),
    },
    summary: boundedSummary([
      ...field("Title", title),
      ...field("Culprit", issue.culprit),
      ...field("Level", level),
      ...field("Project", project),
      ...field("First seen", issue.firstSeen),
      ...field("Last seen", issue.lastSeen),
      ...field("Events", issue.count),
      ...field("Users", issue.userCount),
      ...field("Short id", issue.shortId),
      ...field("Link", url),
    ]),
  };
}

function envelopeOf(delivery: TriggerDelivery) {
  const read = readDelivery(EnvelopeSchema, delivery.payload);
  if (Result.isFailure(read)) return undefined;
  return {
    resource: delivery.headers[SENTRY_HEADER.RESOURCE] ?? "",
    action: read.success.action,
    installation: read.success.installation.uuid,
  };
}

export const sentryTriggerSource: TriggerSource<SentryApp> = {
  provider: TRIGGER_PROVIDER.SENTRY,
  path: SENTRY_TRIGGER_PATH,
  verify: (request, body) =>
    Effect.gen(function* () {
      const settings = yield* Effect.option((yield* SentryApp).settings);
      if (Option.isNone(settings)) return TRIGGER_VERIFICATION.UNCONFIGURED;
      return verifySignature(request, body, settings.value.clientSecret)
        ? TRIGGER_VERIFICATION.VALID
        : TRIGGER_VERIFICATION.INVALID;
    }),
  lifecycle: (delivery) =>
    Effect.gen(function* () {
      const envelope = envelopeOf(delivery);
      if (envelope?.resource !== SENTRY_RESOURCE.INSTALLATION) return false;
      if (envelope.action === SENTRY_ACTION.DELETED) {
        yield* markIntegrationInstallationDeleted(TRIGGER_PROVIDER.SENTRY, envelope.installation);
      }
      return true;
    }),
  workspaceOf: (delivery) => {
    const envelope = envelopeOf(delivery);
    return envelope === undefined
      ? Effect.succeed(Option.none())
      : activeInstallationWorkspace(TRIGGER_PROVIDER.SENTRY, envelope.installation);
  },
  normalize: (delivery) => {
    const envelope = envelopeOf(delivery);
    if (envelope === undefined) return [];
    const dedupeKey = dedupeKeyOf(delivery);
    if (
      envelope.resource === SENTRY_RESOURCE.EVENT_ALERT &&
      envelope.action === SENTRY_ACTION.TRIGGERED
    ) {
      const read = readDelivery(EventAlertSchema, delivery.payload);
      return Result.isFailure(read) ? [] : [alertEvent(read.success, dedupeKey)];
    }
    if (envelope.resource === SENTRY_RESOURCE.ISSUE && envelope.action === SENTRY_ACTION.CREATED) {
      const read = readDelivery(IssueSchema, delivery.payload);
      return Result.isFailure(read) ? [] : [issueEvent(read.success, dedupeKey)];
    }
    return [];
  },
};

import { createHash } from "node:crypto";
import {
  activeInstallationWorkspace,
  markIntegrationInstallationDeleted,
} from "@luke/database/models/integration-installation-store";
import {
  INTEGRATION_TRIGGER_FILTER,
  SENTRY_TRIGGER_EVENT,
  TRIGGER_PROVIDER,
} from "@luke/features/trigger-catalog";
import { EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  hmacVerifier,
  type NormalizedEvent,
  TRIGGER_VERIFICATION,
  type TriggerDelivery,
  type TriggerSource,
} from "../trigger-source.js";
import { SentryApp } from "./sentry-app-config.js";

/**
 * sentry-trigger-source.ts -- Luke's Sentry integration's webhook as a trigger source: a delivery verified under the client secret, an uninstall marked, and an alert or a new issue read as the catalog's event.
 *
 * Sentry signs every delivery with the integration's client secret, the
 * HMAC-SHA256 of the body's own bytes in hex under `Sentry-Hook-Signature`,
 * names what it is about in `Sentry-Hook-Resource` beside the body's
 * `action`, and names the delivery itself in `Request-ID`, which a run is
 * recorded under. An issue alert whose action is the Luke integration
 * (`event_alert`, `triggered`) is `alert-triggered`, and a new issue
 * (`issue`, `created`) is `issue-created`; every other resource and action
 * is read as nothing. An uninstall (`installation`, `deleted`) marks the
 * installation deleted so nothing it sends fires again; an install is the
 * install flow's to link and is ignored here. Of an event only what the
 * run's history and the agent's summary name is read: the issue, its title
 * and address, the project, environment, and level its trigger filters on,
 * and the few lines a summary is made of. The field names are those of
 * Sentry's integration platform webhooks (issue alerts and issues).
 */

/** The path Sentry delivers to, as the integration's settings name it under the deployment's origin. */
const SENTRY_TRIGGER_PATH = "/api/triggers/sentry";

/** The headers a delivery carries that are read here, lower case. */
const SENTRY_HEADER = {
  SIGNATURE: "sentry-hook-signature",
  RESOURCE: "sentry-hook-resource",
  REQUEST_ID: "request-id",
} as const;

/** The resources a delivery may be about, as Sentry names them. */
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

/** The most a summary spells, in UTF-8 bytes. */
const SUMMARY_MAX_BYTES = 4096;

/** The longest one value a summary line spells, so one long title leaves room for the rest. */
const SUMMARY_VALUE_CHARS = 512;

/** The most in-app stack frames a summary names, innermost first. */
const SUMMARY_FRAMES = 5;

/** What a summary cut to its bound ends with. */
const SUMMARY_CUT = "\n…";

const verifySignature = hmacVerifier({ header: SENTRY_HEADER.SIGNATURE, encoding: "hex" });

const OptionalText = Schema.optionalKey(Schema.NullOr(Schema.String));
const OptionalCount = Schema.optionalKey(
  Schema.NullOr(Schema.Union([Schema.String, Schema.Number])),
);

const InstallationSchema = Schema.Struct({ uuid: Schema.String });

/** A delivery as far as its installation is read. */
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

/** An issue alert as far as it is read. */
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

/** A new issue as far as it is read. */
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

/** A delivery read against the few fields it is read for; every other key Sentry sends is dropped unread. */
function readDelivery<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/** A value present and not blank, or nothing. */
function present(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length === 0 ? undefined : text;
}

/**
 * The key a delivery's run is recorded under: Sentry's `Request-ID`, the
 * same on its redelivery, as its SHA-256 so a key of any length fits; the
 * body's own digest where it sends none, so the same bytes are one run.
 */
function dedupeKeyOf(delivery: TriggerDelivery): string {
  const requestId = present(delivery.headers[SENTRY_HEADER.REQUEST_ID]);
  return requestId === undefined
    ? createHash("sha256").update(delivery.body).digest("hex")
    : createHash("sha256").update(requestId).digest("hex");
}

/** The project's slug an event's API address names (`/projects/<org>/<project>/events/`). */
function projectOfEventUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  return /\/projects\/[^/]+\/([^/]+)\/events\//u.exec(url)?.[1];
}

/** The issue's own page an event's page sits under (`…/issues/<id>/events/<event>/` to `…/issues/<id>/`). */
function issueUrlOfEventUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const issue = /^(.*\/issues\/[^/]+\/)events\//u.exec(url)?.[1];
  return issue ?? url;
}

/** A tag's value among an event's tags. */
function tagOf(tags: EventAlert["data"]["event"]["tags"], name: string): string | undefined {
  const found = (tags ?? []).find((tag) => tag[0] === name);
  return present(found?.[1]);
}

/** One frame as a summary names it: `function (file:line)`. */
function frameLine(frame: Frame): string {
  const where = present(frame.filename) ?? present(frame.module) ?? "?";
  const line = frame.lineno == null ? where : `${where}:${frame.lineno}`;
  const name = present(frame.function);
  return name === undefined ? line : `${name} (${line})`;
}

/** The in-app frames of the event's primary exception, innermost first, at most a few. */
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

/** One summary line where its value is present, the value cut to its bound. */
function field(label: string, value: string | number | null | undefined): readonly string[] {
  const text = present(value);
  return text === undefined ? [] : [`${label}: ${text.slice(0, SUMMARY_VALUE_CHARS)}`];
}

/** The lines joined, cut on a character to fit the summary's bound in UTF-8 bytes. */
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

/** An issue alert as the catalog's `alert-triggered`. */
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

/** A new issue as the catalog's `issue-created`. */
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

/** The resource and action a delivery names, and the installation it came through. */
function envelopeOf(delivery: TriggerDelivery) {
  const read = readDelivery(EnvelopeSchema, delivery.payload);
  if (Result.isFailure(read)) return undefined;
  return {
    resource: delivery.headers[SENTRY_HEADER.RESOURCE] ?? "",
    action: read.success.action,
    installation: read.success.installation.uuid,
  };
}

/** The Sentry integration's deliveries, as the trigger ingress reads them. */
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
      // An install is linked by the install flow, which holds the workspace it was asked for; only an uninstall is read here.
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

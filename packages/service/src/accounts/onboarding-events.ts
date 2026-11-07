/**
 * onboarding-events.ts -- an account's sign-up and task activity, told to Resend for its onboarding emails.
 *
 * The emails a new account is sent over its first two weeks are Resend's
 * automation, not the service's: it starts on the event `vespin.signed_up`,
 * stops for an account that accepts a workspace invitation within the hour
 * (`vespin.invite_accepted`), since that person joined someone else's work
 * rather than starting their own, and picks which note goes out on day 3, 7,
 * and 14 by three numbers kept on the account's Resend contact. The service
 * tells Resend those three things and nothing else:
 *
 * - At sign-up, from the auth route (`auth-app.ts`), the contact is made by
 *   its address alone (https://resend.com/docs/api-reference/contacts/create-contact),
 *   so a task made before the automation's first step has a contact to land
 *   on, and `vespin.signed_up` is sent with the greeting the automation's
 *   notes open with (`greetingOf`), the welcome email's own
 *   (https://resend.com/docs/api-reference/events/send-event).
 * - An invitation accepted, from the same route, sends `vespin.invite_accepted`.
 * - A task made through the one make every door shares
 *   (`task-create-relation.ts`) sets the contact's properties
 *   (https://resend.com/docs/api-reference/contacts/update-contact):
 *   `has_task`, 1 once the account has started a task; `task_days`, on how
 *   many days it started one; and `last_task_day`, the latest of those days.
 *   A day is counted from the sign-up, the first 24 hours being day 0, so
 *   day 14's "came back in its second week" reads `last_task_day` ≥ 7. They
 *   are read from every task the account started each time, not added up
 *   here, so a report lost to an outage is made whole by the next. An
 *   account with no task keeps Resend's fallbacks, 0, 0, and -1.
 * - An account deleted (`account-deletion.ts`) has its contact deleted
 *   (https://resend.com/docs/api-reference/contacts/delete-contact), so
 *   Resend keeps no address of an account the service no longer has, and the
 *   automation has no one left to write to.
 *
 * The deployment sends these where it sends the welcome email: under its
 * Resend key (`RESEND_API_KEY`) and only where it names the welcome's sender
 * (`WELCOME_FROM`), because the automation writes as that same founder, and
 * a Preview, which names none, must not start it for its test accounts.
 * Without either nothing is sent; the build says so once, by the variables'
 * names. All of it runs once the request has answered (`after-response.ts`),
 * and a call Resend refuses or never answers is logged by its status alone,
 * since each carries the account's address; the sign-up or the task stands
 * either way.
 */

import { Database, type DatabaseServices } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { task } from "@repo/database/schemas/task";
import { HTTP_METHOD, type HttpMethod } from "@repo/wire";
import { eq, sql } from "drizzle-orm";
import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { SqlSchema } from "effect/sql";
import { accountCall, callAnswered, fixedBearer } from "../core.js";
import { afterResponse } from "../http/after-response.js";
import { readAccountPerson } from "./account-person.js";
import { greetingOf, WELCOME_MAIL_ENVIRONMENT } from "./welcome-mail.js";

const RESEND = {
  BASE_URL: "https://api.resend.com",
  EVENTS_PATH: "/events/send",
  CONTACTS_PATH: "/contacts",
  /** Short, though nothing waits on it, so a stalled Resend does not hold the instance awake. */
  REQUEST_TIMEOUT_MS: 3_000,
} as const;

/** The events the automation listens for, as Resend names them. */
export const ONBOARDING_EVENT = {
  SIGNED_UP: "vespin.signed_up",
  INVITE_ACCEPTED: "vespin.invite_accepted",
} as const;

/** The contact's properties the automation's conditions read, as Resend names them. */
export const ONBOARDING_PROPERTY = {
  HAS_TASK: "has_task",
  TASK_DAYS: "task_days",
  LAST_TASK_DAY: "last_task_day",
} as const;

/** The one field of `vespin.signed_up`'s payload, as the event's schema in Resend names it. */
const SIGNED_UP_PAYLOAD = { GREETING: "greeting" } as const;

/** What the build says once where a variable is unset, by the variables' names alone. */
const EVENTS_UNSET = `${WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${WELCOME_MAIL_ENVIRONMENT.FROM} is not set, so sign-ups and task activity are not sent to Resend's onboarding emails.`;

const DAY_SECONDS = 24 * 60 * 60;

/** The account's tasks as the automation reads them: on how many days since its sign-up it started one, and the latest. */
interface TaskActivity {
  readonly days: number;
  readonly lastDay: number;
}

interface OnboardingEventsValues {
  /** Makes the new account's contact and starts its onboarding; never fails. */
  readonly signedUp: (email: string, name: string) => Effect.Effect<void>;
  /** Tells the onboarding the account joined a workspace it was invited to; never fails. */
  readonly inviteAccepted: (email: string) => Effect.Effect<void>;
  /** Sets the contact's task properties to what the account's tasks now say; never fails. */
  readonly taskActivity: (email: string, activity: TaskActivity) => Effect.Effect<void>;
  /** Deletes the contact of an account that was deleted; never fails. */
  readonly forget: (email: string) => Effect.Effect<void>;
}

/** The deployment's reporter to Resend's onboarding. Read optionally, so a runtime without one reports nothing. */
export class OnboardingEvents extends Context.Service<OnboardingEvents, OnboardingEventsValues>()(
  "OnboardingEvents",
) {}

/** The day of the sign-up a moment falls on, the first 24 hours being day 0. */
const dayOfSignUp = sql<number>`floor(extract(epoch from (${task.createdAt} - ${user.createdAt})) / ${DAY_SECONDS})`;

const ActivityRowSchema = Schema.Struct({
  days: Schema.Number,
  lastDay: Schema.NullOr(Schema.Number),
});

const findActivity = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: ActivityRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          days: sql<number>`count(distinct ${dayOfSignUp})::int`,
          lastDay: sql<number | null>`max(${dayOfSignUp})::int`,
        })
        .from(task)
        .innerJoin(user, eq(user.id, task.userId))
        .where(eq(task.userId, userId)),
    ),
});

/** The contact's own address at Resend, which names a contact by its email. */
function contactPath(email: string): string {
  return `${RESEND.CONTACTS_PATH}/${encodeURIComponent(email)}`;
}

/** A variable as the deployment holds it, trimmed, and nothing where it is unset or blank. */
function presentText(value: Option.Option<string>): string | undefined {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The reporter over Resend, once the deployment names the key and the
 * welcome's sender, read as the services are built; one that sends nothing
 * otherwise.
 */
export const onboardingEventsFromEnvironment: Layer.Layer<
  OnboardingEvents,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  OnboardingEvents,
  Effect.gen(function* () {
    const read = yield* Config.all({
      key: Config.option(Config.Redacted(WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY)),
      from: Config.option(Config.String(WELCOME_MAIL_ENVIRONMENT.FROM)),
    }).pipe(Effect.orElseSucceed(() => ({ key: Option.none(), from: Option.none() })));
    const key = presentText(Option.map(read.key, Redacted.value));
    if (key === undefined || presentText(read.from) === undefined) {
      yield* Effect.logWarning(EVENTS_UNSET);
      return {
        signedUp: () => Effect.void,
        inviteAccepted: () => Effect.void,
        taskActivity: () => Effect.void,
        forget: () => Effect.void,
      };
    }
    const client = yield* HttpClient.HttpClient;
    const call = accountCall({
      baseUrl: RESEND.BASE_URL,
      credential: fixedBearer(key),
      requestTimeoutMs: RESEND.REQUEST_TIMEOUT_MS,
    });
    // One call, whose refusal is logged by what was asked and its status alone, because the body carries the address.
    const send = (asked: string, method: HttpMethod, path: string, body?: object) =>
      Effect.gen(function* () {
        const answer = yield* call.send({
          method,
          path,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (callAnswered(answer) && answer.response.ok) return;
        yield* Effect.logWarning(
          callAnswered(answer)
            ? `Onboarding ${asked} refused with status ${answer.response.status}`
            : `Onboarding ${asked} did not reach Resend`,
        );
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));
    const sendEvent = (event: string, email: string, payload: Record<string, string>) =>
      send(event, HTTP_METHOD.POST, RESEND.EVENTS_PATH, { event, email, payload });
    return {
      signedUp: (email: string, name: string) =>
        Effect.andThen(
          send("contact", HTTP_METHOD.POST, RESEND.CONTACTS_PATH, { email }),
          sendEvent(ONBOARDING_EVENT.SIGNED_UP, email, {
            [SIGNED_UP_PAYLOAD.GREETING]: greetingOf(name),
          }),
        ),
      inviteAccepted: (email: string) => sendEvent(ONBOARDING_EVENT.INVITE_ACCEPTED, email, {}),
      taskActivity: (email: string, activity: TaskActivity) =>
        send("task activity", HTTP_METHOD.PATCH, contactPath(email), {
          properties: {
            [ONBOARDING_PROPERTY.HAS_TASK]: 1,
            [ONBOARDING_PROPERTY.TASK_DAYS]: activity.days,
            [ONBOARDING_PROPERTY.LAST_TASK_DAY]: activity.lastDay,
          },
        }),
      forget: (email: string) => send("contact delete", HTTP_METHOD.DELETE, contactPath(email)),
    };
  }),
);

/**
 * Reports, once the request has answered, to the account's onboarding, read
 * from the account's own row; nothing for a runtime without a reporter or an
 * account no longer there, and a read that fails is logged by its kind alone.
 */
function reportOf(
  label: string,
  userId: string,
  report: (
    events: OnboardingEventsValues,
    person: { readonly email: string; readonly name: string },
  ) => Effect.Effect<void, unknown, DatabaseServices>,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(Effect.serviceOption(OnboardingEvents), (events) =>
    Option.isNone(events)
      ? Effect.void
      : afterResponse(
          label,
          Effect.gen(function* () {
            const person = yield* readAccountPerson(userId);
            if (person === undefined) return;
            yield* report(events.value, person);
          }),
        ),
  );
}

/** Starts the onboarding of the account that just signed up. */
export function signUpReported(userId: string): Effect.Effect<void, never, DatabaseServices> {
  return reportOf("Onboarding sign-up", userId, (events, person) =>
    events.signedUp(person.email, person.name),
  );
}

/** Tells the onboarding the account accepted an invitation. */
export function inviteAcceptReported(userId: string): Effect.Effect<void, never, DatabaseServices> {
  return reportOf("Onboarding invitation", userId, (events, person) =>
    events.inviteAccepted(person.email),
  );
}

/** Sets the account's task properties from every task it has started, once one more was made. */
export function taskActivityReported(userId: string): Effect.Effect<void, never, DatabaseServices> {
  return reportOf("Onboarding task activity", userId, (events, person) =>
    Effect.gen(function* () {
      const activity = Option.getOrUndefined(yield* findActivity(userId));
      if (activity === undefined || activity.lastDay === null) return;
      yield* events.taskActivity(person.email, { days: activity.days, lastDay: activity.lastDay });
    }),
  );
}

/**
 * Deletes the onboarding contact of an account already deleted, by the
 * address read before it went; nothing for a runtime without a reporter.
 * Note that it runs at once rather than after the answer, because the
 * deletion's request is still open and nothing after it names the address.
 */
export function onboardingForgotten(email: string): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(OnboardingEvents), (events) =>
    Option.isNone(events) ? Effect.void : events.value.forget(email),
  );
}

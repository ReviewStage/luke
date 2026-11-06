/**
 * welcome-mail.ts -- a founder's note emailed to a new account as it signs up, through Resend.
 *
 * An account the auth route signed up (`auth-app.ts`) is sent one short note
 * from Charles, one of the founders, the way a person writes one: plain
 * words, no card, button, or brand, its HTML only the same paragraphs, so it
 * reads as a letter and a reply reaches him. One POST to Resend's `/emails`
 * (https://resend.com/docs/api-reference/emails/send-email), to the new
 * account's address alone, greeting them by the first word of their name,
 * or with no name where their account has none. Resend holds it for an hour
 * (`scheduled_at`) before it goes out, so it lands as a note written after
 * they have had a look around rather than an instant receipt of the sign-up.
 *
 * The deployment holds the Resend key (`RESEND_API_KEY`, the one invitations
 * and the feedback form send with) and the sender (`WELCOME_FROM`, such as
 * `Charles Pan <charles@…>` on a domain Resend has verified), which replies
 * go to. Without either nothing is mailed; the build says so once, by the
 * variables' names. A send Resend refuses or never answers leaves the
 * sign-up standing and is logged by its status alone, since the letter
 * carries the new account's address.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD } from "@repo/wire";
import { Clock, Config, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, fixedBearer } from "../core.js";
import { INVITATION_MAIL_ENVIRONMENT } from "./invitation-mail.js";

/** The deployment's variables the sender is read from: the Resend key invitations send with, and the address the note comes from. */
export const WELCOME_MAIL_ENVIRONMENT = {
  RESEND_API_KEY: INVITATION_MAIL_ENVIRONMENT.RESEND_API_KEY,
  FROM: "WELCOME_FROM",
} as const;

const RESEND = {
  BASE_URL: "https://api.resend.com",
  EMAILS_PATH: "/emails",
  /** Short, since the sign-up's answer waits on it. */
  REQUEST_TIMEOUT_MS: 3_000,
  /** How long after the sign-up Resend sends the note. */
  SEND_DELAY_MS: 60 * 60 * 1_000,
} as const;

/** What the build says once where a variable is unset, by the variables' names alone. */
const MAIL_UNSET = `${WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${WELCOME_MAIL_ENVIRONMENT.FROM} is not set, so new accounts are not sent a welcome email.`;

/** The note's paragraphs after the greeting, as Charles wrote them. */
const WELCOME_PARAGRAPHS = [
  `I'm Charles, one of the founders of ${PRODUCT_NAME}. Thanks so much for signing up! It really means a lot to us.`,
  "I'd love to hear what you think after you get the chance to try it out. If you have a question, get stuck, or just want to say hi, reply to this email. I read and answer every one.",
] as const;

const SIGN_OFF = ["Best -", "Charles"] as const;

/** One new account as its note addresses it. */
export interface WelcomeLetter {
  /** The new account's address, the email's one recipient. */
  readonly email: string;
  /** The account's name as its sign-in gave it; empty where it has none. */
  readonly name: string;
}

interface WelcomeMailValues {
  /** Emails one new account its note; never fails, since the sign-up stands either way. */
  readonly send: (letter: WelcomeLetter) => Effect.Effect<void>;
}

/** The deployment's sender of welcome emails. Read optionally, so a runtime without one emails nothing. */
export class WelcomeMail extends Context.Service<WelcomeMail, WelcomeMailValues>()("WelcomeMail") {}

/** Text set into the email's HTML, its markup characters spelled as entities. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** "Hey Ada," for an account named "Ada Lovelace", and "Hey," for one with no name. */
function greetingOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Hey," : `Hey ${first},`;
}

/** The note for one new account: its subject, its plain text, and HTML that is the same paragraphs. */
function welcomeEmail(letter: WelcomeLetter) {
  const subject = `Welcome to ${PRODUCT_NAME}!`;
  const paragraphs = [greetingOf(letter.name), ...WELCOME_PARAGRAPHS];
  const text = [...paragraphs, SIGN_OFF.join("\n")].join("\n\n");
  const html = [
    ...paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p>${SIGN_OFF.map(escapeHtml).join("<br>")}</p>`,
  ].join("\n");
  return { subject, text, html };
}

/** A variable as the deployment holds it, trimmed, and nothing where it is unset or blank. */
function presentText(value: Option.Option<string>): string | undefined {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The sender over Resend, once the deployment names both its key and its
 * address, read as the services are built; one that sends nothing otherwise.
 */
export const welcomeMailFromEnvironment: Layer.Layer<WelcomeMail, never, HttpClient.HttpClient> =
  Layer.effect(
    WelcomeMail,
    Effect.gen(function* () {
      const read = yield* Config.all({
        key: Config.option(Config.Redacted(WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY)),
        from: Config.option(Config.String(WELCOME_MAIL_ENVIRONMENT.FROM)),
      }).pipe(Effect.orElseSucceed(() => ({ key: Option.none(), from: Option.none() })));
      const key = presentText(Option.map(read.key, Redacted.value));
      const from = presentText(read.from);
      if (key === undefined || from === undefined) {
        yield* Effect.logWarning(MAIL_UNSET);
        return { send: () => Effect.void };
      }
      const client = yield* HttpClient.HttpClient;
      const call = accountCall({
        baseUrl: RESEND.BASE_URL,
        credential: fixedBearer(key),
        requestTimeoutMs: RESEND.REQUEST_TIMEOUT_MS,
      });
      return {
        send: (letter: WelcomeLetter) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const scheduledAt = new Date(now + RESEND.SEND_DELAY_MS).toISOString();
            const answer = yield* call.send({
              method: HTTP_METHOD.POST,
              path: RESEND.EMAILS_PATH,
              body: JSON.stringify({
                from,
                to: [letter.email],
                scheduled_at: scheduledAt,
                ...welcomeEmail(letter),
              }),
            });
            if (callAnswered(answer) && answer.response.ok) return;
            // Note that the status alone is logged, because the letter carries the new account's address.
            yield* Effect.logWarning(
              callAnswered(answer)
                ? `Welcome email refused with status ${answer.response.status}`
                : "Welcome email did not reach Resend",
            );
          }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
      };
    }),
  );

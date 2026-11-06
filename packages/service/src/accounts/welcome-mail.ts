import { PRODUCT_NAME } from "@repo/features/product-name";
import { HTTP_METHOD } from "@repo/wire";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, fixedBearer } from "../core.js";
import { INVITATION_MAIL_ENVIRONMENT } from "./invitation-mail.js";

export const WELCOME_MAIL_ENVIRONMENT = {
  RESEND_API_KEY: INVITATION_MAIL_ENVIRONMENT.RESEND_API_KEY,
  FROM: "WELCOME_FROM",
} as const;

const RESEND = {
  BASE_URL: "https://api.resend.com",
  EMAILS_PATH: "/emails",
  REQUEST_TIMEOUT_MS: 3_000,
} as const;

const MAIL_UNSET = `${WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${WELCOME_MAIL_ENVIRONMENT.FROM} is not set, so new accounts are not sent a welcome email.`;

const WELCOME_PARAGRAPHS = [
  `I'm Charles, one of the founders of ${PRODUCT_NAME}. Thanks so much for signing up! It really means a lot to us.`,
  "I'd love to hear what you think after you get the chance to try it out. If you have a question, get stuck, or just want to say hi, reply to this email. I read and answer every one.",
] as const;

const SIGN_OFF = ["Best -", "Charles"] as const;

export interface WelcomeLetter {
  readonly email: string;
  readonly name: string;
}

interface WelcomeMailValues {
  readonly send: (letter: WelcomeLetter) => Effect.Effect<void>;
}

export class WelcomeMail extends Context.Service<WelcomeMail, WelcomeMailValues>()("WelcomeMail") {}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function greetingOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Hey," : `Hey ${first},`;
}

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

function presentText(value: Option.Option<string>): string | undefined {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed === "" ? undefined : trimmed;
}

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
            const answer = yield* call.send({
              method: HTTP_METHOD.POST,
              path: RESEND.EMAILS_PATH,
              body: JSON.stringify({ from, to: [letter.email], ...welcomeEmail(letter) }),
            });
            if (callAnswered(answer) && answer.response.ok) return;
            yield* Effect.logWarning(
              callAnswered(answer)
                ? `Welcome email refused with status ${answer.response.status}`
                : "Welcome email did not reach Resend",
            );
          }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
      };
    }),
  );

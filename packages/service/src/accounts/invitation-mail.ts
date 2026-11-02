/**
 * invitation-mail.ts -- a workspace invitation emailed to the address it was made for, through Resend.
 *
 * An invitation an owner or an admin makes from Settings is mailed to the
 * invited address as it is made (`workspace-invitations-procedures.ts`), as
 * ReviewStage/stage mailed its teammate invitations: one POST to Resend's
 * `/emails` (https://resend.com/docs/api-reference/emails/send-email) from
 * the sender the deployment names, to the invited address alone, saying who
 * invited them to which workspace, with a button and the bare link to the
 * accept page. Nothing is mailed when an invitation is canceled, and an
 * address already invited is refused before anything is sent, as stage did.
 *
 * The deployment holds the Resend key (`RESEND_API_KEY`, the one the
 * feedback form sends with) and the sender (`INVITE_FROM`, such as
 * `Name <invites@…>` on a domain Resend has verified). Without either,
 * nothing is mailed and the invitation is made as before, its link copied by
 * hand; the build says so once, by the variables' names. A send Resend
 * refuses or never answers leaves the invitation standing, since the link
 * the owner can copy is the one the email carries, and is logged by its
 * status alone: the key is revealed into the bearer header alone, and
 * nothing of the letter, the address least of all, is logged.
 */

import { PRODUCT_NAME } from "@luke/features/product-name";
import { HTTP_METHOD } from "@luke/wire";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, fixedBearer } from "../core.js";

/** The deployment's variables the sender is read from: the feedback form's Resend key, and the address invitations come from. */
export const INVITATION_MAIL_ENVIRONMENT = {
  RESEND_API_KEY: "RESEND_API_KEY",
  FROM: "INVITE_FROM",
} as const;

const RESEND = {
  BASE_URL: "https://api.resend.com",
  EMAILS_PATH: "/emails",
  /** Inside the Mac's own wait for the invite's answer, so a slow Resend still answers the invitation made. */
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

/** The app's icon on the service's own site, which the email shows above its heading. */
const ICON_PATH = "/app-icon-192.png";

/** What the build says once where a variable is unset, by the variables' names alone. */
const MAIL_UNSET = `${INVITATION_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${INVITATION_MAIL_ENVIRONMENT.FROM} is not set, so workspace invitations are not emailed: each one's link is copied by hand.`;

/** The email's dark card, as stage's invitation drew it; an email client takes inline styles alone. */
const EMAIL_STYLE = {
  BODY: "background-color:#131313;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:32px 16px",
  CONTAINER: "margin:0 auto;max-width:560px;width:100%",
  CARD: "background-color:#1f1f1f;border:1px solid rgba(255,255,255,0.06);border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,0.28);padding:40px",
  ICON: "display:block;margin-bottom:24px;width:40px;height:40px;border:0",
  HEADING:
    "color:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:24px;font-weight:400;letter-spacing:-0.01em;line-height:1.3;margin:0 0 20px",
  BUTTON:
    "display:inline-block;background-color:#ffffff;border-radius:6px;color:#171717;font-size:15px;font-weight:600;padding:12px 20px;text-decoration:none",
  FALLBACK_LABEL: "color:#b3b3b3;font-size:13px;line-height:1.6;margin:24px 0 8px",
  FALLBACK_LINK:
    "color:#5a9f79;font-size:13px;line-height:1.6;text-decoration:underline;word-break:break-all",
} as const;

/** One invitation as its email tells it. */
export interface InvitationLetter {
  /** The address invited, the email's one recipient. */
  readonly email: string;
  /** The accept page's address for this invitation, on the service's own origin. */
  readonly acceptUrl: string;
  readonly workspaceName: string;
  /** Who invited them: their name, or their address where their account has no name. */
  readonly inviterLabel: string;
}

interface InvitationMailValues {
  /** Emails one invitation to its address; never fails, since the invitation stands either way. */
  readonly send: (letter: InvitationLetter) => Effect.Effect<void>;
}

/** The deployment's sender of invitation emails. Read optionally, so a runtime without one emails nothing. */
export class InvitationMail extends Context.Service<InvitationMail, InvitationMailValues>()(
  "InvitationMail",
) {}

/** Text set into the email's HTML, its markup characters spelled as entities. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The email for one invitation: its subject, its HTML, and the plain text that says the same. */
function invitationEmail(letter: InvitationLetter) {
  const { acceptUrl, workspaceName, inviterLabel } = letter;
  const subject = `You're invited to join ${workspaceName} on ${PRODUCT_NAME}`;
  const heading = `${inviterLabel} invited you to join ${workspaceName} on ${PRODUCT_NAME}.`;
  const fallback = "Or paste this link into your browser:";
  const link = escapeHtml(acceptUrl);
  const icon = escapeHtml(new URL(ICON_PATH, acceptUrl).href);
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark"></head>',
    `<body style="${EMAIL_STYLE.BODY}">`,
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(heading)}</div>`,
    `<div style="${EMAIL_STYLE.CONTAINER}"><div style="${EMAIL_STYLE.CARD}">`,
    `<img src="${icon}" alt="${escapeHtml(PRODUCT_NAME)}" width="40" height="40" style="${EMAIL_STYLE.ICON}">`,
    `<h1 style="${EMAIL_STYLE.HEADING}">${escapeHtml(inviterLabel)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on ${escapeHtml(PRODUCT_NAME)}.</h1>`,
    `<a href="${link}" style="${EMAIL_STYLE.BUTTON}">Accept invitation</a>`,
    `<p style="${EMAIL_STYLE.FALLBACK_LABEL}">${fallback}</p>`,
    `<a href="${link}" style="${EMAIL_STYLE.FALLBACK_LINK}">${link}</a>`,
    "</div></div></body></html>",
  ].join("\n");
  const text = [heading, "", `Accept invitation: ${acceptUrl}`, "", fallback, "", acceptUrl].join(
    "\n",
  );
  return { subject, html, text };
}

/** Resend's send-email body for one invitation, from `from`. */
function resendBody(letter: InvitationLetter, from: string): string {
  return JSON.stringify({ from, to: [letter.email], ...invitationEmail(letter) });
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
export const invitationMailFromEnvironment: Layer.Layer<
  InvitationMail,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  InvitationMail,
  Effect.gen(function* () {
    const read = yield* Config.all({
      key: Config.option(Config.Redacted(INVITATION_MAIL_ENVIRONMENT.RESEND_API_KEY)),
      from: Config.option(Config.String(INVITATION_MAIL_ENVIRONMENT.FROM)),
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
      send: (letter: InvitationLetter) =>
        Effect.gen(function* () {
          const answer = yield* call.send({
            method: HTTP_METHOD.POST,
            path: RESEND.EMAILS_PATH,
            body: resendBody(letter, from),
          });
          if (callAnswered(answer) && answer.response.ok) return;
          // Note that the status alone is logged, because the letter carries the invitee's address.
          yield* Effect.logWarning(
            callAnswered(answer)
              ? `Invitation email refused with status ${answer.response.status}`
              : "Invitation email did not reach Resend",
          );
        }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    };
  }),
);

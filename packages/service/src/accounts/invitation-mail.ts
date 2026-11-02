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

/**
 * The email's look, inline, since an email client takes inline styles alone:
 * a light letter by default, which the dark-mode block below turns dark where
 * the client honours `prefers-color-scheme`. The layout is tables, which
 * every client, Outlook's Word engine among them, draws the same.
 */
const EMAIL_STYLE = {
  BODY: "background-color:#f4f4f3;margin:0;padding:0;-webkit-text-size-adjust:100%",
  OUTER: "background-color:#f4f4f3;padding:40px 16px",
  CARD: "background-color:#ffffff;border:1px solid #e4e3e1;border-radius:12px",
  CARD_CELL: "padding:40px 40px 32px",
  FONT: "font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  ICON: "display:block;width:40px;height:40px;border:0;border-radius:10px;outline:none",
  HEADING:
    "color:#161615;font-size:22px;font-weight:600;letter-spacing:-0.01em;line-height:1.35;margin:28px 0 12px",
  LEAD: "color:#646361;font-size:15px;line-height:1.6;margin:0 0 28px",
  BUTTON_CELL: "background-color:#161615;border-radius:8px",
  BUTTON:
    "display:inline-block;color:#ffffff;font-size:15px;font-weight:600;line-height:20px;padding:12px 22px;text-decoration:none;border-radius:8px",
  FALLBACK_LABEL: "color:#646361;font-size:13px;line-height:1.6;margin:28px 0 4px",
  FALLBACK_LINK:
    "color:#161615;font-size:13px;line-height:1.6;text-decoration:underline;word-break:break-all",
  RULE: "border:0;border-top:1px solid #ecebe9;margin:32px 0 20px",
  FOOTNOTE: "color:#8a8987;font-size:12px;line-height:1.6;margin:0",
  SIGNATURE: "color:#8a8987;font-size:12px;line-height:1.6;margin:16px 0 0;text-align:center",
} as const;

/**
 * The same letter where the reader's client is dark: classes the light inline
 * styles carry, overridden here, which a client that ignores `<style>` never
 * reads and so leaves light.
 */
const DARK_STYLE = [
  "@media (prefers-color-scheme: dark) {",
  ".v-body, .v-outer { background-color:#121211 !important; }",
  ".v-card { background-color:#1a1918 !important; border-color:#2a2a29 !important; }",
  ".v-heading, .v-link { color:#f3f2ef !important; }",
  ".v-muted { color:#a3a3a2 !important; }",
  ".v-button-cell { background-color:#f3f2ef !important; }",
  ".v-button { color:#121211 !important; }",
  ".v-rule { border-top-color:#2a2a29 !important; }",
  "}",
].join("\n");

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
  const { email, acceptUrl, workspaceName, inviterLabel } = letter;
  const subject = `You're invited to join ${workspaceName} on ${PRODUCT_NAME}`;
  const heading = `${inviterLabel} invited you to join ${workspaceName} on ${PRODUCT_NAME}.`;
  const lead = `${PRODUCT_NAME} is where your team works each task through with coding agents, from the plan to the merged pull request.`;
  const fallback = "Or paste this link into your browser:";
  const footnote = `This invitation was sent to ${email}. If you weren't expecting it, you can ignore this email.`;
  const link = escapeHtml(acceptUrl);
  const site = new URL("/", acceptUrl);
  const icon = escapeHtml(new URL(ICON_PATH, acceptUrl).href);
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(subject)}</title><style>${DARK_STYLE}</style></head>`,
    `<body class="v-body" style="${EMAIL_STYLE.BODY}">`,
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(heading)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="v-outer" style="${EMAIL_STYLE.OUTER}"><tr><td align="center">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">',
    `<tr><td class="v-card" style="${EMAIL_STYLE.CARD}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${EMAIL_STYLE.CARD_CELL};${EMAIL_STYLE.FONT}">`,
    `<img src="${icon}" alt="${escapeHtml(PRODUCT_NAME)}" width="40" height="40" style="${EMAIL_STYLE.ICON}">`,
    `<h1 class="v-heading" style="${EMAIL_STYLE.HEADING};${EMAIL_STYLE.FONT}">${escapeHtml(inviterLabel)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on ${escapeHtml(PRODUCT_NAME)}</h1>`,
    `<p class="v-muted" style="${EMAIL_STYLE.LEAD};${EMAIL_STYLE.FONT}">${escapeHtml(lead)}</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="v-button-cell" style="${EMAIL_STYLE.BUTTON_CELL}">`,
    `<a href="${link}" class="v-button" style="${EMAIL_STYLE.BUTTON};${EMAIL_STYLE.FONT}">Accept invitation</a>`,
    "</td></tr></table>",
    `<p class="v-muted" style="${EMAIL_STYLE.FALLBACK_LABEL};${EMAIL_STYLE.FONT}">${fallback}</p>`,
    `<a href="${link}" class="v-link" style="${EMAIL_STYLE.FALLBACK_LINK};${EMAIL_STYLE.FONT}">${link}</a>`,
    `<hr class="v-rule" style="${EMAIL_STYLE.RULE}">`,
    `<p class="v-muted" style="${EMAIL_STYLE.FOOTNOTE};${EMAIL_STYLE.FONT}">${escapeHtml(footnote)}</p>`,
    "</td></tr></table></td></tr>",
    `<tr><td class="v-muted" style="${EMAIL_STYLE.SIGNATURE};${EMAIL_STYLE.FONT}">${escapeHtml(PRODUCT_NAME)} · <a href="${escapeHtml(site.href)}" class="v-muted" style="color:#8a8987;text-decoration:none">${escapeHtml(site.host)}</a></td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("\n");
  const text = [
    heading,
    "",
    lead,
    "",
    `Accept invitation: ${acceptUrl}`,
    "",
    fallback,
    "",
    acceptUrl,
    "",
    footnote,
  ].join("\n");
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

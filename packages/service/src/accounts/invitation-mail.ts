import { BRAND_PALETTE } from "@repo/brand";
import { githubAvatarAt } from "@repo/features/account-picture";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  INVITATION_ROLE,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { HTTP_METHOD } from "@repo/wire";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { accountCall, callAnswered, fixedBearer } from "../core.js";

export const INVITATION_MAIL_ENVIRONMENT = {
  RESEND_API_KEY: "RESEND_API_KEY",
  FROM: "INVITE_FROM",
} as const;

const RESEND = {
  BASE_URL: "https://api.resend.com",
  EMAILS_PATH: "/emails",
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

const MAIL_UNSET = `${INVITATION_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${INVITATION_MAIL_ENVIRONMENT.FROM} is not set, so workspace invitations are not emailed: each one's link is copied by hand.`;

const MAIL_PALETTE = {
  LIGHT: {
    GROUND: BRAND_PALETTE.LIGHT.SIDEBAR,
    SURFACE: BRAND_PALETTE.LIGHT.OVERLAY,
    EDGE: BRAND_PALETTE.LIGHT.CHIP_EDGE,
    TEXT: BRAND_PALETTE.LIGHT.TEXT,
    TEXT_MUTED: BRAND_PALETTE.LIGHT.TEXT_MUTED,
    ACCENT: BRAND_PALETTE.LIGHT.ACCENT,
    ON_ACCENT: BRAND_PALETTE.LIGHT.ON_ACCENT,
  },
  DARK: {
    GROUND: BRAND_PALETTE.DARK.SIDEBAR,
    SURFACE: BRAND_PALETTE.DARK.OVERLAY,
    EDGE: BRAND_PALETTE.DARK.CHIP_EDGE,
    TEXT: BRAND_PALETTE.DARK.TEXT,
    TEXT_MUTED: BRAND_PALETTE.DARK.TEXT_MUTED,
    ACCENT: BRAND_PALETTE.DARK.ACCENT,
    ON_ACCENT: BRAND_PALETTE.DARK.ON_ACCENT,
  },
} as const;

const LIGHT = MAIL_PALETTE.LIGHT;
const DARK = MAIL_PALETTE.DARK;

const PICTURE_SIDE = { WORKSPACE: 48, INVITER: 20 } as const;

const PICTURE_DENSITY = 2;

const EMAIL_STYLE = {
  BODY: `background-color:${LIGHT.GROUND};margin:0;padding:0;-webkit-text-size-adjust:100%`,
  OUTER: `background-color:${LIGHT.GROUND};padding:48px 20px`,
  CARD: `background-color:${LIGHT.SURFACE};border:1px solid ${LIGHT.EDGE};border-radius:16px;padding:40px`,
  FONT: "font-family:Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  HEADING: `color:${LIGHT.TEXT};font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:1.3;margin:0`,
  HEADING_FONT:
    "font-family:'Bricolage Grotesque',Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  PICTURE_CELL: "padding:0 0 24px",
  PICTURE: "display:block;border:0;outline:none",
  TILE: `background-color:${LIGHT.TEXT};color:${LIGHT.SURFACE};font-size:20px;font-weight:600;text-align:center`,
  DISC: `background-color:${LIGHT.EDGE};color:${LIGHT.TEXT_MUTED};font-size:10px;font-weight:600;text-align:center`,
  BYLINE_CELL: "padding:12px 0 0",
  BYLINE: `color:${LIGHT.TEXT_MUTED};font-size:15px;line-height:20px;padding-left:8px;vertical-align:middle`,
  BUTTON_ROW: "padding:28px 0 0",
  BUTTON_CELL: `background-color:${LIGHT.ACCENT};border-radius:10px`,
  BUTTON: `display:inline-block;color:${LIGHT.ON_ACCENT};font-size:15px;font-weight:600;line-height:20px;padding:12px 24px;text-decoration:none;border-radius:10px`,
  EXPIRY: `color:${LIGHT.TEXT_MUTED};font-size:13px;line-height:1.6;padding:16px 0 0`,
  FOOTER: `color:${LIGHT.TEXT_MUTED};font-size:12px;line-height:1.6;padding:24px 4px 0;text-align:center`,
  FOOTER_LINK: `color:${LIGHT.TEXT_MUTED};text-decoration:none`,
} as const;

const DARK_STYLE = [
  "@media (prefers-color-scheme: dark) {",
  `.v-body, .v-outer { background-color:${DARK.GROUND} !important; }`,
  `.v-card { background-color:${DARK.SURFACE} !important; border-color:${DARK.EDGE} !important; }`,
  `.v-tile { background-color:${DARK.TEXT} !important; color:${DARK.GROUND} !important; }`,
  `.v-disc { background-color:${DARK.EDGE} !important; color:${DARK.TEXT_MUTED} !important; }`,
  `.v-heading { color:${DARK.TEXT} !important; }`,
  `.v-muted { color:${DARK.TEXT_MUTED} !important; }`,
  `.v-button-cell { background-color:${DARK.ACCENT} !important; }`,
  `.v-button { color:${DARK.ON_ACCENT} !important; }`,
  "}",
].join("\n");

export interface InvitationLetter {
  readonly email: string;
  readonly acceptUrl: string;
  readonly workspaceName: string;
  readonly inviterLabel: string;
  readonly role: WorkspaceInvitation["role"];
  readonly expiresAt: string;
  readonly workspacePictureUrl?: string;
  readonly inviterPictureUrl?: string;
}

interface InvitationMailValues {
  readonly send: (letter: InvitationLetter) => Effect.Effect<void>;
}

export class InvitationMail extends Context.Service<InvitationMail, InvitationMailValues>()(
  "InvitationMail",
) {}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const ROLE_WORDS = {
  [INVITATION_ROLE.MEMBER]: "a member",
  [INVITATION_ROLE.ADMIN]: "an admin",
} as const satisfies Record<WorkspaceInvitation["role"], string>;

const EXPIRY_DAY = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function table(cells: string, style = ""): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${style === "" ? "" : ` style="${style}"`}><tr>${cells}</tr></table>`;
}

function initialOf(name: string): string {
  return escapeHtml(Array.from(name.trim())[0]?.toUpperCase() ?? "");
}

function picture(
  url: string | undefined,
  alt: string,
  side: number,
  radius: number,
  stand: { readonly initial: string; readonly className: string; readonly style: string },
): string {
  const box = `width:${side}px;height:${side}px;border-radius:${radius}px`;
  if (url !== undefined) {
    const src = escapeHtml(githubAvatarAt(url, side * PICTURE_DENSITY));
    return `<img src="${src}" alt="${escapeHtml(alt)}" width="${side}" height="${side}" style="${EMAIL_STYLE.PICTURE};${box}">`;
  }
  return table(
    `<td class="${stand.className}" width="${side}" height="${side}" style="${stand.style};${box};line-height:${side}px;${EMAIL_STYLE.FONT}">${stand.initial}</td>`,
  );
}

function invitationEmail(letter: InvitationLetter) {
  const { email, acceptUrl, workspaceName, inviterLabel, role, expiresAt } = letter;
  const subject = `You're invited to join ${workspaceName} on ${PRODUCT_NAME}`;
  const preheader = `${inviterLabel} invited you to join ${workspaceName} on ${PRODUCT_NAME}.`;
  const heading = `Join ${workspaceName} on ${PRODUCT_NAME}`;
  const byline = `${inviterLabel} invited you as ${ROLE_WORDS[role]}.`;
  const expiry = `Expires ${EXPIRY_DAY.format(Date.parse(expiresAt))}.`;
  const footnote = `Sent to ${email}. Not expecting it? You can ignore this email.`;
  const font = EMAIL_STYLE.FONT;
  const link = escapeHtml(acceptUrl);
  const site = new URL("/", acceptUrl);
  const workspacePicture = picture(
    letter.workspacePictureUrl,
    workspaceName,
    PICTURE_SIDE.WORKSPACE,
    12,
    { initial: initialOf(workspaceName), className: "v-tile", style: EMAIL_STYLE.TILE },
  );
  const inviterPicture = picture(
    letter.inviterPictureUrl,
    "",
    PICTURE_SIDE.INVITER,
    PICTURE_SIDE.INVITER / 2,
    { initial: initialOf(inviterLabel), className: "v-disc", style: EMAIL_STYLE.DISC },
  );
  const html = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(subject)}</title><style>${DARK_STYLE}</style></head>`,
    `<body class="v-body" style="${EMAIL_STYLE.BODY}">`,
    `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="v-outer" style="${EMAIL_STYLE.OUTER}"><tr><td align="center">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">',
    `<tr><td class="v-card" style="${EMAIL_STYLE.CARD}">`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    `<tr><td style="${EMAIL_STYLE.PICTURE_CELL}">${workspacePicture}</td></tr>`,
    `<tr><td><h1 class="v-heading" style="${EMAIL_STYLE.HEADING};${EMAIL_STYLE.HEADING_FONT}">${escapeHtml(heading)}</h1></td></tr>`,
    `<tr><td style="${EMAIL_STYLE.BYLINE_CELL}">${table(
      `<td width="${PICTURE_SIDE.INVITER}" style="vertical-align:middle">${inviterPicture}</td><td class="v-muted" style="${EMAIL_STYLE.BYLINE};${font}">${escapeHtml(byline)}</td>`,
    )}</td></tr>`,
    `<tr><td style="${EMAIL_STYLE.BUTTON_ROW}">${table(
      `<td class="v-button-cell" style="${EMAIL_STYLE.BUTTON_CELL}"><a href="${link}" class="v-button" style="${EMAIL_STYLE.BUTTON};${font}">Accept invitation</a></td>`,
    )}</td></tr>`,
    `<tr><td class="v-muted" style="${EMAIL_STYLE.EXPIRY};${font}">${escapeHtml(expiry)}</td></tr>`,
    "</table></td></tr>",
    `<tr><td class="v-muted" style="${EMAIL_STYLE.FOOTER};${font}">${escapeHtml(footnote)}<br>${escapeHtml(PRODUCT_NAME)} · <a href="${escapeHtml(site.href)}" class="v-muted" style="${EMAIL_STYLE.FOOTER_LINK}">${escapeHtml(site.host)}</a></td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("\n");
  const text = [
    `${heading}.`,
    "",
    byline,
    "",
    `Accept invitation: ${acceptUrl}`,
    "",
    expiry,
    "",
    footnote,
  ].join("\n");
  return { subject, html, text };
}

function resendBody(letter: InvitationLetter, from: string): string {
  return JSON.stringify({ from, to: [letter.email], ...invitationEmail(letter) });
}

function presentText(value: Option.Option<string>): string | undefined {
  const trimmed = Option.getOrUndefined(value)?.trim();
  return trimmed === "" ? undefined : trimmed;
}

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
          yield* Effect.logWarning(
            callAnswered(answer)
              ? `Invitation email refused with status ${answer.response.status}`
              : "Invitation email did not reach Resend",
          );
        }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    };
  }),
);

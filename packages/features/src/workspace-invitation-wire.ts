import { Schema as EffectSchema, Option } from "effect";
import { workspaceIdSchema } from "./task-wire.js";
import { ASSIGNABLE_ROLE } from "./workspace-wire.js";

const INVITATION_ACCEPT_PAGE = {
  PATH: "/accept-invitation",
  ID_PARAM: "id",
  EMAIL_PARAM: "email",
} as const;

export interface InvitationAcceptQuery {
  readonly id: string | undefined;
  readonly email: string | undefined;
}

export function invitationAcceptUrl(origin: string, invitationId: string, email: string): string {
  const url = new URL(INVITATION_ACCEPT_PAGE.PATH, origin);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.ID_PARAM, invitationId);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.EMAIL_PARAM, email);
  return url.href;
}

export function invitationAcceptQuery(search: string): InvitationAcceptQuery {
  const params = new URLSearchParams(search);
  return {
    id: params.get(INVITATION_ACCEPT_PAGE.ID_PARAM) || undefined,
    email: params.get(INVITATION_ACCEPT_PAGE.EMAIL_PARAM) || undefined,
  };
}

export const INVITATION_ROLE = ASSIGNABLE_ROLE;

const INVITATION_BOUNDS = {
  MAX_EMAIL_CHARS: 254,
} as const;

function dottedDomain(address: string): boolean {
  const domain = address.slice(address.indexOf("@") + 1);
  return domain.slice(1, -1).includes(".");
}

const invitedEmailSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(INVITATION_BOUNDS.MAX_EMAIL_CHARS),
  EffectSchema.isPattern(/^[^\s@]+@[^\s@]+$/u),
  EffectSchema.makeFilter(dottedDomain),
);

const invitationRoleSchema = EffectSchema.Literals(Object.values(INVITATION_ROLE));

const readInvitedEmail = EffectSchema.decodeUnknownOption(invitedEmailSchema);

export function isInvitableEmail(typed: string): boolean {
  return Option.isSome(readInvitedEmail(typed));
}

export interface TypedInvitee {
  readonly email: string;
  readonly name: string | undefined;
  readonly typed: string;
  readonly invitable: boolean;
}

const MAILTO = "mailto:";

type TypedWord = string | typeof ENTRY_END;

const ENTRY_END = Symbol("entry end");

function wordsOf(text: string): readonly TypedWord[] {
  const words: TypedWord[] = [];
  let word = "";
  let quoted = false;
  let bracketed = false;
  const end = () => {
    if (word !== "") words.push(word);
    word = "";
  };
  for (const char of text) {
    const open = quoted || bracketed;
    if (!open && (char === "," || char === ";")) {
      end();
      words.push(ENTRY_END);
    } else if (!open && char.trim() === "") {
      end();
    } else {
      if (char === '"' && !bracketed) quoted = !quoted;
      if (char === "<" && !quoted) bracketed = true;
      if (char === ">" && !quoted) bracketed = false;
      word += char;
    }
  }
  end();
  return words;
}

function nameOf(words: readonly string[]): string | undefined {
  const name = words.join(" ").replaceAll('"', "").trim();
  return name === "" ? undefined : name;
}

function entriesOf(text: string): readonly { address: string; name?: string; typed: string }[] {
  const entries: { address: string; name?: string; typed: string }[] = [];
  let names: string[] = [];
  const unnamed = () => {
    for (const word of names) entries.push({ address: word, typed: word });
    names = [];
  };
  for (const word of wordsOf(text)) {
    if (word === ENTRY_END) {
      unnamed();
      continue;
    }
    const open = word.indexOf("<");
    if (open === -1) {
      if (word.includes("@")) {
        unnamed();
        entries.push({ address: word, typed: word });
      } else names.push(word);
      continue;
    }
    const before = word.slice(0, open);
    const close = word.indexOf(">", open);
    const address = word.slice(open + 1, close === -1 ? undefined : close).trim();
    const name = nameOf(before === "" ? names : [...names, before]);
    entries.push({
      address,
      ...(name === undefined ? {} : { name }),
      typed: [...names, word].join(" "),
    });
    names = [];
  }
  unnamed();
  return entries;
}

export function inviteesOf(text: string): readonly TypedInvitee[] {
  const seen = new Set<string>();
  const invitees: TypedInvitee[] = [];
  for (const entry of entriesOf(text)) {
    const mailto = entry.address.toLowerCase().startsWith(MAILTO);
    const email = mailto ? entry.address.slice(MAILTO.length) : entry.address;
    const key = email.toLowerCase();
    if (email === "" || seen.has(key)) continue;
    seen.add(key);
    invitees.push({
      email,
      name: entry.name,
      typed: entry.typed,
      invitable: isInvitableEmail(email),
    });
  }
  return invitees;
}

export const workspaceInvitationSchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  email: EffectSchema.String,
  role: invitationRoleSchema,
  expiresAt: EffectSchema.String,
  acceptUrl: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export type WorkspaceInvitation = typeof workspaceInvitationSchema.Type;

export const workspaceInviteRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  email: invitedEmailSchema,
  role: invitationRoleSchema,
});

export const workspaceInvitationAnswerSchema = EffectSchema.Struct({
  invitation: workspaceInvitationSchema,
});

export const workspaceInvitationsAnswerSchema = EffectSchema.Struct({
  invitations: EffectSchema.Array(workspaceInvitationSchema),
});

export const WORKSPACE_INVITATIONS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const INVITATION_OFFER_REFUSAL = {
  SPENT: "spent",
  NOT_RECIPIENT: "not-recipient",
  UNVERIFIED: "unverified",
} as const;

export const INVITATION_OFFER_QUERY = { ID: "id" } as const;

export const invitationOfferQuerySchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export const invitationOfferAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    offer: EffectSchema.Struct({
      id: EffectSchema.String,
      workspaceName: EffectSchema.String,
      role: invitationRoleSchema,
      inviter: EffectSchema.optionalKey(
        EffectSchema.Struct({ name: EffectSchema.String, email: EffectSchema.String }),
      ),
    }),
  }),
  EffectSchema.Struct({
    member: EffectSchema.Struct({ workspaceName: EffectSchema.String }),
  }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(INVITATION_OFFER_REFUSAL)),
  }),
]);

export type InvitationOfferAnswer = typeof invitationOfferAnswerSchema.Type;

export const workspaceInvitationCancelSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  invitationId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

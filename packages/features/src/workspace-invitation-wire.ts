import { Schema as EffectSchema, Option } from "effect";
import { workspaceIdSchema } from "./task-wire.js";
import { ASSIGNABLE_ROLE } from "./workspace-wire.js";

/**
 * workspace-invitation-wire.ts -- a workspace invitation as the Mac asks for, lists, and cancels it, and the web page its invitee accepts it on.
 *
 * An owner or an admin invites people from Settings on the Mac, under its
 * own Better Auth session, through our routes over the organization
 * plugin's invitation calls; each pending invitation comes back with the
 * accept page's address, which the service emails to the invitee where the
 * deployment names a sender and the owner may also copy and send by hand,
 * and the invitee opens to accept it on the browser's own session.
 *
 * The accept address carries the invited address beside the invitation's
 * id, because an invitation is read to its recipient alone: a browser
 * signed in at another address, which a Google and a GitHub account of the
 * same person often are, learns nothing of it, and the page still has to
 * say whose invitation it is. The address in the query only names it; who
 * may accept is the plugin's check, not the page's.
 *
 * An invitation is the workspace's, not its inviter's: the accept page reads
 * it through our own route (`invitationOfferAnswerSchema`), which names
 * the inviter only while they are still a member, so a link stays good after
 * whoever made it left, as the plugin's own read would not let it.
 */

/** The page an invitee accepts an invitation on. */
const INVITATION_ACCEPT_PAGE = {
  PATH: "/accept-invitation",
  /** Better Auth's id of the invitation. */
  ID_PARAM: "id",
  /** The address the invitation was made for. */
  EMAIL_PARAM: "email",
} as const;

/** What the accept page reads from its query: the invitation, and whom it was made for where the link says. */
export interface InvitationAcceptQuery {
  readonly id: string | undefined;
  readonly email: string | undefined;
}

/** The address an invitee opens to accept the invitation, on the service at `origin`. */
export function invitationAcceptUrl(origin: string, invitationId: string, email: string): string {
  const url = new URL(INVITATION_ACCEPT_PAGE.PATH, origin);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.ID_PARAM, invitationId);
  url.searchParams.set(INVITATION_ACCEPT_PAGE.EMAIL_PARAM, email);
  return url.href;
}

/** The accept page's query, as `invitationAcceptUrl` wrote it; an empty parameter is none. */
export function invitationAcceptQuery(search: string): InvitationAcceptQuery {
  const params = new URLSearchParams(search);
  return {
    id: params.get(INVITATION_ACCEPT_PAGE.ID_PARAM) || undefined,
    email: params.get(INVITATION_ACCEPT_PAGE.EMAIL_PARAM) || undefined,
  };
}

/**
 * The roles an invitation may carry. A workspace has one owner, its
 * creator, so nobody is invited as one; and only the owner invites an admin.
 */
export const INVITATION_ROLE = ASSIGNABLE_ROLE;

const INVITATION_BOUNDS = {
  /** The most characters an address may spell (RFC 5321's path limit). */
  MAX_EMAIL_CHARS: 254,
} as const;

/**
 * Whether an address's domain is dotted: a dot after its first character
 * and before its last. Note that this is read by hand beside a pattern that
 * only splits the address at its one `@`, because the single pattern that
 * says both backtracks on a long domain with no dot, and what is checked
 * here is pasted text.
 */
function dottedDomain(address: string): boolean {
  const domain = address.slice(address.indexOf("@") + 1);
  return domain.slice(1, -1).includes(".");
}

/** One address, its ends trimmed: something before an `@` and a dotted domain after it. */
const invitedEmailSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(INVITATION_BOUNDS.MAX_EMAIL_CHARS),
  EffectSchema.isPattern(/^[^\s@]+@[^\s@]+$/u),
  EffectSchema.makeFilter(dottedDomain),
);

const invitationRoleSchema = EffectSchema.Literals(Object.values(INVITATION_ROLE));

const readInvitedEmail = EffectSchema.decodeUnknownOption(invitedEmailSchema);

/**
 * Whether typed words are an address the service invites, read as it reads
 * them, so a form says what is wrong before it asks.
 */
export function isInvitableEmail(typed: string): boolean {
  return Option.isSome(readInvitedEmail(typed));
}

/** One address typed or pasted to invite: the address, the name written beside it, the words to put back to edit it, and whether the service invites it. */
export interface TypedInvitee {
  readonly email: string;
  readonly name: string | undefined;
  readonly typed: string;
  readonly invitable: boolean;
}

/** A link's scheme pasted before an address. */
const MAILTO = "mailto:";

/** One word of what was typed, or the end of an entry a comma or a semicolon makes. */
type TypedWord = string | typeof ENTRY_END;

const ENTRY_END = Symbol("entry end");

/**
 * The words of `text`, split at spaces, commas, and semicolons outside a
 * quoted name or an address in angle brackets, with each comma or semicolon
 * marked. Note that this is one pass over the text rather than a regular
 * expression, because pasted text is anyone's and a backtracking pattern
 * over it can be made to run for as long as its author likes.
 */
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

/** Strips a name's quotes and the spaces around it; nothing where it says nothing. */
function nameOf(words: readonly string[]): string | undefined {
  const name = words.join(" ").replaceAll('"', "").trim();
  return name === "" ? undefined : name;
}

/**
 * The entries of `text` as an email's To line writes them: a quoted or bare
 * name before an address in angle brackets kept whole, and any other word an
 * entry of its own.
 */
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
      // Note that a word holding an address ends any name before it, which had no address of its own.
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
      // Note that the words put back to edit it keep the name's quotes, so a comma inside them still holds it whole.
      typed: [...names, word].join(" "),
    });
    names = [];
  }
  unnamed();
  return entries;
}

/**
 * The distinct addresses in `text`, in the order typed, each with the name
 * written beside it and whether the service invites it. Note that two
 * spellings of one address differing only in case are one, because the
 * service reads them as one.
 */
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

/**
 * One pending invitation as the Mac shows it: whom it is for, as what, until
 * when, and the accept link to copy, which only the invited address's
 * account accepts.
 */
export const workspaceInvitationSchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
  email: EffectSchema.String,
  role: invitationRoleSchema,
  /** When the invitation stops being accepted, as an ISO 8601 instant. */
  expiresAt: EffectSchema.String,
  acceptUrl: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export type WorkspaceInvitation = typeof workspaceInvitationSchema.Type;

/** An invitation asked for (POST), by an owner or an admin of a team's workspace. */
export const workspaceInviteRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  email: invitedEmailSchema,
  role: invitationRoleSchema,
});

/** The invitation made. */
export const workspaceInvitationAnswerSchema = EffectSchema.Struct({
  invitation: workspaceInvitationSchema,
});

/** A workspace's pending invitations, soonest to expire first (GET, and after a cancel). */
export const workspaceInvitationsAnswerSchema = EffectSchema.Struct({
  invitations: EffectSchema.Array(workspaceInvitationSchema),
});

/** The query an invitations read names its workspace under. */
export const WORKSPACE_INVITATIONS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** Why the accept page's read found no invitation to offer: used, canceled, or expired; made for another address; or the address not verified. */
export const INVITATION_OFFER_REFUSAL = {
  SPENT: "spent",
  NOT_RECIPIENT: "not-recipient",
  UNVERIFIED: "unverified",
} as const;

/** The accept page's read's query parameter naming the invitation. */
export const INVITATION_OFFER_QUERY = { ID: "id" } as const;

/** The accept page's read of one invitation (GET), by its id. */
export const invitationOfferQuerySchema = EffectSchema.Struct({
  id: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/**
 * An invitation as its recipient is offered it: the workspace's name, the
 * role, and who invited them while they are still a member; that the reader
 * is already a member of its workspace, named; or why there is none to offer.
 */
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

/** A pending invitation canceled (POST), answered with those still pending. */
export const workspaceInvitationCancelSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  invitationId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

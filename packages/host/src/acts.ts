import { linearIssueSummarySchema } from "@luke/features/linear-wire";
import { workspaceInvitationSchema } from "@luke/features/workspace-invitation-wire";
import { formerMemberSchema, workspaceMemberSchema } from "@luke/features/workspace-wire";
import { isRecord, isWireString, type SchemaRead, type UnparsedWireValue } from "@luke/wire";
import { isWireValue, type WireGuard, type WireGuardValue } from "@luke/wire/wire-guard";
import { Schema as EffectSchema } from "effect";
import { PORT_ACT_KIND, type PortActKind } from "./contract/kinds.js";

/**
 * Every effect a window may ask this build's main process for, named once.
 * Every kind rides the window's act port (`contract/kinds.ts`); adding an
 * effect is adding its kind there, its contract procedure, and its one
 * act-port procedure — a command with no kind reaches nothing.
 *
 * A kind is what the window asks for, never what the main process does with
 * it: some are carried to the host over the operator client and some are the
 * desktop's own, and which is which is the router's business rather than the
 * vocabulary's.
 */
export const ACT_KIND = {
  /**
   * The kinds the window's act port answers (`contract/kinds.ts`), which is
   * every kind: `app:act` carries none of them any longer.
   */
  ...PORT_ACT_KIND,
} as const;

/** A kind `app:act` carries: every kind but the ones the act port answers. */
export type ActKind = Exclude<(typeof ACT_KIND)[keyof typeof ACT_KIND], PortActKind>;

/**
 * One act payload's parser. The `s` combinators from `@luke/wire` satisfy
 * it. It is the
 * reading alone rather than the whole `Schema` because no model is ever
 * offered an act: a JSON Schema node written here would be a second statement
 * of a rule the parser already holds, free to drift from it.
 */
interface ActSchema<Value> {
  read(value: UnparsedWireValue): SchemaRead<Value>;
}

/** One kind's whole declaration: what its payload takes, what its answer is, and what its refusal says. */
interface ActDeclaration<Payload, Result> {
  readonly payload: ActSchema<Payload>;
  readonly result: WireGuard<Result>;
  readonly refusal: string;
}

/**
 * What a workspace act whose role does not allow it is refused with, in place
 * of its kind's own sentence: a member renaming the workspace, setting its
 * photo, or removing someone, or an owner removed or leaving.
 */
export const WORKSPACE_NOT_PERMITTED_REFUSAL =
  "Your role in this workspace does not allow that." as const;

const _workspaceMembersSchema = EffectSchema.Array(workspaceMemberSchema);
const _formerMembersSchema = EffectSchema.Array(formerMemberSchema);

const _linearIssuesSchema = EffectSchema.Array(linearIssueSummarySchema);

const _workspaceInvitationsSchema = EffectSchema.Array(workspaceInvitationSchema);

/** What a GitHub disconnect is refused with where GitHub is the account's only way to sign in. */
export const GITHUB_LAST_SIGN_IN_REFUSAL =
  "GitHub is the only way you sign in to this Luke account, so it cannot be disconnected." as const;

/** What a Linear read is refused with where the workspace's Linear could not be read. */
export const LINEAR_UNAVAILABLE_REFUSAL =
  "Linear is not connected to this workspace, or it stopped answering. An owner or admin can connect it." as const;

/** What an invitation is refused with where the address is already in the workspace or already invited. */
export const ALREADY_INVITED_REFUSAL =
  "That address is already in this workspace or invited." as const;

/** An identifier's ends, admitted as written rather than trimmed, and refused when it carries nothing. */
function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

/**
 * An identifier that has to match the one it names elsewhere — a task or an
 * account — so its ends are admitted as written rather than trimmed into a
 * value the host would not hold.
 */
export const exactId = exactText(512);

/**
 * The longest fenced block a transcript asks main to colour. Note that a
 * longer one is drawn plain rather than cut, because colouring costs main
 * a pass over every character and a block that long is a log, not a snippet.
 */
export const COLOURED_CODE_MAX_CHARS = 20_000;

/** The longest language name a fence may give for its block to be coloured. */
export const FENCE_LANGUAGE_MAX_CHARS = 32;

/** The one host the browser is sent to from a task: a repository's page, or the App's installation page. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** An address on GitHub, and nowhere else: what a repository link, the installation link, or Luke's own issues open. */
export const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

/** Whether `github.open` takes an address, so a link drawn as a press is one the act will open. */
export const isGitHubAddress: (address: string) => boolean = EffectSchema.is(githubAddress);

/** An absolute web address's scheme, which is all `web.open` lets through to the browser. */
const WEB_ADDRESS = /^https?:\/\//iu;

/**
 * An address on the web, wherever it is: an absolute http or https address
 * the URL parser reads. Note that the scheme is the whole of the check,
 * because the browser is the one thing it opens in, and a `file:`,
 * `javascript:`, or another app's scheme would hand the address to
 * something else.
 */
export const webAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(WEB_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

/** Whether `web.open` takes an address, so a link drawn as a press is one the act will open. */
export const isWebAddress: (address: string) => boolean = EffectSchema.is(webAddress);

/**
 * Every act `app:act` carries, one row per kind: the parser its payload has
 * to pass, the guard its answer has to pass, and the sentence its refusal
 * carries. Empty, since every act rides the window's act port now; the
 * channel itself stands until it is taken out whole.
 */
export const ACT = {} as const satisfies Record<ActKind, ActDeclaration<unknown, unknown>>;

/** Any kind's declaration, as a caller holding only a kind's name reads it. */
export type AnyActDeclaration = ActDeclaration<unknown, unknown>;

/** Every row of `ACT` by its kind's name, for a caller holding only a name. */
const DECLARATIONS: ReadonlyMap<string, AnyActDeclaration> = new Map(Object.entries(ACT));

/** A kind's declaration by its name alone, or nothing for a name `app:act` does not carry. */
export function actDeclarationOf(kind: string): AnyActDeclaration | undefined {
  return DECLARATIONS.get(kind);
}

type SchemaValue<Declaration> = Declaration extends ActSchema<infer Value> ? Value : never;

/** What one kind's payload is, read from that kind's own schema. */
export type ActPayload<Kind extends ActKind> = SchemaValue<(typeof ACT)[Kind]["payload"]>;

/** What one kind answers with, read from that kind's own guard. */
export type ActResultFor<Kind extends ActKind> = WireGuardValue<(typeof ACT)[Kind]["result"]>;

/**
 * One command as it crosses: the kind, and the payload its kind takes. A kind
 * that carries nothing has no `payload` key at all, so a payload sent to one
 * is a shape this type cannot describe and the boundary refuses.
 */
export type Act = {
  [Kind in ActKind]: ActPayload<Kind> extends undefined
    ? { readonly kind: Kind }
    : { readonly kind: Kind; readonly payload: ActPayload<Kind> };
}[ActKind];

/** What became of one act. Every answer is a value; nothing here is a throw. */
export const ACT_OUTCOME_STATUS = {
  DONE: "done",
  /** The act was admitted and refused, with a sentence its row can draw. */
  REFUSED: "refused",
  /** No kind by that name, which a build in step with its windows never sees. */
  UNKNOWN_ACT: "unknown-act",
} as const;

export type ActOutcome<Kind extends ActKind = ActKind> =
  | { readonly status: typeof ACT_OUTCOME_STATUS.DONE; readonly value: ActResultFor<Kind> }
  | { readonly status: typeof ACT_OUTCOME_STATUS.REFUSED; readonly reason: string }
  | { readonly status: typeof ACT_OUTCOME_STATUS.UNKNOWN_ACT };

/**
 * One act as its kind's own schema admits it, or nothing. The whole envelope
 * is read: an unnamed kind, a key beside `kind` and `payload`, a payload a
 * kind takes none of, and a payload its schema refuses are each refused here.
 */
export function parsedAct(value: UnparsedWireValue): Act | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of Object.keys(value)) if (key !== "kind" && key !== "payload") return undefined;
  const kind = value.kind;
  if (!isWireString(kind)) return undefined;
  const declared = actDeclarationOf(kind);
  if (declared === undefined) return undefined;
  const read = declared.payload.read(value.payload);
  if (!read.ok) return undefined;
  // SAFETY: the kind's own schema admitted this payload, which is the pairing Act declares.
  return (read.value === undefined ? { kind } : { kind, payload: read.value }) as Act;
}

/** Whether an answer is one of the three outcomes, whatever its kind's own value is. */
export function isActOutcome(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (value.status === ACT_OUTCOME_STATUS.UNKNOWN_ACT) return Object.keys(value).length === 1;
  if (value.status === ACT_OUTCOME_STATUS.REFUSED) {
    return Object.keys(value).length === 2 && isWireString(value.reason);
  }
  if (value.status !== ACT_OUTCOME_STATUS.DONE) return false;
  for (const key of Object.keys(value)) if (key !== "status" && key !== "value") return false;
  return isWireValue(value.value);
}

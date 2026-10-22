import { linearIssueSummarySchema } from "@luke/features/linear-wire";
import { workspaceInvitationSchema } from "@luke/features/workspace-invitation-wire";
import { formerMemberSchema, workspaceMemberSchema } from "@luke/features/workspace-wire";
import { Schema as EffectSchema } from "effect";
import { PORT_ACT_KIND } from "./contract/kinds.js";

/**
 * Every effect a window may ask this build's main process for, named once:
 * the kinds of the window's act port (`contract/kinds.ts`), by the name its
 * call sites spell. Adding an effect is adding its kind there, its contract
 * procedure, and its one act-port procedure — a command with no kind
 * reaches nothing.
 */
export const ACT_KIND = PORT_ACT_KIND;

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

import { PRODUCT_NAME } from "@repo/features/product-name";
import { workspaceInvitationSchema } from "@repo/features/workspace-invitation-wire";
import {
  formerMemberSchema,
  WORKSPACE_BOUNDS,
  WORKSPACE_SLUG_PROBLEM,
  type WorkspaceSlugProblem,
  workspaceMemberSchema,
} from "@repo/features/workspace-wire";
import { Schema as EffectSchema } from "effect";
import { PORT_ACT_KIND } from "./contract/kinds.js";

export const ACT_KIND = PORT_ACT_KIND;

export const WORKSPACE_NOT_PERMITTED_REFUSAL =
  "Your role in this workspace does not allow that." as const;

export const WORKSPACE_SLUG_REFUSAL = {
  [WORKSPACE_SLUG_PROBLEM.MALFORMED]: `Use lowercase letters and numbers, with single hyphens between them, up to ${WORKSPACE_BOUNDS.MAX_SLUG_CHARS} characters.`,
  [WORKSPACE_SLUG_PROBLEM.RESERVED]: "That link is reserved. Choose another.",
  [WORKSPACE_SLUG_PROBLEM.TAKEN]: "Another workspace already uses that link.",
} as const satisfies Record<WorkspaceSlugProblem, string>;

const _workspaceMembersSchema = EffectSchema.Array(workspaceMemberSchema);
const _formerMembersSchema = EffectSchema.Array(formerMemberSchema);

const _workspaceInvitationsSchema = EffectSchema.Array(workspaceInvitationSchema);

export const GITHUB_LAST_SIGN_IN_REFUSAL =
  `GitHub is the only way you sign in to this ${PRODUCT_NAME} account, so it cannot be disconnected.` as const;

export const ALREADY_INVITED_REFUSAL =
  "That address is already in this workspace or invited." as const;

function exactText(max: number): EffectSchema.Codec<string, string> {
  return EffectSchema.String.check(
    EffectSchema.makeFilter((value) => value.trim().length > 0),
    EffectSchema.isMaxLength(max),
  );
}

export const exactId = exactText(512);

export const COLORED_CODE_MAX_CHARS = 20_000;

export const FENCE_LANGUAGE_MAX_CHARS = 32;

const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

export const githubAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(GITHUB_ADDRESS),
);

export const isGitHubAddress: (address: string) => boolean = EffectSchema.is(githubAddress);

const WEB_ADDRESS = /^https?:\/\//iu;

export const webAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(WEB_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

export const isWebAddress: (address: string) => boolean = EffectSchema.is(webAddress);

const MAIL_ADDRESS = /^mailto:/iu;

export const mailAddress = EffectSchema.String.check(
  EffectSchema.isMaxLength(2_048),
  EffectSchema.isPattern(MAIL_ADDRESS),
  EffectSchema.makeFilter((address) => URL.canParse(address)),
);

export const isMailAddress: (address: string) => boolean = EffectSchema.is(mailAddress);

export const openableAddress = EffectSchema.Union([webAddress, mailAddress]);

export const isOpenableAddress: (address: string) => boolean = EffectSchema.is(openableAddress);

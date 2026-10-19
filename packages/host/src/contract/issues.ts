import {
  issueChangeParamsSchema,
  issueCreateParamsSchema,
  issueIdParamsSchema,
  issueListParamsSchema,
  issueListViewSchema,
  issueViewSchema,
} from "@luke/features/issue-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { ISSUE_ACT_KIND } from "./kinds.js";

/**
 * issues.ts -- the Issues page's asks of the host about a workspace's issues, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, the convention the hosted contract
 * keeps (`@luke/features/contract`).
 */
export const issueActsContract = {
  [ISSUE_ACT_KIND.ISSUES_LIST]: actProcedure("Could not read the issues on this system.")
    .input(exactInput(issueListParamsSchema))
    .output(EffectSchema.flip(issueListViewSchema)),
  [ISSUE_ACT_KIND.ISSUES_READ]: actProcedure("Could not read the issue on this system.")
    .input(exactInput(issueIdParamsSchema))
    .output(EffectSchema.flip(issueViewSchema)),
  [ISSUE_ACT_KIND.ISSUES_CREATE]: actProcedure("Could not create the issue on this system.")
    .input(exactInput(issueCreateParamsSchema))
    .output(EffectSchema.flip(issueViewSchema)),
  [ISSUE_ACT_KIND.ISSUES_CHANGE]: actProcedure("Could not change the issue on this system.")
    .input(exactInput(issueChangeParamsSchema))
    .output(EffectSchema.flip(issueViewSchema)),
};

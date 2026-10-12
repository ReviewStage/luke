import { db } from "@sidecar/database/core/query";
import { plan } from "@sidecar/database/schemas/plan";
import { planRevision } from "@sidecar/database/schemas/plan-revision";
import type { PlanSectionWriter } from "@sidecar/hosted/plan-document";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";

/**
 * plan-documents.ts -- a stored plan's text, its sections' writers, and its revisions, as a test sets them.
 *
 * A plan starts as one document, a copy of its account's template
 * (`docs/PLANNING.md`); a test that needs other words writes the text and its
 * sections' writers, or a revision of the text, straight onto the rows.
 */

/** A synthetic document: a template's headings with an answer under each, and the assumptions as a section of the text. */
export const INVITATIONS_TEXT = [
  "## Context",
  "",
  "Only an admin can add someone to a workspace today.",
  "",
  "## Goal",
  "",
  "- Any member can invite a teammate by email.",
  "",
  "## Assumptions",
  "",
  "- An invite expires after 7 days.",
  "",
].join("\n");

/** Makes the plan one document holding `text`, with the sections' writers given. */
export function makeDocumentPlan(
  planId: string,
  text: string,
  sectionWriters: readonly PlanSectionWriter[] = [],
) {
  return db.update(plan).set({ document: text, sectionWriters }).where(eq(plan.id, planId));
}

/** Records a revision of a document plan: its text after the revision, written by the developer at `at`. */
export function recordDocumentRevision(planId: string, seq: number, text: string, at: Date) {
  return db.insert(planRevision).values({
    planId,
    seq,
    actor: PLAN_ACTOR.DEVELOPER,
    agentId: null,
    liveSessionId: null,
    document: text,
    changes: 1,
    startedAt: at,
    at,
    restoredFrom: null,
  });
}

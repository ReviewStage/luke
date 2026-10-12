import type { PlanSectionWriter } from "@sidecar/hosted/plan-document";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { planRevision } from "../../server/db/plan-revision-schema";
import { plan } from "../../server/db/plan-schema";
import { db } from "../../server/db/query";

/**
 * plan-documents.ts -- a stored plan made one free document, as no service path makes one yet.
 *
 * A plan becomes one document only once the switch lands (`docs/PLANNING.md`);
 * until then the store reads and refuses document rows that nothing in
 * production writes, so a test writes the row itself: the plan's text and its
 * sections' writers, or a revision of the text.
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
    fields: null,
    document: text,
    assumptions: [],
    changes: 1,
    startedAt: at,
    at,
    restoredFrom: null,
  });
}

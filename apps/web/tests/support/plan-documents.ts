import type { PlanSectionWriter } from "@sidecar/hosted/plan-document";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { planRevision } from "../../server/db/plan-revision-schema";
import { plan } from "../../server/db/plan-schema";
import { db } from "../../server/db/query";
import { createPlan, type NewPlan, readPlan } from "../../server/hosted/plan-store";

/**
 * plan-documents.ts -- a stored plan made one free document or kept as the template's fields, whichever a test is about.
 *
 * A plan starts as one document, a copy of its account's template
 * (`docs/PLANNING.md`). A plan from before then is still kept as the fixed
 * template's fields until the backfill carries it over, so a test of that
 * path writes the row back to fields itself; a test of a document writes the
 * text and its sections' writers, or a revision of the text.
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

/** Writes the plan back to the fixed template's fields, untouched, as every plan from before documents stands. */
export function makeFieldsPlan(planId: string) {
  return db.update(plan).set({ document: null, sectionWriters: [] }).where(eq(plan.id, planId));
}

/** Starts a plan kept as the fixed template's fields, as one from before documents, and answers it as the store reads it. */
export function createFieldsPlan(userId: string, started: NewPlan) {
  return Effect.gen(function* () {
    const { id } = yield* createPlan(userId, started);
    yield* makeFieldsPlan(id);
    const stored = yield* readPlan(userId, id);
    return Option.getOrThrow(stored).plan;
  });
}

import type { ToolSet } from "ai";
import { type ConversationViewToolKinds, catalogToolSet, catalogViewToolKinds } from "../core.js";
import { planningToolSet } from "./brain-host/planning.js";

/**
 * The brain's catalog as the reads hold stored rows to it, built once for the
 * deployment: the same registry and view classification the desktop's host
 * reads its pages under, so a row the service could answer is one every
 * device can read back.
 */

/** The registry stored rows are read under: the catalog's tools by name, inputs validated by their wire schemas. */
export const CATALOG_TOOL_SET: ToolSet = catalogToolSet();

/**
 * Every tool a hosted conversation's rows may name: the catalog's, and the
 * planning model's, which only a plan conversation is offered. The writer
 * holds every row to this, and a plan conversation is read back under it;
 * the reads that serve devices stay on the catalog, since none of them reads
 * a plan conversation.
 */
export const HOSTED_TOOL_SET: ToolSet = { ...CATALOG_TOOL_SET, ...planningToolSet() };

/** Which catalog tools the view draws as announcements and which as actions. */
export const CATALOG_VIEW_TOOL_KINDS: ConversationViewToolKinds = catalogViewToolKinds();

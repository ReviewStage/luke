import type { ToolSet } from "ai";
import { type ConversationViewToolKinds, catalogToolSet, catalogViewToolKinds } from "../core.js";

/**
 * The brain's catalog as the reads hold stored rows to it, built once for the
 * deployment: the same registry and view classification the desktop's host
 * reads its pages under, so a row the service could answer is one every
 * device can read back.
 */

/** The registry stored rows are read under: the catalog's tools by name, inputs validated by their wire schemas. */
export const CATALOG_TOOL_SET: ToolSet = catalogToolSet();

/** Which catalog tools the view draws as announcements and which as actions. */
export const CATALOG_VIEW_TOOL_KINDS: ConversationViewToolKinds = catalogViewToolKinds();

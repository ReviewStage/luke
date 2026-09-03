import { SUBJECT_SCHEMA, SUBJECT_SCHEMA_NAME, type SubjectInput } from "./subject.js";
import { subjectInput, subjectInstructions } from "./subject-prompt.js";

/**
 * The one OpenAI Responses request a subject derivation may be, built here
 * once for the desktop's keyed path and the hosted endpoint alike, so the
 * instructions, the schema, and the refusal to store are fixed by the build
 * on both, and only the bounded input varies between two requests.
 */

export const SUBJECT_RESPONSES_PATH = "/responses";

const RESPONSES_TEXT_FORMAT_TYPE = "json_schema";

export interface SubjectResponsesOptions {
  model: string;
  maximumOutputTokens: number;
}

/** Builds the Responses request body one bounded input is derived from. */
export function subjectResponsesRequest(input: SubjectInput, options: SubjectResponsesOptions) {
  return {
    model: options.model,
    instructions: subjectInstructions(),
    input: subjectInput(input),
    max_output_tokens: options.maximumOutputTokens,
    store: false,
    text: {
      format: {
        type: RESPONSES_TEXT_FORMAT_TYPE,
        name: SUBJECT_SCHEMA_NAME,
        schema: SUBJECT_SCHEMA,
        strict: true,
      },
    },
  };
}

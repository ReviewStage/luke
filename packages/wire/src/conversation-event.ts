/**
 * The words a rating the developer gave a message said, as the counted
 * events an older build sent still name them. The event rows that carried
 * ratings and a briefing's delivery beside a message are read by nothing,
 * and their kinds went with the table's declaration.
 */

/** Every word a rating may say: a verdict, or its withdrawal. */
export const RATING_WORD = {
  UP: "up",
  DOWN: "down",
  WITHDRAWN: "withdrawn",
} as const;

export type RatingWord = (typeof RATING_WORD)[keyof typeof RATING_WORD];

export const STATUS_TONE = {
  NEUTRAL: "neutral",
  WORKING: "working",
  ATTENTION: "attention",
  COMPLETE: "complete",
  MERGED: "merged",
  DANGER: "danger",
} as const;

export type StatusTone = (typeof STATUS_TONE)[keyof typeof STATUS_TONE];

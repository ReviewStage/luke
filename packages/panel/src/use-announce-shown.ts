import { type Announce, announce } from "@repo/ui";
import { useEffect } from "react";

export function useAnnounceShown(level: Announce, words: string): void {
  useEffect(() => announce(level, words), [level, words]);
}

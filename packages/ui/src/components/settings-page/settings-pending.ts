import { createContext, useContext, useLayoutEffect } from "react";

/**
 * settings-pending.ts -- how a line still reading holds its settings page back: it registers with the page while it stands, and the page draws no section until none does.
 *
 * The page provides the hold; a loading line (`SettingsLine`) takes it for
 * as long as it is mounted. A line outside any page holds nothing back.
 */

/** Takes a hold on the page, answering the release. */
type Hold = () => () => void;

export const SettingsPendingContext = createContext<Hold | undefined>(undefined);

/** Holds the page around the caller back for as long as the caller is mounted. */
export function useSettingsPendingHold(): void {
  const hold = useContext(SettingsPendingContext);
  // A layout effect, so the page hides its sections before the first paint.
  useLayoutEffect(() => hold?.(), [hold]);
}

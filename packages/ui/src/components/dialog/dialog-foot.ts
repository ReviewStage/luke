import { createContext, type RefObject, useContext } from "react";

export const DIALOG_FOOT =
  "flex min-w-0 shrink-0 items-center gap-dialog-action-gap mt-3 [&[hidden]]:hidden";

export const DIALOG_ANSWERS =
  "ml-auto flex shrink-0 gap-dialog-action-gap [&>.ui-button]:min-w-dialog-action";

export const DialogReplayUnmasked = createContext(false);

export interface FootClaim {
  withdraw: () => boolean;
  focus: RefObject<HTMLElement | null>;
  busy: boolean;
  refused: boolean;
}

export interface DialogFoot {
  slot: HTMLElement | null;
  claim: (claim: FootClaim) => () => void;
}

export const DialogFootContext = createContext<DialogFoot | undefined>(undefined);

export function useDialogFoot(): DialogFoot | undefined {
  return useContext(DialogFootContext);
}

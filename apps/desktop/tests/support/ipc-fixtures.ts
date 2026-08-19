import type { IpcMainInvokeEvent } from "electron";

/** Fixture invoke event carrying only sender.id for trust validation. */
export function invokeEvent(senderId: number): IpcMainInvokeEvent {
  // SAFETY: Fixture invoke event carries only sender.id for trust validation.
  return { sender: { id: senderId } } as IpcMainInvokeEvent;
}

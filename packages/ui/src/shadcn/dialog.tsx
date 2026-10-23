import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../cn.js";

/**
 * dialog.tsx -- shadcn/ui's dialog (style `base-nova`, on Base UI), vendored and drawn as Luke's dimmed window and card.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add dialog` reads as a small diff. Luke's
 * changes: the overlay is the palette's scrim, fading in on the dialog's
 * own beat, and the content stands in Base UI's `Viewport` (the dimmed
 * window's room, laid out as a grid that centres the card, which a press
 * on and a drag over are heard by), rather than fixed at the screen's
 * centre, so a card never taller than the window keeps its title and its
 * foot on screen. Both keep to what is seen of the window
 * (`tokens/viewport.css`), so on a phone the card keeps above the
 * keyboard, and both claim their presses back from the desktop's drag
 * strip. The card is the profile's dialog card, its inset, corners, edge,
 * and lift, at a question's measure; it fades and rises in on the motion
 * tokens. shadcn's close button, header, footer, title, description,
 * trigger, and close are left out, because a Luke dialog draws its own
 * head and foot (`components/dialog/dialog.tsx`), as is its ring utility,
 * because the card holds focus for its controls and draws no ring. What an
 * app draws is `@luke/ui`'s `Dialog`; this is its inside.
 */

/** The dimmed window's room: over everything, inside what is seen of the window, never part of the desktop's drag region. */
const DIALOG_ROOM =
  "fixed inset-x-0 top-viewport-top bottom-keyboard-inset z-dialog [-webkit-app-region:no-drag]";

/** The card: a column at a question's measure, never taller than the window less its margins, on the motion tokens. */
export const DIALOG_CARD =
  "box-border flex w-dialog-confirm max-h-dialog-room flex-col gap-2 rounded-dialog border border-border-strong bg-popover p-dialog-inset text-body leading-[normal] text-popover-foreground shadow-dialog animate-dialog-in transition-shadow duration-(--luke-duration-hover) ease-[ease]";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(DIALOG_ROOM, "bg-scrim animate-dialog-scrim", className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  viewport,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** What the dimmed window's room is handed: its presses, keys, and drags. */
  viewport?: Omit<DialogPrimitive.Viewport.Props, "children"> | undefined;
}) {
  const { className: viewportClassName, ...room } = viewport ?? {};
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className={cn(
          DIALOG_ROOM,
          "@container/luke-dialog-room box-border grid place-items-center p-6",
          viewportClassName,
        )}
        {...room}
      >
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(DIALOG_CARD, className)}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPortal>
  );
}

export { Dialog, DialogContent };

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../cn.js";

/**
 * dialog.tsx -- shadcn/ui's dialog (style `base-nova`, on Base UI), vendored and drawn as Luke's dimmed window and card.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add dialog` reads as a small diff. Luke's
 * changes: the content stands in Base UI's `Viewport`, which is the dimmed
 * window itself, the palette's scrim fading in on the dialog's own beat and
 * laid out as a grid that centres the card, which a press on and a drag
 * over are heard by, rather than fixed at the screen's centre over an
 * overlay of its own; the overlay stands unpainted under it, the press
 * Base UI reads as outside the card. So the card fades in under its fading
 * window as it always has, and a card never taller than the window keeps
 * its title and its foot on screen. Both keep to what is seen of the window
 * (`tokens/viewport.css`), so on a phone the card keeps above the
 * keyboard, and both claim their presses back from the desktop's drag
 * strip. The grid's one column is the room's width (`grid-cols-1`), never
 * an `auto` one, which grows to a line that never wraps, such as a menu
 * row's name, and stood a phone's sheet off the screen's edge. The card is
 * the profile's dialog card, its inset, corners, edge, and lift, at a
 * question's measure; it fades and rises in on the motion
 * tokens, and as it closes it and its dimmed window fade out over
 * `--luke-duration-exit`, taking no press while they do, Base UI holding
 * them drawn (`data-ending-style`) until the card's fade has run. A card
 * may also stay drawn, hidden, while its dialog is shut (`keepMounted`, Base
 * UI's portal's own), so opening it again only shows it. shadcn's close
 * button, header, footer, title, description, trigger, and close are left
 * out, because a Luke dialog draws its own head and foot
 * (`components/dialog/dialog.tsx`), as is its ring utility,
 * because the card holds focus for its controls and draws no ring. What an
 * app draws is `@luke/ui`'s `Dialog`; this is its inside.
 */

/**
 * The dimmed window's room: over everything, inside what is seen of the window, never part of the desktop's drag region.
 * Note that it is undrawn while Base UI marks it `hidden`, a kept card's dialog shut, because no app takes Tailwind's
 * preflight, so the room's own `grid` would otherwise leave it drawn over the window.
 */
const DIALOG_ROOM =
  "fixed inset-x-0 top-viewport-top bottom-keyboard-inset z-dialog [-webkit-app-region:no-drag] [&[hidden]]:hidden";

/** The card: a column at a question's measure, never taller than the window less its margins, on the motion tokens, fading out as it closes. */
const DIALOG_CARD =
  "box-border flex w-dialog-confirm max-h-dialog-room flex-col gap-2 rounded-dialog border border-border-strong bg-popover p-dialog-inset text-body leading-[inherit] text-popover-foreground shadow-dialog animate-dialog-in transition-shadow duration-(--luke-duration-hover) ease-motion-exit data-ending-style:pointer-events-none data-ending-style:animate-leave";

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
      className={cn(DIALOG_ROOM, className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  viewport,
  keepMounted = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** What the dimmed window's room is handed: its presses, keys, and drags. */
  viewport?: Omit<DialogPrimitive.Viewport.Props, "children"> | undefined;
  /** Whether the room and the card stay drawn, hidden, while the dialog is shut, so opening it again only shows them. */
  keepMounted?: boolean | undefined;
}) {
  const { className: viewportClassName, ...room } = viewport ?? {};
  return (
    <DialogPortal keepMounted={keepMounted}>
      <DialogOverlay />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className={cn(
          DIALOG_ROOM,
          "@container/luke-dialog-room box-border grid grid-cols-1 place-items-center bg-scrim p-6 animate-dialog-scrim data-ending-style:pointer-events-none data-ending-style:animate-leave",
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

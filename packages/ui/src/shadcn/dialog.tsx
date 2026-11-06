import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../cn.js";

const DIALOG_ROOM =
  "fixed inset-x-0 top-viewport-top bottom-keyboard-inset z-dialog [-webkit-app-region:no-drag] [&[hidden]]:hidden";

const DIALOG_ROOM_MARGIN =
  "pt-[max(--spacing(6),env(safe-area-inset-top,0px))] pr-[max(--spacing(6),env(safe-area-inset-right,0px))] pb-[max(--spacing(6),env(safe-area-inset-bottom,0px)_-_var(--ui-keyboard-inset))] pl-[max(--spacing(6),env(safe-area-inset-left,0px))]";

const DIALOG_CARD =
  "box-border flex w-dialog-confirm max-h-dialog-room flex-col gap-2 rounded-dialog border border-border-strong bg-popover p-dialog-inset text-body leading-[inherit] text-popover-foreground shadow-dialog animate-dialog-in transition-shadow duration-(--ui-duration-hover) ease-motion-exit data-ending-style:pointer-events-none data-ending-style:animate-leave";

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
  viewport?: Omit<DialogPrimitive.Viewport.Props, "children"> | undefined;
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
          DIALOG_ROOM_MARGIN,
          "@container/ui-dialog-room box-border grid grid-cols-1 place-items-center bg-scrim animate-dialog-scrim data-ending-style:pointer-events-none data-ending-style:animate-leave",
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

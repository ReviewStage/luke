import { useState } from "react";

/**
 * person-avatar.tsx -- a person's face as the window draws it wherever it names them: the sidebar's account and a version's author alike.
 *
 * The provider's photo when one travelled and loads, otherwise the first
 * letter of the name. A photo that fails is remembered by its address for as
 * long as the face stands, so a new address gets its own chance. Note that
 * we let a remount try the address again, because a failure is as often a
 * launch with no network as a dead link, and the empty `alt` means a retry
 * that fails again draws no broken-image glyph.
 */

/** A person's face: their photo, or the first letter of `name`. */
export function PersonAvatar({
  name,
  pictureUrl,
}: {
  name: string;
  pictureUrl: string | undefined;
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  if (pictureUrl !== undefined && pictureUrl !== failedUrl) {
    return (
      <img
        className="sidebar-avatar"
        src={pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailedUrl(pictureUrl)}
      />
    );
  }
  return (
    <span className="sidebar-avatar" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

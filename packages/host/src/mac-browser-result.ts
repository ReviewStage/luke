import type { HostedMacCommandClient } from "@luke/features";
import {
  isMacBrowserResult,
  MAC_COMMAND_IMAGE_TYPE,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import type { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";

/**
 * mac-browser-result.ts -- what this Mac answers for a browser command: how a screenshot of a Browser tab is sized before it is sent, and the result posted back by the route its kind takes.
 *
 * A browser command's result is JSON and at most one image
 * (`MacBrowserResult`), posted to a route of its own whose body cap fits
 * the image (`settleBrowser`); every other result, a refusal among them,
 * goes where a shell command's does (`settle`). A screenshot is downscaled
 * here before it is sent, so a Retina capture stays well inside the image
 * bound the service holds it to (`MAC_COMMAND_BOUNDS.MAX_IMAGE_BYTES`) and
 * reaches the model at a size it reads whole.
 */

/**
 * How a screenshot of a Browser tab is encoded before it is sent: no side
 * longer than the longest a model reads without scaling it down again, and
 * as a JPEG of a quality that keeps a page's words legible, which at that
 * size is a few hundred kilobytes.
 */
const MAC_BROWSER_SCREENSHOT = {
  /** The most pixels the screenshot's longer side may span. */
  MAX_LONGEST_SIDE_PIXELS: 1_568,
  /** The JPEG quality it is encoded at, from 0 to 100. */
  JPEG_QUALITY: 80,
  /** The type it is encoded as. */
  MEDIA_TYPE: MAC_COMMAND_IMAGE_TYPE.JPEG,
} as const;

/** An image's size in whole pixels. */
export interface ScreenshotSize {
  readonly width: number;
  readonly height: number;
}

/** How one capture is encoded before it is sent: the size it is resized to, and the type and quality it is encoded as. */
export interface ScreenshotEncoding extends ScreenshotSize {
  readonly mediaType: typeof MAC_BROWSER_SCREENSHOT.MEDIA_TYPE;
  readonly quality: number;
}

/**
 * How a capture of the size given is sent: scaled down, its proportions
 * kept, until its longer side spans at most `MAX_LONGEST_SIDE_PIXELS`, and
 * never scaled up, then encoded as a JPEG of `JPEG_QUALITY`. Note that a
 * side is rounded but never to nothing, so a capture of a sliver still
 * sends a pixel of it.
 */
export function macScreenshotEncoding(captured: ScreenshotSize): ScreenshotEncoding {
  const longest = Math.max(captured.width, captured.height);
  const scale = Math.min(1, MAC_BROWSER_SCREENSHOT.MAX_LONGEST_SIDE_PIXELS / longest);
  return {
    width: Math.max(1, Math.round(captured.width * scale)),
    height: Math.max(1, Math.round(captured.height * scale)),
    mediaType: MAC_BROWSER_SCREENSHOT.MEDIA_TYPE,
    quality: MAC_BROWSER_SCREENSHOT.JPEG_QUALITY,
  };
}

/** The service's side of a result posted back, as this module asks it. */
export type MacCommandSettleClient = Pick<HostedMacCommandClient, "settle" | "settleBrowser">;

/**
 * One command's result posted back by the route its kind takes: a browser
 * command's, image and all, to its own, and any other to the commands'
 * route. Whether the service took it, which a call already given up on does not.
 */
export function settleMacCommandResult(
  client: MacCommandSettleClient,
  id: string,
  result: MacCommandResult,
): Effect.Effect<boolean, never, HttpClient.HttpClient> {
  return isMacBrowserResult(result) ? client.settleBrowser(id, result) : client.settle(id, result);
}

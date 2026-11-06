export const PANEL_PATH = "/app";

export const PANEL_ASSET_BASE = `${PANEL_PATH}/`;

export function addressHere(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

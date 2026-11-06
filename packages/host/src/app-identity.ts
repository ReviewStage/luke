import { PRODUCT_NAME } from "@repo/features/product-name";

const RELEASE_APP_NAME = PRODUCT_NAME;

const DEVELOPMENT_APP_NAME = `${RELEASE_APP_NAME} Dev`;
export const AD_HOC_APP_NAME = `${RELEASE_APP_NAME} Test`;

const INSTANCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSTANCE_NAME_MAX_LENGTH = 48;

export interface AppIdentityContext {
  packaged: boolean;
  developerIdSigned: boolean;
  instance?: string | undefined;
}

function isInstanceName(name: string): boolean {
  return name.length <= INSTANCE_NAME_MAX_LENGTH && INSTANCE_NAME_PATTERN.test(name);
}

export function resolveInstance(launch: {
  packaged: boolean;
  requested: string | undefined;
}): string | undefined {
  if (launch.packaged || launch.requested === undefined) return undefined;
  return isInstanceName(launch.requested) ? launch.requested : undefined;
}

export function resolveAppName({
  packaged,
  developerIdSigned,
  instance,
}: AppIdentityContext): string {
  if (packaged) return developerIdSigned ? RELEASE_APP_NAME : AD_HOC_APP_NAME;
  return instance === undefined ? DEVELOPMENT_APP_NAME : `${DEVELOPMENT_APP_NAME} ${instance}`;
}

declare const PACKAGED_WITH_DEVELOPER_ID_SIGNING: boolean | undefined;

export function buildCarriesDeveloperIdSigning(): boolean {
  try {
    return PACKAGED_WITH_DEVELOPER_ID_SIGNING === true;
  } catch {
    return false;
  }
}

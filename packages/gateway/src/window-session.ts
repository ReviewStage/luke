export interface SessionReplayBootstrap {
  permitted: boolean;
  appVersion: string;
  packaged: boolean;
  accountId?: string | undefined;
  name?: string | undefined;
  email?: string | undefined;
}

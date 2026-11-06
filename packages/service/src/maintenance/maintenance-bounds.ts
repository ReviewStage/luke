export const MAINTENANCE_SWEEP_PATH = "/api/maintenance/sweep";

export const MAINTENANCE_PROVIDER_KEYS_REWRAP_PATH = "/api/maintenance/provider-keys-rewrap";

export const CRON_ENVIRONMENT = {
  CRON_SECRET: "CRON_SECRET",
} as const;

export const MAINTENANCE_SWEEP = {
  MAX_DURATION_SECONDS: 300,
  CRONTAB: "* * * * *",
} as const;

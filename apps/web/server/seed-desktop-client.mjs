import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 1 });
try {
  await pool.query(`
    insert into "oauthClient" (
      "id", "clientId", "disabled", "skipConsent", "enableEndSession",
      "scopes", "createdAt", "updatedAt", "name", "redirectUris",
      "tokenEndpointAuthMethod", "grantTypes", "responseTypes", "public",
      "type", "requirePKCE"
    ) values (
      'luke-desktop', 'luke-desktop', false, true, false,
      '["openid", "profile", "email", "offline_access"]'::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Luke for macOS',
      '["http://127.0.0.1/callback"]'::jsonb, 'none',
      '["authorization_code", "refresh_token"]'::jsonb, '["code"]'::jsonb,
      true, 'native', true
    )
    on conflict ("clientId") do update set
      "disabled" = excluded."disabled",
      "skipConsent" = excluded."skipConsent",
      "scopes" = excluded."scopes",
      "updatedAt" = CURRENT_TIMESTAMP,
      "name" = excluded."name",
      "redirectUris" = excluded."redirectUris",
      "tokenEndpointAuthMethod" = excluded."tokenEndpointAuthMethod",
      "grantTypes" = excluded."grantTypes",
      "responseTypes" = excluded."responseTypes",
      "public" = excluded."public",
      "type" = excluded."type",
      "requirePKCE" = excluded."requirePKCE"
  `);
} finally {
  await pool.end();
}

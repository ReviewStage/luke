import { expect, it } from "vitest";
import { localServerRefusal } from "./local-server-guard.js";

const ON_LOOPBACK = "postgres://luke:luke@127.0.0.1:54329/luke";
const OFF_MACHINE = "postgres://luke:luke@ep-demo.example.com:5432/luke";

it.each([
  {
    beside: "a Vercel variable",
    variables: { VERCEL_ENV: "development", DATABASE_URL: ON_LOOPBACK },
    refused: true,
  },
  { beside: "no database", variables: {}, refused: true },
  {
    beside: "a database off this machine",
    variables: { DATABASE_URL: OFF_MACHINE },
    refused: true,
  },
  {
    beside: "an unpooled database off this machine",
    variables: { DATABASE_URL: ON_LOOPBACK, DATABASE_URL_UNPOOLED: OFF_MACHINE },
    refused: true,
  },
  {
    beside: "a loopback address whose query names a host off this machine",
    variables: { DATABASE_URL: `${ON_LOOPBACK}?host=ep-demo.example.com` },
    refused: true,
  },
  {
    beside: "a loopback address whose last host query names a host off this machine",
    variables: { DATABASE_URL: `${ON_LOOPBACK}?host=127.0.0.1&host=ep-demo.example.com` },
    refused: true,
  },
  {
    beside: "a host shaped like a loopback address that is none",
    variables: { DATABASE_URL: "postgres://luke:luke@127.999.999.999:54329/luke" },
    refused: true,
  },
  {
    beside: "a database on this machine's loopback",
    variables: {
      DATABASE_URL: ON_LOOPBACK,
      DATABASE_URL_UNPOOLED: "postgres://luke:luke@localhost:54329/luke",
    },
    refused: false,
  },
])("the local server's start beside $beside is refused: $refused", ({ variables, refused }) => {
  expect(localServerRefusal(variables) !== undefined).toBe(refused);
});

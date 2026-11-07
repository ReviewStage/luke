import { describe, expect, it } from "vitest";
import { cursorConfigWithServer } from "./mcp-connect.js";

const SERVER_URL = "https://app.test/api/mcp";

// Note that the regression this catches is `mcp install cursor` writing over the person's own
// Cursor config: another server dropped, a key beside `mcpServers` lost, or a file that is no
// config replaced rather than left for them.
describe("cursorConfigWithServer", () => {
  it("adds the server beside every server and key already there", () => {
    const existing = {
      mcpServers: { linear: { url: "https://mcp.linear.app/mcp" }, vespin: { url: "old" } },
      theme: "dark",
    };
    expect(cursorConfigWithServer(existing, SERVER_URL)).toEqual({
      mcpServers: { linear: { url: "https://mcp.linear.app/mcp" }, vespin: { url: SERVER_URL } },
      theme: "dark",
    });
  });

  it("leaves a file that is no config alone", () => {
    expect(cursorConfigWithServer({ mcpServers: ["linear"] }, SERVER_URL)).toBeUndefined();
  });
});

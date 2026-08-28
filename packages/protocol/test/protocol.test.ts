import { describe, expect, it } from "vitest";
import {
  canonicalAuthMessage,
  getActionPolicy,
  CAPABILITY_SCOPES,
  isCapabilityScope,
  REMNOTE_AGENT_PROTOCOL_VERSION,
} from "../src/index.js";

describe("RemNote Agent protocol", () => {
  it("uses protocol v2 and stable capability scopes", () => {
    expect(REMNOTE_AGENT_PROTOCOL_VERSION).toBe(2);
    expect(CAPABILITY_SCOPES).toContain("destructive");
    expect(CAPABILITY_SCOPES).toContain("review");
    expect(isCapabilityScope("window")).toBe(true);
    expect(isCapabilityScope("unknown")).toBe(false);
  });

  it("canonicalizes authentication proofs deterministically", () => {
    const input = {
      serverInstanceId: "server-1",
      serverNonce: "server-nonce",
      clientNonce: "client-nonce",
      installationId: "install-1",
      bridgeVersion: "0.19.0",
      protocolVersion: 2,
    };

    expect(canonicalAuthMessage(input)).toBe(
      canonicalAuthMessage({ ...input }),
    );
    expect(canonicalAuthMessage(input)).toContain("remnote-agent-auth-v2");
  });

  it("classifies destructive actions separately from normal writes", () => {
    expect(getActionPolicy("replace_children")).toEqual({
      scope: "destructive",
      risk: "destructive",
    });
    expect(getActionPolicy("update_note")?.scope).toBe("write");
    expect(getActionPolicy("missing")).toBeUndefined();
  });
});

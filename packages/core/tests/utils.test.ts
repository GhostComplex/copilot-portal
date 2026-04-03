import { describe, it, expect } from "vitest";
import { extractToken } from "../src/lib/utils";

describe("extractToken", () => {
  it("extracts token from Bearer header", () => {
    expect(extractToken("Bearer ghp_abc123")).toBe("ghp_abc123");
  });

  it("extracts token from token header", () => {
    expect(extractToken("token ghp_abc123")).toBe("ghp_abc123");
  });

  it("handles case-insensitive scheme", () => {
    expect(extractToken("bearer ghp_abc123")).toBe("ghp_abc123");
    expect(extractToken("BEARER ghp_abc123")).toBe("ghp_abc123");
    expect(extractToken("TOKEN ghp_abc123")).toBe("ghp_abc123");
  });

  it("returns null for missing header", () => {
    expect(extractToken(undefined)).toBeNull();
    expect(extractToken("")).toBeNull();
  });

  it("returns null for unsupported auth schemes", () => {
    expect(extractToken("Basic abc123")).toBeNull();
    expect(extractToken("Digest abc123")).toBeNull();
  });

  it("handles extra whitespace by returning null", () => {
    // Implementation splits on single space, so extra whitespace = invalid
    expect(extractToken("  Bearer   ghp_abc123  ")).toBeNull();
  });
});

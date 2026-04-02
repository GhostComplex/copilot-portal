import { describe, it, expect } from "vitest";
import { extractToken } from "../src/lib/utils";

describe("extractToken", () => {
  it("extracts token from Bearer header", () => {
    expect(extractToken("Bearer ghp_abc123")).toBe("ghp_abc123");
  });

  it("extracts token from token header", () => {
    expect(extractToken("token ghp_abc123")).toBe("ghp_abc123");
  });

  it("returns null for undefined header", () => {
    expect(extractToken(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractToken("")).toBeNull();
  });

  it("returns null for malformed header (no space)", () => {
    expect(extractToken("Bearerghp_abc123")).toBeNull();
  });

  it("returns null for malformed header (too many parts)", () => {
    expect(extractToken("Bearer ghp abc123")).toBeNull();
  });

  it("handles lowercase bearer", () => {
    expect(extractToken("bearer ghp_abc123")).toBe("ghp_abc123");
  });

  it("handles uppercase TOKEN", () => {
    expect(extractToken("TOKEN ghp_abc123")).toBe("ghp_abc123");
  });

  it("rejects Basic auth scheme", () => {
    expect(extractToken("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("rejects Digest auth scheme", () => {
    expect(extractToken("Digest username=test")).toBeNull();
  });

  it("rejects unknown auth schemes", () => {
    expect(extractToken("ApiKey abc123")).toBeNull();
  });
});

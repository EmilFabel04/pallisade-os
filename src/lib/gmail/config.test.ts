import { describe, it, expect } from "vitest";
import { GOOGLE_SCOPES, DRIVE_SCOPE, hasDriveScope } from "./config";

describe("drive scope", () => {
  it("requests drive.readonly in the consent scopes", () => {
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/drive.readonly");
  });
  it("detects drive scope in a granted scope string", () => {
    expect(hasDriveScope(`openid ${DRIVE_SCOPE} email`)).toBe(true);
    expect(hasDriveScope("https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(hasDriveScope(undefined)).toBe(false);
  });
});

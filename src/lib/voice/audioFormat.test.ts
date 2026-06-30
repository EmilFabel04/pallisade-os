import { describe, it, expect } from "vitest";
import { audioExtension } from "./audioFormat";

describe("audioExtension", () => {
  it("maps Chrome webm (with codecs param) to webm", () => {
    expect(audioExtension("audio/webm")).toBe("webm");
    expect(audioExtension("audio/webm;codecs=opus")).toBe("webm");
  });

  it("maps Safari mp4 to mp4 — the bug this fixes", () => {
    expect(audioExtension("audio/mp4")).toBe("mp4");
    expect(audioExtension("audio/mp4;codecs=mp4a.40.2")).toBe("mp4");
  });

  it("maps Firefox ogg/opus to ogg", () => {
    expect(audioExtension("audio/ogg;codecs=opus")).toBe("ogg");
  });

  it("maps common container types", () => {
    expect(audioExtension("audio/mpeg")).toBe("mp3");
    expect(audioExtension("audio/wav")).toBe("wav");
    expect(audioExtension("audio/x-wav")).toBe("wav");
    expect(audioExtension("audio/x-m4a")).toBe("m4a");
    expect(audioExtension("audio/flac")).toBe("flac");
  });

  it("falls back to webm for empty, null, or unknown types", () => {
    expect(audioExtension("")).toBe("webm");
    expect(audioExtension(null)).toBe("webm");
    expect(audioExtension(undefined)).toBe("webm");
    expect(audioExtension("audio/weird-codec")).toBe("webm");
  });
});

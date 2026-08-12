import { describe, expect, it } from "vitest";
import { parseSnapshot, serializeSnapshot, type Snapshot } from "../src/core/snapshot";

const sample: Snapshot = {
  version: 1,
  wikiPath: "a/b",
  pageId: 3,
  raw: "raw content",
  pushed: "T:raw content",
  remoteUpdatedAt: "2026-08-09T00:00:00.000Z",
};

describe("serializeSnapshot / parseSnapshot", () => {
  it("roundtrip: parseSnapshot(serializeSnapshot(s)) === s", () => {
    expect(parseSnapshot(serializeSnapshot(sample))).toEqual(sample);
  });

  it("serialisiert lesbar (eingerueckt) mit abschliessendem Zeilenumbruch", () => {
    const text = serializeSnapshot(sample);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("\n  \"wikiPath\": \"a/b\"");
  });

  it("gibt bei kaputtem JSON null zurueck statt zu werfen", () => {
    expect(parseSnapshot("{not json")).toBeNull();
  });

  it("gibt bei falscher version null zurueck", () => {
    expect(parseSnapshot(JSON.stringify({ ...sample, version: 2 }))).toBeNull();
  });

  it("gibt null zurueck, wenn ein Pflichtfeld fehlt", () => {
    const { pushed: _pushed, ...rest } = sample;
    expect(parseSnapshot(JSON.stringify(rest))).toBeNull();
  });

  it("gibt null zurueck, wenn ein Feld den falschen Typ hat", () => {
    expect(parseSnapshot(JSON.stringify({ ...sample, pageId: "3" }))).toBeNull();
  });
});

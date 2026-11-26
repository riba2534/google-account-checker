import { describe, expect, it } from "vitest";
import {
  markDuplicates,
  maskSecret,
  recordRaw,
  renderCardLine,
  rtPrefix,
  sliceAndValidate,
  splitLines,
  type RecordSpans,
} from "../../src/shared/cards";

const at = (text: string, value: string): [number, number] => {
  const s = text.indexOf(value);
  if (s < 0) throw new Error(`${value} not in text`);
  return [s, s + value.length];
};

describe("sliceAndValidate", () => {
  const line = "a@b.com----Pa ss:1----JBSWY3DPEHPK3PXP----1//0gAbC-d_E";
  it("slices exact substrings and passes rule checks", () => {
    const spans: RecordSpans = {
      email: at(line, "a@b.com"),
      password: at(line, "Pa ss:1"),
      totp: at(line, "JBSWY3DPEHPK3PXP"),
      rt: at(line, "1//0gAbC-d_E"),
    };
    const { fields, issues } = sliceAndValidate(line, spans);
    expect(fields).toEqual({ email: "a@b.com", password: "Pa ss:1", totp: "JBSWY3DPEHPK3PXP", rt: "1//0gAbC-d_E" });
    expect(issues).toEqual([]);
  });
  it("flags a missing rt as fatal", () => {
    expect(sliceAndValidate(line, { email: at(line, "a@b.com") }).issues).toEqual(["rt_missing"]);
  });
  it("flags invalid rt / email / totp slices", () => {
    const r = sliceAndValidate(line, { rt: at(line, "Pa ss:1"), email: at(line, "Pa ss"), totp: at(line, "a@b.com") });
    expect(r.issues).toEqual(expect.arrayContaining(["rt_invalid", "email_invalid", "totp_invalid"]));
  });
  it("rejects spans out of range, inverted or across lines", () => {
    const text = "x\n1//abc";
    expect(sliceAndValidate(text, { rt: [0, 99] }).issues).toEqual(["span_invalid"]);
    expect(sliceAndValidate(text, { rt: [5, 2] }).issues).toEqual(["span_invalid"]);
    expect(sliceAndValidate(text, { rt: [0, 7] }).issues).toEqual(["span_invalid"]);
    expect(sliceAndValidate(text, { rt: [2, 7] }).issues).toEqual([]);
  });
  it("does not trust non-array spans", () => {
    expect(sliceAndValidate("1//abc", { rt: "0,6" as unknown as [number, number] }).issues).toEqual(["span_invalid"]);
  });
});

describe("markDuplicates", () => {
  it("marks later records with the same rt", () => {
    const mk = (rt: string) => ({ fields: { email: null, password: null, totp: null, rt }, issues: [] as never[] });
    const recs = [mk("1//a"), mk("1//b"), mk("1//a")];
    expect(markDuplicates(recs)).toBe(1);
    expect(recs.map((r) => r.issues)).toEqual([[], [], ["duplicate_rt"]]);
  });
});

describe("lines, raw and render", () => {
  it("splitLines handles CRLF and keeps absolute offsets", () => {
    const text = "ab\r\ncd\nef";
    expect(splitLines(text)).toEqual([
      { start: 0, end: 2, text: "ab" },
      { start: 4, end: 6, text: "cd" },
      { start: 7, end: 9, text: "ef" },
    ]);
  });
  it("single-line records keep the seller line verbatim", () => {
    const text = "x\n  ----a@b.com---pw------1//r---改密成功  \n";
    const fields = { email: "a@b.com", password: "pw", totp: null, rt: "1//r" };
    expect(recordRaw(text, [1], fields)).toBe("----a@b.com---pw------1//r---改密成功");
  });
  it("multi-line records are rebuilt from slices", () => {
    expect(recordRaw("e\np\nr", [0, 1, 2], { email: "a@b.com", password: "pw", totp: null, rt: "1//r" })).toBe(
      "a@b.com----pw----1//r",
    );
  });
  it("renderCardLine swaps only the rt, literally", () => {
    expect(renderCardLine("a@b.com----1//old----1//old", "1//old", "1//n$&ew")).toBe("a@b.com----1//n$&ew----1//old");
    expect(renderCardLine("", "1//old", "1//new")).toBe("1//new");
  });
  it("masks", () => {
    expect(rtPrefix("1//0123456789abcdef")).toBe("1//012345678…");
    expect(maskSecret("password")).toBe("pa***");
    expect(maskSecret("abc")).toBe("a***");
    expect(maskSecret(null)).toBeNull();
  });
});

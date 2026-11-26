import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  PBKDF2_ITERATIONS,
  cardAad,
  hashPassword,
  importCardKey,
  openSecret,
  randomToken,
  sealSecret,
  sha256Hex,
  verifyPassword,
} from "../../src/worker/lib/crypto";

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith(`pbkdf2_sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("correct horsE", h)).toBe(false);
  });
  it("uses a fresh salt each time", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });
  it("rejects malformed or over-limit hashes without throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2_sha256$999999$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2_sha256$1000$!!$!!")).toBe(false);
  });
});

describe("card secrets", () => {
  it("seals and opens with matching aad only", async () => {
    const key = await importCardKey(env.CARD_ENCRYPTION_KEY!);
    const sealed = await sealSecret(key, '{"rt":"1//x"}', cardAad("t1", 0));
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("1//x");
    expect(await openSecret(key, sealed, cardAad("t1", 0))).toBe('{"rt":"1//x"}');
    await expect(openSecret(key, sealed, cardAad("t1", 1))).rejects.toThrow();
  });
  it("rejects keys that are not 32 bytes", () => {
    expect(() => importCardKey("AAAA")).toThrow();
  });
});

describe("tokens", () => {
  it("are url-safe and unique", async () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(randomToken());
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

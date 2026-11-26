// Password hashing, session tokens and at-rest encryption of card credentials.
// WebCrypto only: Workers have no native Argon2/bcrypt.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Workers cap PBKDF2 at 100k iterations; anything above throws at runtime. */
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** URL-safe random token, 32 bytes of entropy by default. */
export function randomToken(bytes = 32): string {
  return base64Url(randomBytes(bytes));
}

/** Short URL-safe id for tasks (96 bits). */
export function randomId(): string {
  return base64Url(randomBytes(12));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// --- card secrets ------------------------------------------------------------

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Import CARD_ENCRYPTION_KEY (base64 of 32 random bytes). */
export function importCardKey(b64: string): Promise<CryptoKey> {
  let key = keyCache.get(b64);
  if (!key) {
    const raw = base64ToBytes(b64.trim());
    if (raw.byteLength !== 32) throw new Error("CARD_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(b64, key);
  }
  return key;
}

/**
 * AES-256-GCM. `aad` binds the ciphertext to its row (use `${taskId}:${idx}`), so a sealed
 * value copied into another row fails to open. Output: `v1.<base64(iv || ciphertext)>`.
 */
export async function sealSecret(key: CryptoKey, plaintext: string, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return `v1.${bytesToBase64(out)}`;
}

export async function openSecret(key: CryptoKey, sealed: string, aad: string): Promise<string> {
  if (!sealed.startsWith("v1.")) throw new Error("unknown secret format");
  const data = base64ToBytes(sealed.slice(3));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, ct);
  return dec.decode(pt);
}

export function cardAad(taskId: string, idx: number): string {
  return `${taskId}:${idx}`;
}

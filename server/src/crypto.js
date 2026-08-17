// Encryption for identity data held at rest (Aadhaar numbers).
//
// Aadhaar is regulated personal data — storing it as plain text in the database
// means anyone with a copy of the .db file has every worker's identity number.
// We encrypt with AES-256-GCM, which also authenticates the ciphertext, so a
// tampered value fails to decrypt rather than returning garbage.
//
// The key comes from AADHAAR_KEY (falling back to JWT_SECRET so local dev works
// out of the box). In production set AADHAAR_KEY to its own random 32-byte value:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
import crypto from "crypto";

const SECRET = process.env.AADHAAR_KEY || process.env.JWT_SECRET || "dev-secret-change-me";
// Normalise whatever secret we're given into exactly 32 bytes
const KEY = crypto.createHash("sha256").update(SECRET).digest();

export function encryptId(plain) {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1 marks the format so we can migrate later without guessing
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptId(stored) {
  if (!stored) return "";
  if (!stored.startsWith("v1:")) return stored; // legacy plain-text row
  try {
    const [, ivB64, tagB64, dataB64] = stored.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return ""; // wrong key or tampered value
  }
}

// What the apps are allowed to see: last four digits only.
export function maskId(stored) {
  const plain = decryptId(stored);
  if (!plain) return "";
  return `XXXX XXXX ${plain.slice(-4)}`;
}

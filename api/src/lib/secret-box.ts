import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.js";

/**
 * AES-256-GCM box for at-rest secrets (camera passwords).
 *
 * The key is derived once from `CAMERA_SECRET`. Ciphertext format is
 * `v1:<iv-b64>:<tag-b64>:<data-b64>` so rotation/versioning stays possible, and
 * an empty plaintext maps to an empty string (camera password optional).
 *
 * Never log the plaintext and never return it from an API response.
 */
const PREFIX = "v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) {
    // scrypt gives a fixed-length key from the operator-provided secret.
    cachedKey = scryptSync(config.camera.secret, "infinity-echo-camera", 32);
  }
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(ciphertext: string): string {
  if (!ciphertext) return "";
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (version !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed secret payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when a stored value can be decrypted with the current key. */
export function canDecrypt(ciphertext: string): boolean {
  try {
    decryptSecret(ciphertext);
    return true;
  } catch {
    return false;
  }
}

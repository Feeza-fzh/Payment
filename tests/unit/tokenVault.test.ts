import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptCardToken, decryptCardToken } from "@/server/payments/tokenVault";

describe("Token Vault — Rule P-19 (AES-256-GCM card token encryption)", () => {
  const originalEnv = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = originalEnv;
  });

  it("encrypts and decrypts a card token correctly", () => {
    const cardToken = "flw-t1nf-f9b3bf384cd30d6fca42b6df9d27bd2f-m03k";
    const encrypted = encryptCardToken(cardToken);

    expect(encrypted).not.toBe(cardToken);
    expect(encrypted.split(":")).toHaveLength(3);

    const decrypted = decryptCardToken(encrypted);
    expect(decrypted).toBe(cardToken);
  });

  it("fails to decrypt if payload has been tampered with", () => {
    const cardToken = "flw-t1nf-test-token";
    const encrypted = encryptCardToken(cardToken);
    const parts = encrypted.split(":");

    // Tamper with the ciphertext
    const tampered = `${parts[0]}:${parts[1]}:deadbeef`;

    expect(() => decryptCardToken(tampered)).toThrow();
  });

  it("throws if TOKEN_ENCRYPTION_KEY is missing or invalid length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "too-short";
    expect(() => encryptCardToken("test")).toThrow();
  });
});

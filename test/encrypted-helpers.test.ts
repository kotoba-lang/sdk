/**
 * Unit tests for encrypted.ts helpers (rkey blinding).
 * Per ADR-2605181200.
 */

import {describe, it, expect} from "vitest";
import {blindRkey} from "../src/encrypted.js";

const KEY_A = new Uint8Array(32).fill(0x11);
const KEY_B = new Uint8Array(32).fill(0x22);

describe("blindRkey (ADR-2605181200)", () => {
  it("produces a 13-char TID-shaped rkey", () => {
    const r = blindRkey(KEY_A, 0);
    expect(r).toHaveLength(13);
    expect(r).toMatch(/^[2-7a-z]{13}$/);
  });

  it("first char is '2' to satisfy AT Proto TID validator", () => {
    const r = blindRkey(KEY_A, 0);
    expect(r[0]).toBe("2");
  });

  it("is deterministic for the same (key, seq)", () => {
    expect(blindRkey(KEY_A, 0)).toBe(blindRkey(KEY_A, 0));
    expect(blindRkey(KEY_A, 5)).toBe(blindRkey(KEY_A, 5));
  });

  it("different seq under the same key gives different rkeys", () => {
    expect(blindRkey(KEY_A, 0)).not.toBe(blindRkey(KEY_A, 1));
    expect(blindRkey(KEY_A, 0)).not.toBe(blindRkey(KEY_A, 100));
  });

  it("different key gives different rkey for same seq", () => {
    expect(blindRkey(KEY_A, 0)).not.toBe(blindRkey(KEY_B, 0));
  });

  it("rejects non-u32 seq", () => {
    expect(() => blindRkey(KEY_A, -1)).toThrow(/u32/);
    expect(() => blindRkey(KEY_A, 0x100000000)).toThrow(/u32/);
    expect(() => blindRkey(KEY_A, 1.5)).toThrow(/u32/);
  });
});

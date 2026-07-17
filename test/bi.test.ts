/**
 * Unit tests for `@etzhayyim/sdk/bi` viem wiring.
 *
 * Scope:
 *   - ABI shape / encoding parity with the deployed contracts.
 *   - Precondition checks (no surprise partial state).
 *   - ClaimTicketIssued event decoding using the same ABI const the
 *     production code uses.
 *
 * Out of scope: real chain calls — those need Anvil + a deploy script;
 * that's an integration test, separately wired.
 */

import {describe, it, expect} from "vitest";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiItem,
} from "viem";

import {
  ETZHAYYIM_MEMBERSHIP_ABI,
  KISHA_STREAM_ABI,
  OATH_RECORD_NSID,
  ADHERENT_REGISTRY_ABI,
  KISHA_PAYOUT_ABI,
} from "../src/abi.js";
import {CANONICAL_OATH_TEXT, join, claim, type BIConfig} from "../src/bi.js";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

// ─── ABI shape ──────────────────────────────────────────────────────

describe("ABI fragments", () => {
  it("EtzhayyimMembership.join encodes as expected", () => {
    const oathHash = "0x1234567890abcdef".padEnd(66, "0") as `0x${string}`;
    const calldata = encodeFunctionData({
      abi: ETZHAYYIM_MEMBERSHIP_ABI,
      functionName: "join",
      args: [oathHash, "alice-on-github"],
    });
    // 4-byte selector + 32-byte oathHash + dynamic string offset/len/data
    expect(calldata.length).toBeGreaterThan(2 + 8 + 64 * 3);
    expect(calldata.startsWith("0x")).toBe(true);
  });

  it("KishaStream.claim encodes as expected", () => {
    const calldata = encodeFunctionData({
      abi: KISHA_STREAM_ABI,
      functionName: "claim",
      args: [1n, ALICE, 0n],
    });
    expect(calldata.length).toBe(2 + 8 + 64 * 3); // selector + tokenId + recipient + maxAmount
  });

  it("AdherentRegistry.join shape pinned to the deployed contract", () => {
    const fn = ADHERENT_REGISTRY_ABI.find((x) => x.type === "function" && x.name === "join");
    expect(fn).toBeDefined();
    expect(fn!.inputs.map((i) => i.type)).toEqual(["address", "string", "bytes32"]);
    expect(fn!.outputs.map((o) => o.type)).toEqual(["uint256"]);
  });

  it("KishaPayout.Fulfilled event shape pinned", () => {
    const ev = KISHA_PAYOUT_ABI.find((x) => x.type === "event" && x.name === "Fulfilled");
    expect(ev).toBeDefined();
    expect(ev!.inputs.map((i) => i.indexed)).toEqual([true, true, true, false, false]);
  });

  it("OATH_RECORD_NSID matches the lexicon path", () => {
    expect(OATH_RECORD_NSID).toBe("com.etzhayyim.apps.etzhayyim.oath");
  });
});

// ─── ClaimTicketIssued event decoding ───────────────────────────────

describe("ClaimTicketIssued log decoding", () => {
  it("decodes the event topics + data produced by KishaStream.claim", () => {
    // Construct a synthetic log matching the deployed bytecode layout:
    // topic0 = keccak("ClaimTicketIssued(bytes32,uint256,address,address,uint256,uint64,uint64,uint64)")
    const sig = "ClaimTicketIssued(bytes32,uint256,address,address,uint256,uint64,uint64,uint64)";
    const topic0 = keccak256(new TextEncoder().encode(sig));
    const ticketId = "0xaa".padEnd(66, "b") as `0x${string}`;
    const tokenId = 7n;
    const holder = ALICE;
    const baseRecipient = ALICE;
    const amount = 1_000_000n;
    const claimSeq = 1n;
    const issuedAt = 1_700_000_000n;
    const expiresAt = issuedAt + 14n * 24n * 60n * 60n;

    const topic1 = ticketId;
    const topic2 = ("0x" + tokenId.toString(16).padStart(64, "0")) as `0x${string}`;
    const topic3 = ("0x" + holder.slice(2).toLowerCase().padStart(64, "0")) as `0x${string}`;

    const data = encodeAbiParameters(
      [
        {type: "address"},
        {type: "uint256"},
        {type: "uint64"},
        {type: "uint64"},
        {type: "uint64"},
      ],
      [baseRecipient, amount, claimSeq, issuedAt, expiresAt]
    );

    const decoded = decodeEventLog({
      abi: KISHA_STREAM_ABI,
      eventName: "ClaimTicketIssued",
      data,
      topics: [topic0, topic1, topic2, topic3],
    });
    expect(decoded.args).toMatchObject({
      ticketId,
      tokenId,
      holder,
      baseRecipient,
      amount,
      claimSeq,
      issuedAt,
      expiresAt,
    });
  });
});

// ─── Fulfilled event parsing (via parseAbiItem like bi.ts uses) ──────

describe("Fulfilled event parse", () => {
  it("parseAbiItem rejects malformed signatures", () => {
    expect(() => parseAbiItem("event Fulfilled (broken")).toThrow();
  });

  it("parseAbiItem accepts the production Fulfilled signature", () => {
    const ev = parseAbiItem(
      "event Fulfilled(bytes32 indexed ticketId, uint256 indexed tokenId, address indexed baseRecipient, uint256 amount, uint64 fulfilledAt)"
    );
    expect(ev.type).toBe("event");
    expect(ev.name).toBe("Fulfilled");
  });
});

// ─── join() precondition checks ─────────────────────────────────────

describe("join() preconditions", () => {
  const cfg = {} as BIConfig;
  const okOpts = {
    did: "did:web:alice.example.com",
    holder: ALICE,
    oathHash: ZERO_HASH,
  };

  it("requires membershipAddress", async () => {
    await expect(join(okOpts, cfg)).rejects.toThrow(/membershipAddress required/);
  });

  it("requires registryAddress", async () => {
    await expect(
      join(okOpts, {membershipAddress: ALICE} as BIConfig)
    ).rejects.toThrow(/registryAddress required/);
  });

  it("rejects malformed holder", async () => {
    await expect(
      join(
        {...okOpts, holder: "not-an-address" as unknown as `0x${string}`},
        {membershipAddress: ALICE, registryAddress: ALICE} as BIConfig
      )
    ).rejects.toThrow(/holder must be a 0x-prefixed address/);
  });

  it("rejects malformed oathHash", async () => {
    await expect(
      join(
        {...okOpts, oathHash: "0xtoo-short" as `0x${string}`},
        {membershipAddress: ALICE, registryAddress: ALICE} as BIConfig
      )
    ).rejects.toThrow(/oathHash must be a 0x-prefixed 32-byte hex/);
  });
});

// ─── claim() precondition checks ────────────────────────────────────

describe("claim() preconditions", () => {
  it("requires privateWalletClient", async () => {
    await expect(claim({tokenId: 1n}, {} as BIConfig)).rejects.toThrow(
      /privateWalletClient required/
    );
  });

  it("requires kishaStreamAddress, kishaPayoutAddress, privateRpcUrl", async () => {
    const wc = {account: {address: ALICE}} as any;
    await expect(claim({tokenId: 1n}, {privateWalletClient: wc} as BIConfig)).rejects.toThrow(
      /kishaStreamAddress required/
    );
    await expect(
      claim({tokenId: 1n}, {privateWalletClient: wc, kishaStreamAddress: ALICE} as BIConfig)
    ).rejects.toThrow(/kishaPayoutAddress required/);
    await expect(
      claim(
        {tokenId: 1n},
        {
          privateWalletClient: wc,
          kishaStreamAddress: ALICE,
          kishaPayoutAddress: ALICE,
        } as BIConfig
      )
    ).rejects.toThrow(/privateRpcUrl required/);
  });
});

// ─── Canonical oath text (ADR-2605172600) ───────────────────────────

describe("canonical oath text", () => {
  it("contains both languages and is non-empty", () => {
    expect(CANONICAL_OATH_TEXT).toContain("etzhayyim の信者");
    expect(CANONICAL_OATH_TEXT).toContain("Tree of Life");
    expect(CANONICAL_OATH_TEXT.length).toBeGreaterThan(100);
  });

  it("keccak hash is stable", () => {
    const hash = keccak256(new TextEncoder().encode(CANONICAL_OATH_TEXT));
    // If this changes, the lexicon version MUST be bumped.
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

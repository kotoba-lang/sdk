/**
 * Unit tests for `propose`, `vote`, `proposalState`, and the
 * sponsored-write paymaster path. Real chain calls are out of scope —
 * exercised against Anvil separately.
 */

import {describe, it, expect} from "vitest";
import {encodeFunctionData, keccak256, toBytes, toHex} from "viem";

import {
  CONSTITUTION_ABI,
  GOVERNANCE_ABI,
  GOVERNANCE_STATE,
  VOTE_CHOICE,
} from "../src/abi.js";
import {propose, vote, proposalState, type BIConfig} from "../src/bi.js";
import {sponsoredWriteContract, type SponsoredBundle} from "../src/paymaster.js";

const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

// ─── Vote choice + state mapping ─────────────────────────────────────

describe("VOTE_CHOICE + GOVERNANCE_STATE constants", () => {
  it("VOTE_CHOICE matches Governance.castVote uint8 semantics", () => {
    expect(VOTE_CHOICE.against).toBe(0);
    expect(VOTE_CHOICE.for).toBe(1);
    expect(VOTE_CHOICE.abstain).toBe(2);
  });

  it("GOVERNANCE_STATE matches Governance.State enum order", () => {
    expect(GOVERNANCE_STATE.Pending).toBe(0);
    expect(GOVERNANCE_STATE.Active).toBe(1);
    expect(GOVERNANCE_STATE.Defeated).toBe(2);
    expect(GOVERNANCE_STATE.Succeeded).toBe(3);
    expect(GOVERNANCE_STATE.Queued).toBe(4);
    expect(GOVERNANCE_STATE.Executed).toBe(5);
    expect(GOVERNANCE_STATE.Canceled).toBe(6);
    expect(GOVERNANCE_STATE.Expired).toBe(7);
  });
});

// ─── Constitution.setMutable encoding for proposals ──────────────────

describe("Constitution.setMutable proposal payload", () => {
  it("encodes (key, value) bytes32 pair matching on-chain semantics", () => {
    const key = keccak256(toBytes("kisha_base_rate"));
    const value = toHex(2_000_000n, {size: 32});
    const calldata = encodeFunctionData({
      abi: CONSTITUTION_ABI,
      functionName: "setMutable",
      args: [key, value],
    });
    // 4 (selector) + 32 (key) + 32 (value) = 68 bytes, hex-encoded = 136 chars + "0x"
    expect(calldata.length).toBe(2 + 8 + 64 * 2);
    expect(calldata.startsWith("0x")).toBe(true);
  });
});

// ─── Governance ABI shape ────────────────────────────────────────────

describe("Governance ABI shape", () => {
  it("propose has the (address[], bytes[], bytes32) → uint256 surface", () => {
    const fn = GOVERNANCE_ABI.find((x) => x.type === "function" && x.name === "propose");
    expect(fn).toBeDefined();
    expect(fn!.inputs.map((i) => i.type)).toEqual(["address[]", "bytes[]", "bytes32"]);
    expect(fn!.outputs.map((o) => o.type)).toEqual(["uint256"]);
  });

  it("castVote has the (uint256, uint8) surface", () => {
    const fn = GOVERNANCE_ABI.find((x) => x.type === "function" && x.name === "castVote");
    expect(fn).toBeDefined();
    expect(fn!.inputs.map((i) => i.type)).toEqual(["uint256", "uint8"]);
  });

  it("ProposalCreated indexed flags pinned to deployed bytecode", () => {
    const ev = GOVERNANCE_ABI.find((x) => x.type === "event" && x.name === "ProposalCreated");
    expect(ev).toBeDefined();
    expect(ev!.inputs.map((i) => i.indexed)).toEqual([
      true, true, true, false, false, false, false, false,
    ]);
  });
});

// ─── propose / vote / proposalState preconditions ─────────────────────

describe("propose() preconditions", () => {
  const opts = {change: "kisha_base_rate" as const, from: 1_000_000n, to: 2_000_000n, rationale: "raise"};

  it("requires privateWalletClient", async () => {
    await expect(propose(opts, {} as BIConfig)).rejects.toThrow(/privateWalletClient required/);
  });

  it("requires privateRpcUrl", async () => {
    const wc = {account: {address: ALICE}} as any;
    await expect(propose(opts, {privateWalletClient: wc} as BIConfig)).rejects.toThrow(
      /privateRpcUrl required/
    );
  });

  it("requires constitutionAddress", async () => {
    const wc = {account: {address: ALICE}} as any;
    await expect(
      propose(opts, {privateWalletClient: wc, privateRpcUrl: "http://x"} as BIConfig)
    ).rejects.toThrow(/constitutionAddress required/);
  });
});

describe("vote() preconditions", () => {
  it("requires privateWalletClient", async () => {
    await expect(vote(1n, "for", {} as BIConfig)).rejects.toThrow(/privateWalletClient required/);
  });
});

describe("proposalState() preconditions", () => {
  it("requires privateRpcUrl + constitutionAddress", async () => {
    await expect(proposalState(1n, {} as BIConfig)).rejects.toThrow(
      /privateRpcUrl \+ constitutionAddress required/
    );
  });
});

// ─── Sponsored paymaster path ────────────────────────────────────────

describe("sponsoredWriteContract", () => {
  it("encodes calldata + delegates to bundler.sendUserOperation", async () => {
    let capturedSend: {account: unknown; calls: any[]; paymaster: unknown} | null = null;
    const bundler = {
      async sendUserOperation(args: any) {
        capturedSend = args;
        return "0xuserop_hash" as `0x${string}`;
      },
      async waitForUserOperationReceipt(_args: any) {
        return {
          success: true,
          receipt: {transactionHash: "0xbasetx" as `0x${string}`},
        } as any;
      },
    } as any;
    const bundle: SponsoredBundle = {
      bundler,
      smartAccount: {address: ALICE} as any,
      paymasterAddress: "0xPM00000000000000000000000000000000000000",
    };
    const txHash = await sponsoredWriteContract(
      {
        address: "0xC0000000000000000000000000000000000000C0",
        abi: GOVERNANCE_ABI,
        functionName: "castVote",
        args: [1n, 1],
      },
      bundle
    );
    expect(txHash).toBe("0xbasetx");
    expect(capturedSend).not.toBeNull();
    expect(capturedSend!.calls).toHaveLength(1);
    expect(capturedSend!.calls[0].to).toBe("0xC0000000000000000000000000000000000000C0");
    expect(capturedSend!.calls[0].value).toBe(0n);
    expect(capturedSend!.paymaster).toBe("0xPM00000000000000000000000000000000000000");
    // calldata is a non-empty 0x hex
    expect(typeof capturedSend!.calls[0].data).toBe("string");
    expect((capturedSend!.calls[0].data as string).startsWith("0x")).toBe(true);
  });

  it("throws when UserOp receipt reports failure", async () => {
    const bundler = {
      async sendUserOperation(_args: any) {
        return "0xfailhash" as `0x${string}`;
      },
      async waitForUserOperationReceipt(_args: any) {
        return {success: false, receipt: {transactionHash: "0x00"}} as any;
      },
    } as any;
    const bundle: SponsoredBundle = {
      bundler,
      smartAccount: {address: ALICE} as any,
      paymasterAddress: "0xPM00000000000000000000000000000000000000",
    };
    await expect(
      sponsoredWriteContract(
        {
          address: "0xC0000000000000000000000000000000000000C0",
          abi: GOVERNANCE_ABI,
          functionName: "castVote",
          args: [1n, 1],
        },
        bundle
      )
    ).rejects.toThrow(/sponsored UserOp .* reverted/);
  });
});

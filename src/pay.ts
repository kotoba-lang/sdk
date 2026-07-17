/**
 * @etzhayyim/sdk/pay — On-chain payment helpers (Base L2 + USDC + ERC-20).
 *
 * v0.1.0: working EOA-based USDC.transfer path + payment.sent AT record
 * creation. ERC-4337 Smart Account + Paymaster + Superfluid + 0xSplits +
 * Safe escrow remain stubs for v0.2+.
 *
 * Hard rule: this is the ONLY seam where viem writeContract for value
 * transfer is allowed. App code MUST call Etzhayyim.pay() — direct USDC
 * transfers from app code are prohibited (ADR-2605172100).
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRecord, type PdsConfig } from "./pds.js";
import { AtpAgent } from "@atproto/api";

// ─── Constants ──────────────────────────────────────────────────────

/** USDC contract on Base L2 (Coinbase Bridged). 6 decimals. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** Default Base L2 RPC. */
export const BASE_RPC_DEFAULT = "https://mainnet.base.org" as const;

/** USDC.transfer / .balanceOf / .approve ABI subset. */
export const USDC_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

export type PaymentPurpose =
  | "donation"
  | "tip"
  | "subscription"
  | "purchase"
  | "refund"
  | "grant"
  | "offering"
  | "split";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Convert human-readable USDC amount ("10.00") to base units (10_000_000n).
 * USDC has 6 decimals on Base.
 */
export function parseUsdc(human: string): bigint {
  const [whole, frac = ""] = human.split(".");
  const padded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded || "0");
}

/**
 * Format a USDC base-units bigint as a human string.
 */
export function formatUsdc(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Convert "10.00 / month" to USDC base units per second.
 * For Superfluid streaming (v0.2 — currently stubbed in payStream).
 */
export function parseUsdcPerSecond(perPeriod: string): bigint {
  const m = perPeriod.match(/^([\d.]+)\s*\/\s*(second|minute|hour|day|week|month|year)$/);
  if (!m) {
    throw new Error(
      `[etzhayyim-sdk/pay] parseUsdcPerSecond: invalid format ${JSON.stringify(perPeriod)} ` +
        `(expected '<amount> / <second|minute|hour|day|week|month|year>')`
    );
  }
  const amount = parseUsdc(m[1]);
  const periodSec: Record<string, bigint> = {
    second: 1n,
    minute: 60n,
    hour: 3600n,
    day: 86400n,
    week: 604800n,
    month: 2592000n, // 30 days
    year: 31536000n,
  };
  return amount / periodSec[m[2]];
}

// ─── One-shot payment (v0.1 — EOA-based USDC.transfer) ──────────────

export interface PayClientConfig {
  /** Base L2 RPC URL. */
  rpcUrl: string;
  /** EOA private key. v0.2 swaps this for an ERC-4337 Smart Account. */
  privateKey: Hex;
  /** USDC contract address. Default USDC_BASE. */
  tokenContract?: Address;
}

export interface PayOpts {
  /** Recipient address. v0.2 will accept did:web/did:plc too. */
  to: Address;
  /** Amount in USDC base units. Use parseUsdc("10.00") for human input. */
  amount: bigint;
  /** Recorded as the AT payment.sent record body. */
  reason: PaymentReason;
}

export interface PaymentReason {
  /** NSID. Default `com.etzhayyim.apps.payment.sent`. */
  collection?: string;
  /** Purpose tag. */
  purpose: PaymentPurpose;
  /** Optional AT URI of the thing being paid for. */
  forUri?: string;
  /** Optional memo (≤ 280 chars, plaintext). */
  memo?: string;
}

export interface PaymentReceipt {
  /** On-chain tx hash on Base L2. */
  txHash: Hash;
  /** Block number where the tx was included. */
  blockNumber: bigint;
  /** AT URI of the payment.sent record on the sender's PDS. (Empty if no PDS supplied.) */
  recordUri: string;
  /** Sender's on-chain address. Optional — relayed bi.claim fulfillments don't carry it. */
  from?: Address;
  /** Recipient. Optional for the same reason as `from`. */
  to?: Address;
  /** Amount in USDC base units. Optional for the same reason. */
  amount?: bigint;
  /** True iff the tx was bundled atomically (paymaster ERC-4337 batch). */
  atomicBatch?: boolean;
}

export class PayClient {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
  readonly tokenContract: Address;
  readonly account;

  constructor(cfg: PayClientConfig) {
    this.account = privateKeyToAccount(cfg.privateKey);
    this.tokenContract = cfg.tokenContract ?? (USDC_BASE as Address);
    this.publicClient = createPublicClient({ transport: http(cfg.rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      transport: http(cfg.rpcUrl),
    });
  }

  /** USDC balance of an address. */
  async balanceOf(addr: Address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.tokenContract,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [addr],
    })) as bigint;
  }

  /**
   * One-shot USDC transfer. Optionally writes a payment.sent AT record to
   * the sender's PDS if `pdsAgent` is provided.
   */
  async pay(
    opts: PayOpts,
    pdsAgent?: { agent: AtpAgent; did: string }
  ): Promise<PaymentReceipt> {
    const chain = null;
    const txHash = await this.walletClient.writeContract({
      address: this.tokenContract,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [opts.to, opts.amount],
      account: this.account,
      chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    if (receipt.status !== "success") {
      throw new Error(`[etzhayyim-sdk/pay] USDC.transfer reverted: ${txHash}`);
    }

    let recordUri = "";
    if (pdsAgent) {
      const chainId = await this.publicClient.getChainId();
      const collection = opts.reason.collection ?? "com.etzhayyim.apps.payment.sent";
      const record = {
        to: opts.to,
        amountUsdcMicros: Number(opts.amount), // safe up to 2^53; cast bigint to JSON number
        tokenContract: this.tokenContract,
        chainId,
        txHash: txHash as string,
        blockNumber: Number(receipt.blockNumber),
        purpose: opts.reason.purpose,
        forUri: opts.reason.forUri,
        memo: opts.reason.memo,
        sentAt: new Date().toISOString(),
        atomicBatch: false,
      };
      const res = await createRecord(
        pdsAgent.agent,
        pdsAgent.did,
        collection,
        record
      );
      recordUri = res.uri;
    }

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      recordUri,
      from: this.account.address,
      to: opts.to,
      amount: opts.amount,
    };
  }
}

// ─── Functional API (matches earlier stub surface) ──────────────────

export async function pay(opts: {
  rpcUrl: string;
  privateKey: Hex;
  to: Address;
  amount: bigint;
  reason: PaymentReason;
  tokenContract?: Address;
  pds?: { agent: AtpAgent; did: string };
}): Promise<PaymentReceipt> {
  const client = new PayClient({
    rpcUrl: opts.rpcUrl,
    privateKey: opts.privateKey,
    tokenContract: opts.tokenContract,
  });
  return client.pay(
    { to: opts.to, amount: opts.amount, reason: opts.reason },
    opts.pds
  );
}

// ─── v0.2 stubs ─────────────────────────────────────────────────────

export interface PayStreamOpts {
  to: Address;
  flowRate: bigint;
  reason: PaymentReason;
}

export async function payStream(_opts: PayStreamOpts): Promise<{
  streamId: Hex;
  recordUri: string;
  startedAt: bigint;
}> {
  throw new Error(
    "[etzhayyim-sdk/pay] payStream() v0.2+: Superfluid.callAgreement(CFAv1.createFlow). " +
      "v0.1 only supports one-shot pay()."
  );
}

export async function payStreamStop(_streamId: Hex): Promise<void> {
  throw new Error("[etzhayyim-sdk/pay] payStreamStop() v0.2+");
}

export interface EscrowOpenOpts {
  to: Address;
  amount: bigint;
  arbiter: Address;
  dueDate: Date;
  reason: PaymentReason;
}

export async function escrowOpen(_opts: EscrowOpenOpts): Promise<{
  safeAddress: Address;
  recordUri: string;
}> {
  throw new Error(
    "[etzhayyim-sdk/pay] escrowOpen() v0.2+: Gnosis Safe 2-of-3 deploy."
  );
}

export async function escrowRelease(
  _safeAddress: Address,
  _to: "recipient" | "user"
): Promise<{ txHash: Hash; recordUri: string }> {
  throw new Error("[etzhayyim-sdk/pay] escrowRelease() v0.2+");
}

export interface SplitDistributeOpts {
  splitAddress: Address;
  amount: bigint;
  reason: PaymentReason;
}

export async function splitDistribute(_opts: SplitDistributeOpts): Promise<{
  txHash: Hash;
  recordUri: string;
}> {
  throw new Error(
    "[etzhayyim-sdk/pay] splitDistribute() v0.2+: 0xSplits.distributeERC20."
  );
}

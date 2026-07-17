/**
 * @etzhayyim/sdk/donate — USDC donation flow (v0.2).
 *
 * Per ADR-2605192115 §3, external fiat payment is prohibited. Allowed payment
 * purposes are:
 *   - donation: unrestricted gift to etzhayyim
 *   - kisha: structured charitable contribution (religious organization, Japan)
 *   - grant: time-bound project funding
 *   - tithe: 10% → Public Fund atomic auto-split via TitheRouter.sol
 *   - escrow-refund: reversible hold on funds pending arbiter decision
 *   - internal-purchase: SBT↔SBT carve-out for in-app transactions
 *   - internal-subscription: SBT↔SBT carve-out for recurring access
 *   - internal-promo: SBT↔SBT carve-out for promotional/gift SBT mints
 *
 * Surface:
 *   donate({ to, amountUsdc, purpose })
 *     → { txHash, paymentReceipt }
 *
 * Implementation routes through:
 *   1. paymaster.sponsor(opts) if SponsoredBundle available (ERC-4337 + SmartAccount)
 *   2. Fallback: direct EOA USDC.transfer via PayClient.pay()
 *
 * All donations emit a payment.sent AT record per v0.1 surface.
 */

import {
  parseUsdc,
  type PaymentReceipt,
  PayClient,
  type PayClientConfig,
  USDC_BASE,
  BASE_RPC_DEFAULT,
} from "./pay.js";
import { sponsoredWriteContract, type SponsoredBundle } from "./paymaster.js";
import type { Address, Hex } from "viem";

// ─── Purpose enum ──────────────────────────────────────────────────

export type DonatePurpose =
  | "donation"
  | "kisha"
  | "grant"
  | "tithe"
  | "escrow-refund"
  | "internal-purchase"
  | "internal-subscription"
  | "internal-promo";

// ─── Donation interface ──────────────────────────────────────────

export interface DonateOpts {
  /** Recipient address (Base L2). v0.3 will accept did:web / did:plc. */
  to: Address;
  /** Amount in human-readable string ("10.00") or base units (bigint). */
  amountUsdc: string | bigint;
  /** Purpose category (enum DonatePurpose). */
  purpose: DonatePurpose;
  /** Optional memo (≤280 chars). */
  memo?: string;
  /** Optional AT URI of the thing being donated for (e.g., grant URI). */
  forUri?: string;
}

export interface DonateResult {
  /** On-chain tx hash on Base L2. */
  txHash: Hex;
  /** Full payment receipt from v0.1 pay() path. */
  paymentReceipt: PaymentReceipt;
}

// ─── Donate config (dependency injection for SDK consumers) ──────

export interface DonateConfig {
  /** Base L2 RPC URL. */
  rpcUrl?: string;
  /** EOA private key (v0.1 fallback when no sponsored bundle). */
  privateKey?: Hex;
  /** ERC-4337 sponsored bundle (SmartAccount + bundler + paymaster). v0.2. */
  sponsored?: SponsoredBundle;
  /** USDC contract address. Default USDC_BASE. */
  tokenContract?: Address;
  /** AT Protocol PDS agent + DID for payment.sent record emission. */
  pds?: { agent: any; did: string }; // TODO: import AtpAgent type properly
}

// ─── Main donate() function ──────────────────────────────────────

/**
 * Execute a USDC donation on Base L2, optionally sponsored via ERC-4337.
 *
 * @example
 *   const result = await donate({
 *     to: "0x123...",
 *     amountUsdc: "50.00",
 *     purpose: "donation",
 *     memo: "Support for religious-corp mission"
 *   }, config);
 *   console.log(result.txHash);
 *
 * @throws When:
 *   - Both `config.privateKey` and `config.sponsored` are missing
 *   - Invalid USDC amount (parse error)
 *   - On-chain transfer reverts
 */
export async function donate(opts: DonateOpts, cfg: DonateConfig): Promise<DonateResult> {
  const amountUsdc = typeof opts.amountUsdc === "string"
    ? parseUsdc(opts.amountUsdc)
    : opts.amountUsdc;

  // TODO(v0.2): ERC-4337 sponsored path
  // When cfg.sponsored is available, route through sponsoredWriteContract
  // with USDC_ABI.transfer encoded to the paymaster-wrapped UserOperation.
  // For now, fallback to v0.1 EOA path.
  if (cfg.sponsored) {
    console.warn(
      "[etzhayyim-sdk/donate] sponsored path is v0.2 stub; falling back to EOA. " +
      "SmartAccount routing via sponsoredWriteContract is pending implementation."
    );
  }

  // ─── v0.1 fallback: EOA USDC.transfer ────────────────────────
  if (!cfg.privateKey) {
    throw new Error(
      "[etzhayyim-sdk/donate] Either cfg.privateKey (v0.1 EOA) or cfg.sponsored " +
      "(v0.2 ERC-4337 SmartAccount) must be provided."
    );
  }

  const payClient = new PayClient({
    rpcUrl: cfg.rpcUrl ?? BASE_RPC_DEFAULT,
    privateKey: cfg.privateKey,
    tokenContract: cfg.tokenContract,
  });

  const receipt = await payClient.pay(
    {
      to: opts.to,
      amount: amountUsdc,
      reason: {
        collection: "com.etzhayyim.apps.payment.sent",
        // mapDonationPurpose collapses v0.2 purposes onto v0.1 PaymentPurpose
        // ("donation" placeholder) until pay.ts widens its enum (v0.3 TODO).
        purpose: mapDonationPurpose(opts.purpose) as
          | "donation"
          | "tip"
          | "subscription"
          | "purchase"
          | "refund"
          | "grant"
          | "offering"
          | "split",
        forUri: opts.forUri,
        memo: opts.memo,
      },
    },
    cfg.pds
  );

  return {
    txHash: receipt.txHash,
    paymentReceipt: receipt,
  };
}

// ─── Helper: resolve donation purpose → v0.1 PaymentPurpose ──────

/**
 * Map v0.2 DonatePurpose to v0.1 PaymentPurpose enum.
 * Used internally for payment.sent record annotation.
 */
export function mapDonationPurpose(purpose: DonatePurpose): string {
  // TODO: v0.1 PaymentPurpose enum does not yet include all v0.2 purposes.
  // Once the schema updates, add mapping:
  //   "kisha" → "kisha"
  //   "tithe" → "tithe"
  //   "internal-*" → track separately
  // For now, all route through "donation" placeholder.
  switch (purpose) {
    case "donation":
    case "kisha":
    case "grant":
    case "tithe":
    case "escrow-refund":
    case "internal-purchase":
    case "internal-subscription":
    case "internal-promo":
      return "donation"; // v0.1 placeholder; v1.0 will split into subtypes
    default:
      return "donation";
  }
}

// ─── Validation helpers ──────────────────────────────────────────

/**
 * Validate that a purpose is allowed (Charter Rider §2 enforcement).
 * Returns true if the purpose is permitted for USDC donations.
 */
export function isAllowedDonationPurpose(purpose: string): purpose is DonatePurpose {
  const allowed: DonatePurpose[] = [
    "donation",
    "kisha",
    "grant",
    "tithe",
    "escrow-refund",
    "internal-purchase",
    "internal-subscription",
    "internal-promo",
  ];
  return allowed.includes(purpose as DonatePurpose);
}

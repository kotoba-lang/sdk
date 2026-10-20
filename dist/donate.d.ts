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
import { type PaymentReceipt } from "./pay.js";
import { type SponsoredBundle } from "./paymaster.js";
import type { Address, Hex } from "viem";
export type DonatePurpose = "donation" | "kisha" | "grant" | "tithe" | "escrow-refund" | "internal-purchase" | "internal-subscription" | "internal-promo";
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
    pds?: {
        agent: any;
        did: string;
    };
}
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
export declare function donate(opts: DonateOpts, cfg: DonateConfig): Promise<DonateResult>;
/**
 * Map v0.2 DonatePurpose to v0.1 PaymentPurpose enum.
 * Used internally for payment.sent record annotation.
 */
export declare function mapDonationPurpose(purpose: DonatePurpose): string;
/**
 * Validate that a purpose is allowed (Charter Rider §2 enforcement).
 * Returns true if the purpose is permitted for USDC donations.
 */
export declare function isAllowedDonationPurpose(purpose: string): purpose is DonatePurpose;

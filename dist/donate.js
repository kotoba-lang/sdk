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
import { parseUsdc, PayClient, BASE_RPC_DEFAULT, } from "./pay.js";
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
export async function donate(opts, cfg) {
    const amountUsdc = typeof opts.amountUsdc === "string"
        ? parseUsdc(opts.amountUsdc)
        : opts.amountUsdc;
    // TODO(v0.2): ERC-4337 sponsored path
    // When cfg.sponsored is available, route through sponsoredWriteContract
    // with USDC_ABI.transfer encoded to the paymaster-wrapped UserOperation.
    // For now, fallback to v0.1 EOA path.
    if (cfg.sponsored) {
        console.warn("[etzhayyim-sdk/donate] sponsored path is v0.2 stub; falling back to EOA. " +
            "SmartAccount routing via sponsoredWriteContract is pending implementation.");
    }
    // ─── v0.1 fallback: EOA USDC.transfer ────────────────────────
    if (!cfg.privateKey) {
        throw new Error("[etzhayyim-sdk/donate] Either cfg.privateKey (v0.1 EOA) or cfg.sponsored " +
            "(v0.2 ERC-4337 SmartAccount) must be provided.");
    }
    const payClient = new PayClient({
        rpcUrl: cfg.rpcUrl ?? BASE_RPC_DEFAULT,
        privateKey: cfg.privateKey,
        tokenContract: cfg.tokenContract,
    });
    const receipt = await payClient.pay({
        to: opts.to,
        amount: amountUsdc,
        reason: {
            collection: "com.etzhayyim.apps.payment.sent",
            // mapDonationPurpose collapses v0.2 purposes onto v0.1 PaymentPurpose
            // ("donation" placeholder) until pay.ts widens its enum (v0.3 TODO).
            purpose: mapDonationPurpose(opts.purpose),
            forUri: opts.forUri,
            memo: opts.memo,
        },
    }, cfg.pds);
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
export function mapDonationPurpose(purpose) {
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
export function isAllowedDonationPurpose(purpose) {
    const allowed = [
        "donation",
        "kisha",
        "grant",
        "tithe",
        "escrow-refund",
        "internal-purchase",
        "internal-subscription",
        "internal-promo",
    ];
    return allowed.includes(purpose);
}

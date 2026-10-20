/**
 * @etzhayyim/sdk/bi — Basic-income (kisha) + adherent registry helpers.
 *
 * Status: scaffold. Stubs only — except `join()`, which now implements
 * the full two-chain atomic ritual per ADR-2605172700 (cross-substrate
 * link between 信者 / EtzhayyimMembership on Base and Adherent /
 * AdherentRegistry on geth-private).
 *
 * Composition: the SDK speaks to two chains.
 *   - geth-private (ChainID 2605): AdherentRegistry, KishaStream,
 *     AnchorBridge, Constitution, Governance (S3+).
 *   - Base L2:                     EtzhayyimMembership (per ADR-2605172600),
 *                                  KishaPayout, Treasury Safe (USDC).
 *
 * The two-chain plumbing is internal to this module; callers see a
 * single coherent surface: join → attest → status → claim.
 */
import { type WalletClient } from "viem";
import { AtpAgent } from "@atproto/api";
import { type SponsoredBundle } from "./paymaster.js";
import type { PaymentReceipt } from "./pay.js";
/** geth-private ChainID per ADR-2605172300 §1. */
export declare const ETZHAYYIM_PRIVATE_CHAIN_ID: 2605;
/** Default chain RPC for geth-private. SDK consumer SHOULD override. */
export declare const ETZHAYYIM_PRIVATE_RPC_DEFAULT: "https://chain.etzhayyim.com";
/** Reserved attestation event types. Extensible via Constitution. */
export type AttestationEventType = "prayer" | "study" | "service" | "donation";
export interface BIConfig {
    /** geth-private RPC URL. */
    privateRpcUrl?: string;
    /** Constitution.sol address on geth-private. */
    constitutionAddress?: `0x${string}`;
    /** AdherentRegistry.sol address on geth-private. */
    registryAddress?: `0x${string}`;
    /** KishaStream.sol address on geth-private. */
    kishaStreamAddress?: `0x${string}`;
    /** AnchorBridge.sol address on geth-private. */
    anchorBridgeAddress?: `0x${string}`;
    /** KishaPayout.sol address on Base L2. */
    kishaPayoutAddress?: `0x${string}`;
    /** Treasury Safe address on Base L2 (info only; SDK doesn't write here). */
    treasurySafeAddress?: `0x${string}`;
    /** Phenotype.sol address on geth-private (S2+). Optional — when unset,
     *  the SDK reports a neutral 10_000 bps multiplier. */
    phenotypeAddress?: `0x${string}`;
    /** EtzhayyimMembership.sol address on Base L2 (per ADR-2605172600).
     *  Used by `join()` to perform the 信者 ritual leg. */
    membershipAddress?: `0x${string}`;
    /** Base L2 RPC URL. Default: `https://mainnet.base.org`. */
    baseRpcUrl?: string;
    /**
     * Officer-relayer endpoint that submits the geth-private
     * `AdherentRegistry.join` tx on behalf of the adherent (officer-only
     * call). Required when `BIConfig.officerRelayer` is unset — without
     * one, `join()` stops after the 信者 leg and reports the partial
     * state for human follow-up.
     *
     * Convention: HTTPS endpoint that accepts a JSON body
     *   { holder, did, attestationCid, membershipTxHash, baseChainId,
     *     githubCommitSha } and returns { tokenId, txHash }.
     * Out-of-band signed by an officer multisig.
     */
    officerRelayer?: {
        url: string;
        bearerToken?: string;
    };
    /**
     * viem WalletClient bound to the adherent's wallet on Base. Required
     * for `join()` Stage 1 (EtzhayyimMembership.join) and `claim()`
     * fulfillment polling. EOA wallet acceptable for v0; a future
     * upgrade swaps this for an ERC-4337 SmartAccountClient with a
     * paymaster (ADR-2605172100 §"Account model").
     */
    baseWalletClient?: WalletClient;
    /**
     * viem WalletClient bound to the adherent's wallet on geth-private.
     * Required for `claim()` Stage 1 (KishaStream.claim, holder-only).
     */
    privateWalletClient?: WalletClient;
    /**
     * @atproto/api AtpAgent bound to the adherent's PDS, with an active
     * session. Required for `join()` Stage 2 (oath AT Record write) and
     * `claim()` Stage 5 (payment.kisha AT Record write).
     */
    pdsAgent?: AtpAgent;
    /**
     * Optional ERC-4337 sponsored-write bundle. When set, Base-side
     * adherent writes (initially `join()` Stage 1) route through the
     * bundler + paymaster rather than calling `baseWalletClient.
     * writeContract` directly. Per ADR-2605172100 §"Gas sponsorship".
     */
    sponsored?: SponsoredBundle;
}
export interface JoinOpts {
    /** Adherent DID (did:web / did:plc / did:etzhayyim). */
    did: string;
    /**
     * Adherent's wallet address. Same address controls both chains
     * (ERC-4337 Smart Account derived from the DID's passkey per
     * ADR-2605172100). On geth-private it appears as the SBT holder.
     */
    holder: `0x${string}`;
    /**
     * keccak256 of the canonical oath text. The text itself is fixed by
     * ADR-2605172600's lexicon (`com.etzhayyim.apps.etzhayyim.oath`). The
     * adherent's signature over the text is carried inside the AT Record
     * written in Stage 2; only the hash goes on-chain.
     */
    oathHash: `0x${string}`;
    /**
     * Optional github username for the dual-permanent (Base + MEMBERS.md)
     * record. Per ADR-2605172600 the field is informational; empty string
     * accepted on-chain.
     */
    githubUsername?: string;
    /**
     * Optional reference to the MEMBERS.md PR or merged commit SHA that
     * the adherent will (or has) opened against `etzhayyim/root`. Included
     * verbatim in the AT Record body so a single document indexes both
     * chains and the github commit.
     */
    githubCommitSha?: string;
}
export interface JoinResult {
    /** SBT tokenId minted on geth-private. */
    tokenId: bigint;
    /** Base L2 tx hash of the `EtzhayyimMembership.Joined` event (信者). */
    membershipTxHash: `0x${string}`;
    /** geth-private tx hash of the `AdherentRegistry.Joined` event. */
    adherentTxHash: `0x${string}`;
    /** AT URI of the `com.etzhayyim.apps.etzhayyim.oath` record that bridges
     *  both chains + the github commit. */
    oathRecordUri: string;
    /** True if both chain legs landed; false if only the Base 信者 leg
     *  succeeded and the geth-private leg was skipped/failed (no officer
     *  relayer wired). */
    fullyEnrolled: boolean;
}
/**
 * Perform the two-chain membership ritual per ADR-2605172700.
 *
 *   Stage 1 — Base L2: call `EtzhayyimMembership.join(oathHash, githubUsername)`
 *             (anyone-callable, paymaster-sponsored gas). On success the
 *             adherent is a 信者; the commitment is permanently on Base
 *             and (after Stage 3 PR merges) also on github.
 *
 *   Stage 2 — PDS: write a signed `com.etzhayyim.apps.etzhayyim.oath` record
 *             carrying the full oath text, the DID signature, the Base
 *             chainId + Joined tx hash, the github commit SHA, and the
 *             joinedAt timestamp. The record's CID is the
 *             `attestationCid` consumed by Stage 4.
 *
 *   Stage 3 — Github: out-of-band, the adherent opens a PR to
 *             `MEMBERS.md`. This SDK does not drive the PR (it requires
 *             github auth); it returns the commit SHA placeholder for
 *             the caller to fill in before the AT Record is finalized.
 *
 *   Stage 4 — geth-private: officer-relayed call to
 *             `AdherentRegistry.join(holder, did, keccak256(oathRecordCid))`.
 *             This is the only step that needs officer privilege; the
 *             relayer is consulted via `cfg.officerRelayer` if set,
 *             otherwise the call returns `fullyEnrolled=false` with the
 *             Stage 1+2 receipts so a human can complete the enrollment
 *             through the standard officer flow.
 *
 * If Stage 1 succeeds and Stage 4 fails (network / officer down / etc.),
 * the 信者 state on Base is *not* rolled back — that's the intended
 * semantic per ADR-2605172600 (信者 is permanent and self-sovereign;
 * Adherent is a later additive layer). Re-running `join()` is
 * idempotent: Stage 1 will revert `AlreadyMember`, Stage 2 dedupes
 * by content, Stage 4 retries the officer-relayer call.
 */
export declare function join(opts: JoinOpts, cfg: BIConfig): Promise<JoinResult>;
/** Canonical oath text per ADR-2605172600 (both languages equivalent). */
export declare const CANONICAL_OATH_TEXT: string;
export interface AttestOpts {
    tokenId: bigint;
    eventType: AttestationEventType;
    /** Optional IPFS CID of evidence (encrypted-to-passkey by default). */
    evidenceCid?: string;
}
export interface AttestResult {
    txHash: `0x${string}`;
    /** AT URI of the corresponding event record on the adherent's PDS. */
    recordUri: string;
}
export declare function attest(opts: AttestOpts, cfg: BIConfig): Promise<AttestResult>;
export interface KishaStatus {
    /** SBT tokenId. */
    tokenId: bigint;
    /** Unix seconds of join. */
    adherentSince: bigint;
    /** Most recent attest call (0 if never). */
    lastAttestedAt: bigint;
    /** True if attested within Constitution.active_window_secs. */
    isActive: boolean;
    /** Current base rate in USDC base units (6 decimals) per day. */
    baseRatePerDay: bigint;
    /** Phenotype multiplier (S2+). 10_000 = 1.0×; 5_000 = 0.5×. */
    phenotypeMultiplierBps: number;
    /** Currently claimable amount in USDC base units. */
    claimable: bigint;
    /** Total kisha claimed historically in USDC base units. */
    claimedTotal: bigint;
}
export declare function status(tokenId: bigint, cfg: BIConfig): Promise<KishaStatus>;
export interface PhenotypeUpdateInput {
    tokenId: bigint;
    /** Multiplier in basis points, bounded by Constitution band (5000..20000). */
    bps: number;
    /** Cell-supplied epoch (Pregel super-step number). */
    epoch: bigint;
    /** Optional IPFS CID hash of the evidence record (32-byte). */
    evidenceHash?: `0x${string}`;
    /** Signature TTL from now, in seconds. Default 600. */
    ttlSecs?: number;
}
export interface PhenotypeUpdateResult {
    txHash: `0x${string}`;
    oldBps: number;
    newBps: number;
}
/**
 * Submit a cell-signed phenotype update. Caller MUST be running with
 * a signer registered as a cell in `Phenotype.sol` (registered via
 * `Phenotype.registerCell` by governance).
 *
 * In typical operation this is NOT called by app code — the Pregel
 * `EligibilityCell` (Python, at
 * `40-engine/kotoba/crates/kotoba-kotodama/py/src/kotodama/eligibility/cell.py`)
 * computes the multiplier and submits it directly via web3.py. This
 * SDK function exists for TypeScript-side test rigs and dashboard
 * tooling that want to issue cell updates from the same process that
 * holds the cell key.
 */
export declare function setPhenotype(input: PhenotypeUpdateInput, cfg: BIConfig): Promise<PhenotypeUpdateResult>;
export interface ClaimOpts {
    tokenId: bigint;
    /** Base L2 address that will receive USDC. Defaults to adherent's Smart Wallet. */
    baseRecipient?: `0x${string}`;
    /** Optional cap on amount in USDC base units. 0 = claim full accrued. */
    maxAmount?: bigint;
}
export interface ClaimResult {
    /** Ticket id emitted by KishaStream on geth-private. */
    ticketId: `0x${string}`;
    /** geth-private tx hash for the claim() call. */
    privateTxHash: `0x${string}`;
    /** Amount issued by KishaStream (≤ accrued, ≤ maxAmount). */
    amount: bigint;
    /** Promise that resolves once Base KishaPayout.Fulfilled is observed. */
    fulfilled: Promise<PaymentReceipt>;
}
export declare function claim(opts: ClaimOpts, cfg: BIConfig): Promise<ClaimResult>;
export type ConstitutionalChange = "kisha_base_rate" | "kappa_bps" | "tier_liquid_bps" | "tier_reserve_bps" | "tier_corpus_bps" | "quorum_bps" | "active_window_secs" | "timelock_secs";
export interface ProposeOpts {
    change: ConstitutionalChange;
    from: bigint;
    to: bigint;
    rationale: string;
}
/**
 * Submit a governance proposal that changes one constitutional mutable.
 *
 * The current shape is single-key: `change` names the mutable, `to`
 * is the new bytes32 value (a uint256 cast to bytes32 for numeric
 * keys). The proposal payload is a single-call array calling
 * `Constitution.setMutable(keccak256(change), bytes32(to))`.
 *
 * Multi-call proposals (e.g., the bootstrap proposal from the deploy
 * RUNBOOK that wires Phenotype + cell + oracle in one shot) are not
 * directly exposed here yet — callers needing that should drop down to
 * a raw `Governance.propose(targets, calldatas, descCid)` call. The
 * common adherent-side case is one-key adjustments to kisha rate, κ,
 * tier ratios, etc., which is what this helper covers.
 */
export declare function propose(opts: ProposeOpts, cfg: BIConfig): Promise<bigint>;
export declare function vote(proposalId: bigint, choice: "for" | "against" | "abstain", cfg: BIConfig): Promise<void>;
/**
 * Read the current proposal state. Mirrors `Governance.state(proposalId)`
 * and maps the uint8 to a typed label.
 */
export declare function proposalState(proposalId: bigint, cfg: BIConfig): Promise<"Pending" | "Active" | "Defeated" | "Succeeded" | "Queued" | "Executed" | "Canceled" | "Expired">;

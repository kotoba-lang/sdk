/**
 * @etzhayyim/sdk/charter-compliance-gate
 *
 * Atomic pre-flight gate for AAT-bound agent-driven UNSPSC commodity
 * flows. Combines five constitutional sub-gates into one allow/deny
 * call so that agent code never bypasses any of them by accident.
 *
 * Per ADR-2605231500. Phase 1 ships only the function signatures and
 * `NotImplementedError` stubs — each sub-gate is filled in as its
 * underlying registry / DMN / actor reaches production readiness.
 *
 * Apps that integrate before all five sub-gates are implemented MUST
 * set `EXPECTED_GATE_PHASE` in their config and default-deny otherwise.
 * This is the inverse of the usual lefthook informational pattern,
 * intentional to avoid silent Charter drift during build-out.
 */
import type { EtzhayyimConfig } from "./index.js";
export declare class NotImplementedError extends Error {
    constructor(subgate: string);
}
/** Identifies a classification subject the envelope is about. */
export interface SubjectClassification {
    scheme: "unspsc" | "isco" | "apqc" | "bunken" | "other";
    code: string;
    did?: string;
    schemeId?: string;
}
/** Identifies the counterparty in a commodity flow. */
export interface Counterparty {
    /** DID if the counterparty has one (Adherent / external religious-corp). */
    did?: string;
    /** Free-form jurisdiction marker (ISO-3166 country code, e.g. `JP`, `US-CA`). */
    jurisdiction?: string;
    /** Free-form display name; not authoritative. */
    displayName?: string;
}
/** Context passed to combineGate() — captures the agent's intent. */
export interface GateContext {
    /** AAT-bound agent DID making the request. */
    agentDid: string;
    /** Steward DID backing the AAT. */
    stewardDid: string;
    /** Envelope purpose tag. */
    purpose: "donation-in-kind" | "internal-allocation" | "surplus-routing" | "operational-supply" | "council-resolution" | "land-donation" | "membership-affirmation" | "force-rd-consent" | "public-fund-disbursement" | "internal-agreement" | "general";
    /** What this envelope is about. */
    subjectClassifications: SubjectClassification[];
    /** Counterparty (donor / receiver / vendor). */
    counterparty: Counterparty;
    /** Per-envelope value (item count in Phase 1; USDC-6dp in Phase 2). */
    value: number;
    /** Optional snapshot timestamp for attestation freshness checks. */
    attestationFreshnessSec?: number;
}
/** A single sub-gate's verdict. */
export interface SubgateResult {
    subgate: string;
    allowed: boolean;
    reason?: string;
    ref?: string;
}
/** Aggregate verdict returned to the caller. */
export interface GateResult {
    allowed: boolean;
    results: SubgateResult[];
    /** Convenience: union of deny reasons. */
    reasons: string[];
    /** Convenience: list of attestation refs to attach to the envelope. */
    attestationRefs: {
        charterAttestationRef?: string;
        sanctionsScreenRef?: string;
        forceAttestationRef?: string;
    };
}
/** Gate phase the caller expects. */
export type GatePhase = 1 | 2 | 3 | 4;
export interface CombineGateOptions {
    /** What phase the calling app is targeting. Sub-gates not yet implemented at the requested phase throw `NotImplementedError`. */
    expectedPhase: GatePhase;
    /** When true, sub-gate stubs return `{allowed: true}` instead of throwing. ONLY for unit-test fixtures. */
    testingAllowAll?: boolean;
}
/**
 * §1 Charter attestation — does ChartersComplianceRegistry currently attest
 * that the purpose + classification combination is Charter-aligned?
 *
 * @phase 1 (stub) / 4 (real)
 */
export declare function chartersAttest(_ctx: GateContext, _config: EtzhayyimConfig, opts: CombineGateOptions): Promise<SubgateResult>;
/**
 * §2 Sanctions screening — is the counterparty (and their jurisdiction) on
 * an OFAC / EU / UN sanctions list?
 *
 * @phase 1 (stub) / 4 (real)
 */
export declare function sanctionsScreen(_ctx: GateContext, _config: EtzhayyimConfig, opts: CombineGateOptions): Promise<SubgateResult>;
/**
 * §3 Force-sensitive pre-attest — for UNSPSC codes flagged as
 * force-sensitive in their processManifest, has ForceAuthorization
 * preAttest() been satisfied?
 *
 * @phase 2 (stub) / 4 (real)
 */
export declare function forcePreAttest(_ctx: GateContext, _config: EtzhayyimConfig, opts: CombineGateOptions): Promise<SubgateResult>;
/**
 * §4 Counterparty classification — kuni-umi DMN evaluation rejects
 * Charter-incompatible counterparties (e.g., weapons brokers, gambling).
 *
 * @phase 1 (stub) / 4 (real)
 */
export declare function counterpartyClassify(_ctx: GateContext, _config: EtzhayyimConfig, opts: CombineGateOptions): Promise<SubgateResult>;
/**
 * §5 Eros / Gore category check — for UNSPSC codes tagged with an
 * eros-gore category in their processManifest, has Council ruling
 * been recorded (per ADR-2605192400)?
 *
 * @phase 2 (stub) / 4 (real)
 */
export declare function erosGoreCategoryCheck(_ctx: GateContext, _config: EtzhayyimConfig, opts: CombineGateOptions): Promise<SubgateResult>;
/**
 * Run all five sub-gates concurrently and combine into a single verdict.
 *
 * Behaviour:
 *   - Every sub-gate that returns `allowed: false` contributes its
 *     reason to `result.reasons[]`.
 *   - Any sub-gate that throws (other than NotImplementedError during
 *     Phase < expectedPhase) is treated as a deny with the error message
 *     as reason.
 *   - When `opts.expectedPhase` is below 4 (the phase all sub-gates are
 *     real), unimplemented sub-gates throw NotImplementedError — that
 *     propagates out so apps cannot accidentally treat-unimplemented-
 *     as-allow. Only `testingAllowAll: true` overrides this.
 *
 * @phase 1 (with testingAllowAll) / 4 (production)
 */
export declare function combineGate(ctx: GateContext, config: EtzhayyimConfig, opts: CombineGateOptions): Promise<GateResult>;

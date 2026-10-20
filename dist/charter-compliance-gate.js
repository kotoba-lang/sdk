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
// ─── Error type ────────────────────────────────────────────────────
export class NotImplementedError extends Error {
    constructor(subgate) {
        super(`charter-compliance-gate sub-gate ${subgate} is not yet implemented ` +
            `(ADR-2605231500 Phase 1). Apps relying on this gate MUST set ` +
            `EXPECTED_GATE_PHASE >= 4 in EtzhayyimConfig before deploying ` +
            `to production. See ADR-2605231500 §9 Phase plan.`);
        this.name = "NotImplementedError";
    }
}
// ─── Sub-gates (stubs, Phase 4 implementation deferred) ────────────
/**
 * §1 Charter attestation — does ChartersComplianceRegistry currently attest
 * that the purpose + classification combination is Charter-aligned?
 *
 * @phase 1 (stub) / 4 (real)
 */
export async function chartersAttest(_ctx, _config, opts) {
    if (opts.testingAllowAll) {
        return { subgate: "chartersAttest", allowed: true };
    }
    throw new NotImplementedError("chartersAttest");
}
/**
 * §2 Sanctions screening — is the counterparty (and their jurisdiction) on
 * an OFAC / EU / UN sanctions list?
 *
 * @phase 1 (stub) / 4 (real)
 */
export async function sanctionsScreen(_ctx, _config, opts) {
    if (opts.testingAllowAll) {
        return { subgate: "sanctionsScreen", allowed: true };
    }
    throw new NotImplementedError("sanctionsScreen");
}
/**
 * §3 Force-sensitive pre-attest — for UNSPSC codes flagged as
 * force-sensitive in their processManifest, has ForceAuthorization
 * preAttest() been satisfied?
 *
 * @phase 2 (stub) / 4 (real)
 */
export async function forcePreAttest(_ctx, _config, opts) {
    if (opts.testingAllowAll) {
        return { subgate: "forcePreAttest", allowed: true };
    }
    throw new NotImplementedError("forcePreAttest");
}
/**
 * §4 Counterparty classification — kuni-umi DMN evaluation rejects
 * Charter-incompatible counterparties (e.g., weapons brokers, gambling).
 *
 * @phase 1 (stub) / 4 (real)
 */
export async function counterpartyClassify(_ctx, _config, opts) {
    if (opts.testingAllowAll) {
        return { subgate: "counterpartyClassify", allowed: true };
    }
    throw new NotImplementedError("counterpartyClassify");
}
/**
 * §5 Eros / Gore category check — for UNSPSC codes tagged with an
 * eros-gore category in their processManifest, has Council ruling
 * been recorded (per ADR-2605192400)?
 *
 * @phase 2 (stub) / 4 (real)
 */
export async function erosGoreCategoryCheck(_ctx, _config, opts) {
    if (opts.testingAllowAll) {
        return { subgate: "erosGoreCategoryCheck", allowed: true };
    }
    throw new NotImplementedError("erosGoreCategoryCheck");
}
// ─── Atomic combinator ─────────────────────────────────────────────
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
export async function combineGate(ctx, config, opts) {
    const subgates = [
        chartersAttest,
        sanctionsScreen,
        forcePreAttest,
        counterpartyClassify,
        erosGoreCategoryCheck,
    ];
    const settled = await Promise.allSettled(subgates.map((g) => g(ctx, config, opts)));
    const results = settled.map((s, i) => {
        if (s.status === "fulfilled")
            return s.value;
        return {
            subgate: subgates[i].name,
            allowed: false,
            reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
        };
    });
    const allowed = results.every((r) => r.allowed);
    const reasons = results.filter((r) => !r.allowed && r.reason).map((r) => r.reason);
    const attestationRefs = {};
    for (const r of results) {
        if (!r.allowed || !r.ref)
            continue;
        if (r.subgate === "chartersAttest")
            attestationRefs.charterAttestationRef = r.ref;
        else if (r.subgate === "sanctionsScreen")
            attestationRefs.sanctionsScreenRef = r.ref;
        else if (r.subgate === "forcePreAttest")
            attestationRefs.forceAttestationRef = r.ref;
    }
    return { allowed, results, reasons, attestationRefs };
}

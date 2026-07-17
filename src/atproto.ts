/**
 * @etzhayyim/sdk/atproto — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/atproto-client` (physical
 * move, TS unchanged) per ADR-2607011940 / ADR-2606302300. Not to be
 * confused with `kotoba-lang/atproto` (a separate, CLJC-only
 * protocol-vocabulary library with no HTTP client code). This shim exists
 * so `etzhayyim-project-hrse`'s existing `@etzhayyim/sdk/atproto` import
 * and the substrate-boundary lint rule's guidance text keep resolving
 * unchanged.
 */
export * from "@etzhayyim/atproto-client/atproto";

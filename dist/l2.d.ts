/**
 * @etzhayyim/sdk/l2 — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/base-l2` (physical move,
 * TS unchanged) per ADR-2607011940 / ADR-2606302300. This shim exists so
 * the public `@etzhayyim/sdk/l2` subpath and the substrate-boundary lint
 * rule's guidance text keep resolving unchanged.
 */
export * from "@etzhayyim/base-l2/l2";

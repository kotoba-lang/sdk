/**
 * @etzhayyim/sdk/pds — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/atproto-client` (physical
 * move, TS unchanged) per ADR-2607011940 / ADR-2606302300. This shim
 * exists so `pay.ts`'s existing relative import, `open-otology-uhl-r`'s
 * existing `@etzhayyim/sdk/pds` import, and the substrate-boundary lint
 * rule's guidance text all keep resolving unchanged.
 */
export * from "@etzhayyim/atproto-client/pds";

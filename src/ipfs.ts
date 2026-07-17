/**
 * @etzhayyim/sdk/ipfs — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/ipfs` (physical move, TS
 * unchanged) per ADR-2607011830 / ADR-2606302300. This shim exists so
 * `index.ts`'s existing relative import and the public
 * `@etzhayyim/sdk/ipfs` subpath keep working unchanged.
 */
export * from "@etzhayyim/ipfs";

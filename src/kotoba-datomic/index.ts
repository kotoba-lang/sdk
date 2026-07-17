/**
 * @etzhayyim/sdk/kotoba-datomic — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/witness-quorum` (physical
 * move, TS unchanged, single directory of 7 files flattened into that
 * package's src/) per ADR-2607011940 / ADR-2606302300. This shim exists
 * so `index.ts`'s existing relative import (`export * as kotobaDatomic
 * from "./kotoba-datomic/index.js"`) and the public
 * `@etzhayyim/sdk/kotoba-datomic` subpath keep resolving unchanged.
 */
export * from "@etzhayyim/witness-quorum";

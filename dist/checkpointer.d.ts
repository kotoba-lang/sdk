/**
 * @etzhayyim/sdk/checkpointer — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/checkpointer` (physical
 * move, TS unchanged) per ADR-2607011830 / ADR-2606302300. This shim
 * exists so `checkpointer-bin.ts`'s existing relative import and the
 * public `@etzhayyim/sdk/checkpointer` subpath keep working unchanged.
 */
export * from "@etzhayyim/checkpointer";

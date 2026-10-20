/**
 * @etzhayyim/sdk/signal — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/pqh` (physical move, TS
 * unchanged) per ADR-2607011830 / ADR-2606302300. This shim exists so every
 * existing `@etzhayyim/sdk/signal` import (in-package and downstream apps,
 * e.g. etzhayyim-project-karute's sdk-init.ts) keeps working unchanged.
 *
 * @deprecated Same deprecation as the relocated implementation itself: this
 * is a local-only toy session stand-in, not real Signal transport. New code
 * should use pqh's establishSessionInitiator/Responder (suite pqh-v1).
 */
export * from "@etzhayyim/pqh/signal";

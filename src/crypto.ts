/**
 * @etzhayyim/sdk/crypto — re-export shim.
 *
 * The implementation relocated to `kotoba-lang/pqh` (physical move, TS
 * unchanged) per ADR-2607011830 / ADR-2606302300. This shim exists so every
 * existing `@etzhayyim/sdk/crypto` import (in-package and downstream apps)
 * keeps working unchanged.
 */
export * from "@etzhayyim/pqh/crypto";

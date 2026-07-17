/**
 * SDK PDS smoke — pds.etzhayyim.com health + (optional) account list.
 *
 * Usage:
 *   pnpm exec tsx smoke/pds-smoke.ts
 * Env:
 *   ETZ_PDS  (default https://pds.etzhayyim.com)
 */

import { health, resolvePds } from "../src/pds.js";

const SERVICE = process.env.ETZ_PDS ?? "https://pds.etzhayyim.com";

async function main() {
  console.log(`[smoke] service=${SERVICE}`);
  const ok = await health(SERVICE);
  console.log(`[smoke] /xrpc/_health: ${ok ? "OK" : "FAIL"}`);
  if (!ok) process.exit(1);

  // Try resolving the PDS service DID via .well-known/did.json
  try {
    const pds = await resolvePds("did:web:pds.etzhayyim.com");
    console.log(`[smoke] resolvePds(did:web:pds.etzhayyim.com) → ${pds}`);
  } catch (e) {
    console.log(`[smoke] resolvePds: ${(e as Error).message} (expected — did.json not yet published)`);
  }
  console.log(`[smoke] PDS SDK OK ✓`);
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(2);
});

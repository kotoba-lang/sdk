/**
 * SDK L2-only smoke — anchors a synthetic root via the SDK's AnchorClient,
 * skipping IPFS. Runs against local anvil.
 */
import { keccak256, toBytes, type Hex } from "viem";
import { AnchorClient } from "../src/l2.js";

const RPC = process.env.ETZ_RPC ?? "http://localhost:8545";
const ANCHOR = (process.env.ETZ_ANCHOR ??
  "0x5fbdb2315678afecb367f032d93f642f64180aa3") as `0x${string}`;
const PK = (process.env.ETZ_PK ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

async function main() {
  const client = new AnchorClient({ rpcUrl: RPC, contract: ANCHOR, privateKey: PK });
  const root = keccak256(toBytes(`sdk-smoke-${Date.now()}`));
  const before = await client.rootCount();
  const r = await client.anchorMstRoot(root, new TextEncoder().encode("bafyreidemo-sdk"), 1n);
  const after = await client.rootCount();
  console.log(`[smoke] root=${root}`);
  console.log(`[smoke] tx=${r.txHash} block=${r.blockNumber}`);
  console.log(`[smoke] rootCount: ${before} → ${after}`);
  const lookup = await client.findAnchorForRoot(root);
  console.log(`[smoke] lookup: block=${lookup?.blockNumber} anchorer=${lookup?.txAnchorerAddress}`);
  console.log(`[smoke] L2 SDK OK ✓`);
}
main().catch((e) => { console.error("[smoke] FAIL:", e); process.exit(2); });

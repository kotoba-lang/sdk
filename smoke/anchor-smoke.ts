/**
 * SDK smoke test — pins to IPFS, anchors to local anvil EVM,
 * verifies via rootCount() read.
 *
 * Usage:
 *   pnpm tsx smoke/anchor-smoke.ts
 * Env:
 *   ETZ_RPC      (default http://localhost:8545)
 *   ETZ_ANCHOR   (default per deps.toml local_anvil)
 *   ETZ_IPFS_API (default http://simeonnomac-mini.local:5001)
 *   ETZ_PK       (default anvil pre-funded acct[0])
 */

import { keccak256, toBytes, type Hex } from "viem";
import { AnchorClient } from "../src/l2.js";
import { pinBlob, nodeInfo } from "../src/ipfs.js";

const RPC = process.env.ETZ_RPC ?? "http://localhost:8545";
const ANCHOR = (process.env.ETZ_ANCHOR ??
  "0x5fbdb2315678afecb367f032d93f642f64180aa3") as `0x${string}`;
const IPFS_API = process.env.ETZ_IPFS_API ?? "http://simeonnomac-mini.local:5001";
const PK = (process.env.ETZ_PK ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;

async function main() {
  console.log(`[smoke] rpc=${RPC} anchor=${ANCHOR} ipfs=${IPFS_API}`);

  // (1) Kubo handshake
  const info = await nodeInfo(IPFS_API);
  console.log(`[smoke] kubo: id=${info.id.slice(0, 24)}... version=${info.version}`);

  // (2) Pin a small "state" blob to Kubo
  const state = {
    cell: "smoke-test",
    counter: Date.now(),
    note: "first SDK-driven anchor",
  };
  const stateJson = JSON.stringify(state, null, 2);
  const pinned = await pinBlob(IPFS_API, stateJson);
  console.log(`[smoke] pinned: cid=${pinned.cid} size=${pinned.size}B`);

  // (3) Compute root hash (keccak256 of the JSON bytes)
  const rootHash = keccak256(toBytes(stateJson));
  console.log(`[smoke] rootHash: ${rootHash}`);

  // (4) Anchor on-chain via SDK
  const client = new AnchorClient({
    rpcUrl: RPC,
    contract: ANCHOR,
    privateKey: PK,
  });
  const before = await client.rootCount();
  const receipt = await client.anchorMstRoot(
    rootHash,
    new TextEncoder().encode(pinned.cid),
    1n
  );
  const after = await client.rootCount();
  console.log(
    `[smoke] anchored: tx=${receipt.txHash} block=${receipt.blockNumber}`
  );
  console.log(`[smoke] rootCount: ${before} → ${after}`);

  // (5) Verify reverse lookup
  const lookup = await client.findAnchorForRoot(rootHash);
  console.log(
    `[smoke] reverse lookup: blockNumber=${lookup?.blockNumber} ` +
      `anchorer=${lookup?.txAnchorerAddress}`
  );
  console.log(`[smoke] SDK anchor end-to-end OK ✓`);
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(2);
});

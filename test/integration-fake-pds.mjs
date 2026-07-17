// Smoke: bi.join Stage 2 + bi.attest's optional AT Record write hit a
// real (in-memory fake) PDS. Verifies the SDK actually produces the
// canonical `com.etzhayyim.apps.etzhayyim.oath` and
// `com.etzhayyim.event.prayer` records with the expected fields.
//
// Anvil dependencies are the same as integration-full.mjs (forge
// script Deploy must be done before; addresses inlined below). When
// this script runs after integration-full, the chain state already has
// SBT + attestations and the records add to whatever's there.
//
// Usage:
//   cd 20-actors/etzhayyim-sdk && pnpm build && node test/integration-fake-pds.mjs

import {createPublicClient, createWalletClient, http, keccak256} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {AtpAgent} from "@atproto/api";

import {
  ADHERENT_REGISTRY_ABI,
  ETZHAYYIM_MEMBERSHIP_ABI,
} from "../dist/abi.js";
import {attest, join} from "../dist/bi.js";

import {startFakePds} from "./fake-pds.mjs";

const RPC = "http://localhost:8545";

const ADDR = {
  AdherentRegistry:    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  EtzhayyimMembership: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
};

const OFFICER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const officer = privateKeyToAccount(OFFICER_PK);

const log = (...args) => console.log("•", ...args);
const fail = (msg, ctx) => {
  console.error("✘", msg, ctx ?? "");
  process.exit(1);
};

// ─── Boot fake PDS + bind AtpAgent ──────────────────────────────────

const did = "did:web:officer1.etzhayyim.com";

log("Step 0 — start in-memory fake PDS");
const pds = await startFakePds({port: 4711, sessionDid: did, sessionHandle: "officer1.etzhayyim.com"});
log("  fake PDS URL:", pds.url);
const pdsAgent = new AtpAgent({service: pds.url});
// Bypass network login: resumeSession against the fake server hydrates
// the agent's session from the getSession response.
await pdsAgent.resumeSession({
  did,
  handle: "officer1.etzhayyim.com",
  accessJwt: "fake-access",
  refreshJwt: "fake-refresh",
  active: true,
});
log("  AtpAgent.session.did:", pdsAgent.session?.did);

// ─── Wallet wiring (mirrors integration-full.mjs) ───────────────────

const transport = http(RPC);
const wallet = createWalletClient({account: officer, transport});
const pub = createPublicClient({transport});

const cfg = {
  privateRpcUrl: RPC,
  baseRpcUrl: RPC,
  registryAddress: ADDR.AdherentRegistry,
  membershipAddress: ADDR.EtzhayyimMembership,
  baseWalletClient: wallet,
  privateWalletClient: wallet,
  pdsAgent,
};

// ─── Step 1: bi.join with PDS wired → Stage 2 should fire ───────────

log("Step 1 — bi.join with pdsAgent — Stage 2 should write oath record");
const oathHash = keccak256(new TextEncoder().encode("smoke-oath"));
const joinResult = await join(
  {did, holder: officer.address, oathHash, githubUsername: "officer1"},
  cfg
);
log("  membershipTxHash:", joinResult.membershipTxHash);
log("  oathRecordUri:   ", joinResult.oathRecordUri);
log("  fullyEnrolled:   ", joinResult.fullyEnrolled, "(still false — no officerRelayer wired)");

if (!joinResult.oathRecordUri) fail("oath record URI missing");
if (!joinResult.oathRecordUri.startsWith(`at://${did}/com.etzhayyim.apps.etzhayyim.oath/`)) {
  fail("oath record URI shape wrong", joinResult.oathRecordUri);
}

// Inspect what the fake PDS captured.
const oathRec = pds.records.get(joinResult.oathRecordUri);
if (!oathRec) fail("oath record not stored on fake PDS");
log("  oath record value keys:", Object.keys(oathRec.value).sort());
if (oathRec.value.$type !== "com.etzhayyim.apps.etzhayyim.oath") fail("$type mismatch", oathRec.value);
if (oathRec.value.oathHash !== oathHash) fail("oath hash mismatch");
if (oathRec.value.membershipTxHash !== joinResult.membershipTxHash) fail("tx hash not threaded into record");
if (!oathRec.value.oathText.includes("Tree of Life")) fail("canonical oath text missing");

// ─── Step 2: SBT mint via officer (so attest can fire) ───────────────

log("Step 2 — mint SBT (officer self-mint, needed for attest)");
const joinTx = await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.AdherentRegistry,
  abi: ADHERENT_REGISTRY_ABI,
  functionName: "join",
  args: [officer.address, did, keccak256(new TextEncoder().encode("oath-cid"))],
});
await pub.waitForTransactionReceipt({hash: joinTx});
const tokenId = await pub.readContract({
  address: ADDR.AdherentRegistry,
  abi: ADHERENT_REGISTRY_ABI,
  functionName: "tokenOf",
  args: [officer.address],
});
log("  tokenId:", tokenId);

// ─── Step 3: bi.attest — should also write to PDS as best-effort ───

log("Step 3 — bi.attest with pdsAgent — optional event record write fires");
const attestRes = await attest(
  {tokenId, eventType: "prayer", evidenceCid: "bafyreieolwhatever"},
  cfg
);
log("  attest tx:        ", attestRes.txHash);
log("  attest recordUri: ", attestRes.recordUri);

if (!attestRes.recordUri) fail("attest record URI missing — PDS write didn't fire");
if (!attestRes.recordUri.startsWith(`at://${did}/com.etzhayyim.event.prayer/`)) {
  fail("attest record URI shape wrong", attestRes.recordUri);
}
const evtRec = pds.records.get(attestRes.recordUri);
if (!evtRec) fail("event record not stored on fake PDS");
log("  event record value keys:", Object.keys(evtRec.value).sort());
if (evtRec.value.$type !== "com.etzhayyim.event.prayer") fail("$type mismatch", evtRec.value);
if (evtRec.value.chainTxHash !== attestRes.txHash) fail("chain tx hash not threaded");
if (evtRec.value.tokenId !== Number(tokenId)) fail("tokenId not threaded");

// ─── Tear down ─────────────────────────────────────────────────────

await pds.stop();
log("Step 4 — fake PDS stopped (had", pds.records.size, "records at the end)");

console.log("\n✓ e2e PASS — bi.join Stage 2 + bi.attest PDS writes hit a real AtpAgent path");

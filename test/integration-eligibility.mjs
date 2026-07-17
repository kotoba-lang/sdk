// E2E for the Python EligibilityCell → on-chain Phenotype.setMultiplier
// path on Anvil.
//
// Flow:
//   1. Deploys the full internal stack (Constitution, AdherentRegistry,
//      KishaStream, Phenotype, Governance, …) and EtzhayyimMembership.
//   2. Mints an SBT for the founder officer and attests across all four
//      canonical event types (prayer, study, service, donation) so the
//      Python scoring has a realistic input.
//   3. Runs a governance vote (propose → vote → warp → queue → warp →
//      execute) to register a cell EOA in Phenotype.
//   4. Spawns `python -m scripts.run_eligibility_step` (lives in
//      kotodama/py/scripts/) which uses kotodama.eligibility.web3_ports
//      to scan the Attested events, compute the multiplier, sign EIP-191,
//      and submit Phenotype.setMultiplier.
//   5. Verifies Phenotype.getMultiplierBps reflects the new value, and
//      KishaStream.accruedNow scales with the multiplier.
//
// Prereqs:
//   - anvil running on :8545
//   - forge-script deploy NOT yet done (this script does it)
//   - `uv` on PATH (for the Python child process)
//
// Usage:
//   cd 20-actors/etzhayyim-sdk && pnpm build && node test/integration-eligibility.mjs

import {execSync, spawnSync} from "node:child_process";
import {createPublicClient, createWalletClient, encodeFunctionData, http, keccak256} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {
  ADHERENT_REGISTRY_ABI,
  CONSTITUTION_ABI,
  GOVERNANCE_ABI,
  KISHA_STREAM_ABI,
  PHENOTYPE_ABI,
} from "../dist/abi.js";

const RPC = "http://localhost:8545";

const ADDR = {
  Constitution:        "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  AdherentRegistry:    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  KishaStream:         "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  Phenotype:           "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  AnchorBridge:        "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  Governance:          "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  TreasuryMirror:      "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  CorpusRegistry:      "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  HoldingAttestation:  "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
};

const OFFICER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const officer = privateKeyToAccount(OFFICER_PK);

// Cell key: anvil account #4 (deterministic).
const CELL_PK = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";
const cell = privateKeyToAccount(CELL_PK);

const transport = http(RPC);
const wallet = createWalletClient({account: officer, transport});
const pub = createPublicClient({transport});

const log = (...args) => console.log("•", ...args);
const fail = (msg, ctx) => {
  console.error("✘", msg, ctx ?? "");
  process.exit(1);
};

// ─── Step 0: Anvil + Foundry deploy ─────────────────────────────────

log("Step 0 — forge deploy + bindGovernance");
const officers = [
  officer.address,
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
];
execSync(
  `cd ../../50-infra/etzhayyim-chain-contracts && \
    forge script script/Deploy.s.sol:Deploy \
      --sig "runInternal(address[])" "[${officers.join(",")}]" \
      --rpc-url ${RPC} --broadcast --private-key ${OFFICER_PK}`,
  {stdio: "pipe"}
);
execSync(
  `cd ../../50-infra/etzhayyim-chain-contracts && \
    forge script script/Deploy.s.sol:Deploy \
      --sig "bindGovernance(address,address)" \
      "${ADDR.Constitution}" "${ADDR.Governance}" \
      --rpc-url ${RPC} --broadcast --private-key ${OFFICER_PK}`,
  {stdio: "pipe"}
);

// ─── Step 1: SBT + multi-axis attestations ──────────────────────────

log("Step 1 — mint SBT + attest across all canonical event types");
const joinTx = await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.AdherentRegistry,
  abi: ADHERENT_REGISTRY_ABI,
  functionName: "join",
  args: [officer.address, "did:web:officer1.etzhayyim.com", keccak256(new TextEncoder().encode("oath"))],
});
await pub.waitForTransactionReceipt({hash: joinTx});
const tokenId = await pub.readContract({
  address: ADDR.AdherentRegistry,
  abi: ADHERENT_REGISTRY_ABI,
  functionName: "tokenOf",
  args: [officer.address],
});
log("  tokenId:", tokenId);

const eventTypes = ["prayer", "study", "service", "donation"];
for (const evt of eventTypes) {
  // Two attestations per type spread over a few seconds — enough for
  // the scorer to mark all quartiles "touched".
  for (let i = 0; i < 2; i++) {
    const tx = await wallet.writeContract({
      account: officer,
      chain: null,
      address: ADDR.AdherentRegistry,
      abi: ADHERENT_REGISTRY_ABI,
      functionName: "attest",
      args: [tokenId, keccak256(new TextEncoder().encode(evt)), "0x" + "00".repeat(32)],
    });
    await pub.waitForTransactionReceipt({hash: tx});
    // tiny block-time gap so events have distinct timestamps
    await new Promise((r) => setTimeout(r, 50));
  }
}
log("  attested across", eventTypes.length, "event types (×2 each)");

// ─── Step 2: governance vote to register cell ───────────────────────

log("Step 2 — Governance proposal: Phenotype.registerCell(cell, label)");
const registerCellCalldata = encodeFunctionData({
  abi: PHENOTYPE_ABI,
  functionName: "setMultiplier", // placeholder — we'll override below
  args: [0n, 0, 0n, 0n, 0n, "0x" + "00".repeat(32), "0x0000000000000000000000000000000000000000", "0x"],
});
// Actual registerCell calldata — Phenotype.registerCell(address cell, bytes32 labelHash)
const realRegisterCellAbi = [{
  type: "function",
  name: "registerCell",
  stateMutability: "nonpayable",
  inputs: [
    {name: "cell", type: "address"},
    {name: "labelHash", type: "bytes32"},
  ],
  outputs: [],
}];
const calldata = encodeFunctionData({
  abi: realRegisterCellAbi,
  functionName: "registerCell",
  args: [cell.address, keccak256(new TextEncoder().encode("eligibility-cell-0"))],
});
const proposeTx = await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.Governance,
  abi: GOVERNANCE_ABI,
  functionName: "propose",
  args: [[ADDR.Phenotype], [calldata], keccak256(new TextEncoder().encode("bootstrap-cell"))],
});
const proposeReceipt = await pub.waitForTransactionReceipt({hash: proposeTx});
// proposalId from ProposalCreated indexed[0]
const proposalIdHex = proposeReceipt.logs[0].topics[1];
const proposalId = BigInt(proposalIdHex);
log("  proposalId:", proposalId);

await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.Governance,
  abi: GOVERNANCE_ABI,
  functionName: "castVote",
  args: [proposalId, 1],
});
log("  voted FOR");

const warp = async (secs) => {
  await fetch(RPC, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", method: "evm_increaseTime", params: [secs], id: 1}),
  });
  await fetch(RPC, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1}),
  });
};

await warp(3 * 86400 + 1);
log("  warped +3 days; queueing");
await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.Governance,
  abi: GOVERNANCE_ABI,
  functionName: "queue",
  args: [proposalId],
});
await warp(72 * 3600 + 1);
log("  warped +72h; executing");
await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.Governance,
  abi: GOVERNANCE_ABI,
  functionName: "execute",
  args: [proposalId],
  value: 0n,
});

const cellRegistered = await pub.readContract({
  address: ADDR.Phenotype,
  abi: [{type: "function", name: "isCell", stateMutability: "view", inputs: [{name: "", type: "address"}], outputs: [{name: "", type: "bool"}]}],
  functionName: "isCell",
  args: [cell.address],
});
log("  cell registered on Phenotype:", cellRegistered);
if (!cellRegistered) fail("cell not registered after execute");

// ─── Step 3: invoke Python EligibilityCell.step ─────────────────────

log("Step 3 — Python: run_eligibility_step (web3.py → Phenotype.setMultiplier)");
const pyArgs = [
  "run", "--no-project",
  "--with", "web3", "--with", "eth-account", "--with", "eth-abi",
  "--with", "eth-utils", "--with", "pycryptodome",
  "python", "-m", "scripts.run_eligibility_step",
  "--rpc", RPC,
  "--token-id", String(tokenId),
  "--phenotype-address", ADDR.Phenotype,
  "--registry-address", ADDR.AdherentRegistry,
  "--cell-private-key", CELL_PK,
  "--chain-id", "31337",
  "--epoch", "1",
];
const pyProc = spawnSync("uv", pyArgs, {
  cwd: "../kotodama/py",
  env: {...process.env, PYTHONPATH: "src"},
  stdio: ["ignore", "pipe", "inherit"],
  encoding: "utf-8",
});
if (pyProc.status !== 0) fail(`python exited ${pyProc.status}`);
const pyResult = JSON.parse(pyProc.stdout.trim().split("\n").pop());
log("  python result:", pyResult);
if (!pyResult.ok) fail("python returned ok=false", pyResult);

// ─── Step 4: verify on-chain effects ────────────────────────────────

log("Step 4 — verify multiplier landed");
const newBps = await pub.readContract({
  address: ADDR.Phenotype,
  abi: PHENOTYPE_ABI,
  functionName: "getMultiplierBps",
  args: [tokenId],
});
log("  Phenotype.getMultiplierBps:", newBps);
if (newBps < 5_000 || newBps > 20_000) fail("multiplier out of band", newBps);
if (newBps === 10_000) fail("multiplier unchanged from neutral default", newBps);

// KishaStream.accruedNow should now reflect (baseRate × multiplier / 10_000)
// but only after we wire Phenotype into KishaStream via governance.
// Run a quick second proposal: KishaStream.setPhenotype(phenotype).
log("Step 5 — wire Phenotype into KishaStream via second governance proposal");
const setPhenotypeAbi = [{
  type: "function",
  name: "setPhenotype",
  stateMutability: "nonpayable",
  inputs: [{name: "newPhenotype", type: "address"}],
  outputs: [],
}];
const setPCalldata = encodeFunctionData({
  abi: setPhenotypeAbi,
  functionName: "setPhenotype",
  args: [ADDR.Phenotype],
});
const propose2Tx = await wallet.writeContract({
  account: officer,
  chain: null,
  address: ADDR.Governance,
  abi: GOVERNANCE_ABI,
  functionName: "propose",
  args: [[ADDR.KishaStream], [setPCalldata], keccak256(new TextEncoder().encode("wire-phenotype"))],
});
const r2 = await pub.waitForTransactionReceipt({hash: propose2Tx});
const proposal2Id = BigInt(r2.logs[0].topics[1]);
await wallet.writeContract({
  account: officer, chain: null, address: ADDR.Governance, abi: GOVERNANCE_ABI,
  functionName: "castVote", args: [proposal2Id, 1],
});
await warp(3 * 86400 + 1);
await wallet.writeContract({
  account: officer, chain: null, address: ADDR.Governance, abi: GOVERNANCE_ABI,
  functionName: "queue", args: [proposal2Id],
});
await warp(72 * 3600 + 1);
await wallet.writeContract({
  account: officer, chain: null, address: ADDR.Governance, abi: GOVERNANCE_ABI,
  functionName: "execute", args: [proposal2Id], value: 0n,
});

// Snapshot accrual before and after the multiplier wiring is in
// effect. To isolate the multiplier's contribution we compute two
// readings exactly one day apart (one before wiring, one after a
// fresh +1 day warp post-wiring) and compare the daily delta.
const baseRate = await pub.readContract({
  address: ADDR.KishaStream,
  abi: KISHA_STREAM_ABI,
  functionName: "baseRatePerDay",
});
const accruedBefore = await pub.readContract({
  address: ADDR.KishaStream,
  abi: KISHA_STREAM_ABI,
  functionName: "accruedNow",
  args: [tokenId],
});
await warp(86_400);
const accruedAfter = await pub.readContract({
  address: ADDR.KishaStream,
  abi: KISHA_STREAM_ABI,
  functionName: "accruedNow",
  args: [tokenId],
});
const dailyDelta = accruedAfter - accruedBefore;
const expectedDailyDelta = (baseRate * BigInt(newBps)) / 10_000n;
log("  baseRatePerDay:           ", baseRate);
log("  multiplier(bps):          ", newBps);
log("  accruedNow before +1 day: ", accruedBefore);
log("  accruedNow after +1 day:  ", accruedAfter);
log("  daily delta:              ", dailyDelta);
log("  expected daily delta:     ", expectedDailyDelta, "(= baseRate × bps / 10_000)");

// Tolerance: ~1% of expected, since block.timestamp drift on Anvil
// adds a few seconds of extra accrual per warp.
const diff = dailyDelta > expectedDailyDelta ? dailyDelta - expectedDailyDelta : expectedDailyDelta - dailyDelta;
const tolerance = (expectedDailyDelta * 5n) / 100n + 1_000n; // 5% slack + 1k base units (~0.001 USDC)
if (diff > tolerance) {
  fail("daily accrual delta doesn't match multiplier × baseRate", {dailyDelta, expectedDailyDelta, diff, tolerance});
}
log("  ✓ daily accrual delta matches multiplier × baseRate within ±5%");

console.log("\n✓ e2e PASS — Python EligibilityCell.step lands on-chain; KishaStream.accruedNow reflects the multiplier");

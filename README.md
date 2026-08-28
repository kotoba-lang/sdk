# `@etzhayyim/sdk` (repo: `kotoba-lang/sdk`)

kotoba substrate SDK — **AT Protocol MST + IPFS + Base L2 anchor** behind one
API. Originally `etzhayyim/com-etzhayyim-sdk`; that name now 301-redirects here.

## Status, measured 2026-08-28

This README used to open with:

> **Status**: scaffold v0.0.0. All implementations are TODO stubs.

and closed with "every method throws *not yet implemented*". **Both are false**,
and had been for long enough that a downstream reader (this session) reported
the SDK as a stub on the strength of them. What is actually here:

| | |
|---|---|
| `pnpm install` **as published** | ❌ **fails** — see *The closure is frozen* |
| `pnpm install` + the two overrides below | ✅ 21.1 s |
| `npx tsc --noEmit` | ✅ **exit 0, zero errors** |
| `npx vitest run` | ✅ **7 files / 53 tests / 0 failures** |

~3,800 lines of real implementation live here — `bi.ts` (1190), `encrypted.ts`
(717), `index.ts` (655), `abi.ts` (425), `pay.ts` (336),
`charter-compliance-gate.ts` (273), `donate.ts` (211) — plus twelve ~10-line
re-export shims (`l2`, `paymaster`, `ipfs`, `pds`, `atproto`, `checkpointer`,
`crypto`, `pq`, `kdf`, `signal`, `did-signal`, `kotoba-datomic`) pointing at
six packages that were split out of this repo on 2026-07-01.

## The closure is frozen — do not build new work on it

Those six packages **all moved to Clojure between 2026-07-01 and 2026-08-08**,
and this SDK still pins each at its last TypeScript commit:

| shim → package | pinned here | that pin is | the package today |
|---|---|---|---|
| `l2`, `paymaster` → `@etzhayyim/base-l2` | `14fac05e` | 2026-07-01 TS scaffold | 8 `.clj` / `.cljc`, no `package.json` |
| `checkpointer` → `@etzhayyim/checkpointer` | `63586c4f` | 2026-07-01 TS scaffold | 18 `.clj` + 10 `.cljc` |
| `pds`, `atproto` → `@etzhayyim/atproto-client` | `da29075c` | 2026-07-01 TS scaffold | 2 `.cljc` |
| `ipfs` → `@etzhayyim/ipfs` | `671888e0` | 2026-07-01 TS scaffold | repo renamed `io-ipfs`; `.edn` / `.kotoba` |
| `crypto`, `pq`, `kdf`, `signal`, `did-signal` → `@etzhayyim/pqh` | `ab728717` | 2026-07-01 | 8 `.clj` + 7 `.cljc` |
| — → `@etzhayyim/witness-quorum` | `f86d3d73` | 2026-07-01 TS scaffold | 16 `.clj` |

**So this closure cannot be advanced.** Bumping any of those pins does not get
a newer TypeScript package; it gets a Clojure repository with no npm identity.
The SDK works only because it is pinned to a moment that no longer exists
upstream. Design record: superproject **ADR-2608281200**.

New work should target the `.cljc` substrate directly —
`kotoba-lang/{erc20, eth-crypto, wallet, treasury, pay, chain, cacao, identity,
io-ipfs}` — which is where all six of those packages actually went.
`cloud-itonami/warifu`'s `warifu.substrate.usdc` is a worked example: real USDC
on Base with no dependency on this SDK at all.

## Why it does not install, and the two lines that fix it

`@etzhayyim/checkpointer@63586c4f` is the one edge in the graph that does not
pin its own dependencies:

```json
"@etzhayyim/ipfs": "git+https://github.com/kotoba-lang/ipfs.git#main",
"@etzhayyim/pqh":  "git+https://github.com/kotoba-lang/pqh.git#main"
```

`#main` silently followed both repos through a rename and a change of language.
`kotoba-lang/ipfs` now redirects to `io-ipfs`, whose `package.json` has no
`name` field at all, so the install dies with:

```
ERR_PNPM_MISSING_PACKAGE_NAME  Can't install
git+https://github.com/kotoba-lang/ipfs.git#main: Missing package name
```

This repo now carries `overrides` / `pnpm.overrides` pinning both to the
revisions the SDK already names elsewhere, which is what makes the numbers at
the top of this file reproducible.

⚠️ **`overrides` do not propagate to consumers.** They apply only at the root of
the project being installed. Every consumer of this SDK has to repeat them in
its own `package.json` — `cloud-itonami/ec` discovered this independently and
wrote it up as its ADR-0001. The structural fix is to repin
`@etzhayyim/checkpointer`'s two floating refs; until someone does that, the
duplication is the cost of using this package.

Also expect, on pnpm ≥ 10.26 and npm ≥ 11.16:

- `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` — these are git deps with a
  `prepare: tsc`, so they need an `onlyBuiltDependencies` allowlist in
  `pnpm-workspace.yaml`.
- `npm error code EALLOWSCRIPTS` — npm 11.16 refuses `--allow-scripts` in the
  nested invocation it uses to prepare a git dep. Use pnpm.

## Charter coupling

`charter-compliance-gate.ts` and `donate.ts`'s purpose enum (`kisha`, `tithe`,
`grant`, and the 10 % Public-Fund `TitheRouter` split) encode etzhayyim's
religious-corporation charter directly into the payment API. Per
ADR-2608281200 those concepts are being **separated** into an etzhayyim-only
layer rather than inherited by `cloud-itonami` actors — separated, not deleted,
since removing a charter from a library carries a legal question that ADR does
not settle. Nothing has moved yet; this is a note about direction, not a
completed change.

## What it replaces

| Old (RisingWave-backed) | New (SDK call) |
|---|---|
| `INSERT INTO vertex_<actor>_<kind>` | `e.write({ collection, record, blobs? })` |
| `SELECT ... WHERE` | `e.read({ collection, prefix?, cursor?, limit? })` |
| streaming materialized view | `e.subscribe({ collections })` AsyncGenerator over PDS firehose |
| tamper-evidence / audit log | `e.verify(uri)` returns Merkle proof + on-chain anchor tx |
| large blob in RW row | `WriteOpts.blobs` Map → SDK pins to IPFS, embeds CID in record |
| Stripe Checkout / one-shot charge | `e.pay({ to, amount, reason })` USDC on Base L2 |
| Stripe Billing / subscription | `e.payStream({ to, flowRate, reason })` Superfluid stream |
| Refund / dispute | `e.escrowOpen(...)` + `e.escrowRelease(...)` Gnosis Safe 2-of-3 |
| Revenue share (W-9 1099 distribution) | `e.splitDistribute({ splitAddress, amount })` 0xSplits |

## Quick start

```typescript
import { Etzhayyim } from "@etzhayyim/sdk";

const e = new Etzhayyim({
  did: "did:web:etzhayyim.com",
  pdsUrl: "https://pds.etzhayyim.com",
  ipfsGateway: "https://ipfs.etzhayyim.com",
  ipfsApiUrl: "https://ipfs-api.etzhayyim.com",
  l2RpcUrl: "https://mainnet.base.org",
  anchorContract: "0xANCHOR_ETZHAYYIM",
  signer: passkeyDidSigner,  // WebAuthn → DID-bound
});

// Write — pins blob to IPFS, then createRecord on PDS, then schedules
// MST root for next L2 anchor batch.
const receipt = await e.write({
  collection: "com.etzhayyim.apps.openIsco.occupation",
  record: {
    code: "2511",
    name: "Software Developer",
    major: "2",
    handbookRef: { $type: "blob" },  // SDK fills with IPFS CID
  },
  blobs: new Map([["handbookRef", handbookPdf]]),
});
// → { uri, cid, blobCids, pendingAnchor }

// Read — MST traversal, optional blob fetch.
const { records, cursor } = await e.read<Occupation>({
  collection: "com.etzhayyim.apps.openIsco.occupation",
  prefix: "2",   // major code prefix
  limit: 50,
});

// Verify — third-party Merkle proof against L2 anchor.
const proof = await e.verify(receipt.uri);
// → { included, anchoredAt: { txHash, blockNumber, rootCid }, merklePath }

// Subscribe — replaces streaming MV.
for await (const ev of e.subscribe<Occupation>({
  collections: ["com.etzhayyim.apps.openIsco.occupation"],
})) {
  console.log(ev.op, ev.uri, ev.value);
}
```

## Module layout

Twenty files, not five. Implementations:

```
src/
├── index.ts                     # Etzhayyim class, public types, re-exports
├── bi.ts                        # basic-income accounting
├── encrypted.ts                 # Tahoe-pattern encrypted records
├── abi.ts                       # ABI encode/decode
├── pay.ts                       # USDC + ERC-4337 + Superfluid + Safe + 0xSplits
├── donate.ts                    # donation purposes + TitheRouter split
└── charter-compliance-gate.ts   # charter checks (etzhayyim-specific — see above)
```

Re-export shims onto the six relocated packages — each ~10 lines, and each one
a pointer into the frozen closure:

```
pds.ts atproto.ts    -> @etzhayyim/atproto-client
ipfs.ts              -> @etzhayyim/ipfs
l2.ts paymaster.ts   -> @etzhayyim/base-l2
checkpointer.ts      -> @etzhayyim/checkpointer
crypto.ts pq.ts kdf.ts signal.ts did-signal.ts -> @etzhayyim/pqh
kotoba-datomic/      -> (local)
```

Apps MUST import from `@etzhayyim/sdk` only. Direct imports of `@atproto/api`, IPFS client libraries, or `viem` from app code are prohibited (the SDK is the only seam where substrate clients are imported).

## Hard rules (enforced by ADR-2605172000 + ADR-2605172100 + future CI hook)

State substrate (ADR-2605172000):
- **No `risingwave` / `kysely` / `pg` / `postgres` imports** anywhere under `etzhayyim/root/60-apps/` or `etzhayyim/root/20-actors/` (excluding this SDK itself).
- **No SQL strings** (`SELECT`, `INSERT`, `CREATE TABLE`, `mv_`, `vertex_`) outside SQL-migration test fixtures.
- **No central DB credentials** in app code or env. Identity is DID; signing is WebAuthn or operator-held private key.

Payment substrate (ADR-2605172100):
- **No `stripe` / `paypal` / `square` / `razorpay` / `braintree` / `adyen` imports** anywhere under `etzhayyim/root/`.
- **No fiat currency codes** (`USD`, `EUR`, `JPY`, `INR`, ...) as `currency` field in payment records. USDC base units only.
- **No `bank_account` / `ach_credit` / `wire_transfer` / `card_number` literals**.
- **All payments through SDK pay/payStream/escrow/split methods.** Direct `viem.writeContract` for USDC transfer from app code is prohibited — `src/pay.ts` is the only seam.
- **All payment events recorded as AT Records** (in addition to on-chain tx) so MST traversal can reconstruct payment history without a chain indexer.

## Encrypted records (Tahoe-pattern, ADR-2605181100)

Private state on the substrate. AEAD envelope (`com.etzhayyim.encrypted.record`) + per-recipient Signal-wrapped symmetric key (`com.etzhayyim.encrypted.keyWrap`). The CID over the envelope inherits MST verify-cap + L2 anchor finality from ADR-2605172000.

```typescript
await e.encryptedWrite({
  innerType:  "com.etzhayyim.governance.proposal",
  record:     { title: "Council motion 42", body: "..." },
  recipients: ["did:web:alice.example", "did:web:bob.example"],
});

const { records } = await e.encryptedRead<ProposalBody>({
  innerType: "com.etzhayyim.governance.proposal",
});
```

Direct app imports of `@noble/ciphers` / `@signalapp/libsignal-client` are **prohibited** — same hard-rule seam as `@atproto/api` and `viem`. Use:

- `@etzhayyim/sdk/crypto` — XChaCha20-Poly1305 envelope (real impl)
- `@etzhayyim/sdk/signal` — Signal session, key-wrap/unwrap (real libsignal-backed impl)
- `@etzhayyim/sdk/did-signal` — DID ↔ Signal IdentityKey binding (real impl, Ed25519 over CBOR)

### Reference impl — council deliberation

`test/council-flow.test.ts` is the canonical E2E example: two council members each generate Ed25519 DID keys + libsignal identities, publish DID-signed `signalIdentity` records, then exchange encrypted proposal/vote records over the substrate. Copy-paste template for new private flows (uhl-right-neural council, medical referral cohort, ethics committee, etc.).

### Metadata-leak mitigations (ADR-2605181200)

Two opt-in mitigations on `encryptedWrite{,Standalone}`:

```typescript
await encryptedWriteStandalone(deps, {
  innerType: "...",
  record: {...},
  recipients: [...],
  pad: "bucket",     // ciphertext rounds up to {1, 4, 16, 64} KiB → blob fallback
  blindRkey: true,   // rkey = base32(BLAKE2b-128(symKey || seq)) — hides write time
});
```

Both default off in v0.1.x to give the council-flow reference impl a clean rollout; v0.2.0 will flip them on. Sealed Sender + PDS-side timing/decoy mitigations are tracked in follow-up ADRs.

## Dependencies

- `@atproto/api` — PDS write/read, firehose subscribe
- `viem` — Base L2 RPC + contract interaction
- `@noble/ciphers` + `@noble/hashes` + `@noble/curves` — AEAD, hash, Ed25519 (pure TS)
- `@signalapp/libsignal-client` (optional) — Signal Protocol for key-wrap delivery
- IPFS HTTP API client — resolved: `@etzhayyim/ipfs` (now `kotoba-lang/io-ipfs`)

## Versioning

`package.json` says `0.1.0-alpha` and the code backs that up (53 passing tests,
clean typecheck). The old claim here — "`0.0.0` (scaffold) … every method
throws *not yet implemented*" — was simply never updated.

The surface is not going to stabilise further in TypeScript: see *The closure
is frozen*.

## See also

The three ADR links that used to be here were `../../90-docs/adr/…` relative
paths, which resolved when this was a directory inside `etzhayyim/root` and
resolve nowhere now. They are named rather than linked:

- **ADR-2608281200** (superproject) — the etzhayyim→cloud-itonami/kotoba-lang
  coordinate migration; the source of the freeze table above
- **ADR-2605172000** — substrate hard rule + per-app migration patterns
- **ADR-2605172100** — payment substrate
- **ADR-2605171800** — the MST/IPFS/L2-anchor pipeline this SDK packages
- `cloud-itonami/ec` **ADR-0001** — the same floating-ref breakage, found
  downstream

## License

Apache 2.0

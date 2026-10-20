/**
 * @etzhayyim/sdk
 *
 * kotoba substrate SDK for etzhayyim open religious-corp apps.
 * Per ADR-2605172000 — apps under etzhayyim/root MUST NOT depend on
 * RisingWave or any centralized off-chain DB. This SDK wraps the
 * primary substrate (AT MST + IPFS + Base L2 anchor) as one API.
 *
 * Status: scaffold v0.0.0. All implementations are TODO stubs.
 */
import { AtpAgent } from "@atproto/api";
import * as pdsModule from "./pds.js";
import * as ipfsModule from "./ipfs.js";
// ─── Main SDK class ─────────────────────────────────────────────────
export class Etzhayyim {
    config;
    #pds;
    constructor(config) {
        this.config = {
            did: config.did,
            pdsUrl: config.pdsUrl,
            ipfsGateway: config.ipfsGateway ?? "https://ipfs.etzhayyim.com",
            ipfsApiUrl: config.ipfsApiUrl,
            l2RpcUrl: config.l2RpcUrl ?? "https://mainnet.base.org",
            projectionDiscoverDid: config.projectionDiscoverDid,
            kotobaUrl: config.kotobaUrl,
            yoroGraphCid: config.yoroGraphCid,
            anchorContract: config.anchorContract,
            signer: config.signer,
            session: config.session,
            auth: config.auth,
        };
    }
    /**
     * Lazy-resolve DID → PDS URL, instantiate AtpAgent, attach session/login.
     * Anonymous reads work without `session` or `auth`; writes require one.
     */
    async pds() {
        if (this.#pds)
            return this.#pds;
        const service = this.config.pdsUrl ?? (await pdsModule.resolvePds(this.config.did));
        const agent = new AtpAgent({ service });
        if (this.config.session) {
            const s = this.config.session;
            await agent.resumeSession({
                did: s.did,
                handle: s.handle,
                accessJwt: s.accessJwt,
                refreshJwt: s.refreshJwt,
                active: true,
            });
        }
        else if (this.config.auth) {
            await agent.login({
                identifier: this.config.auth.handle,
                password: this.config.auth.password,
            });
        }
        this.#pds = agent;
        return agent;
    }
    async write(opts) {
        const agent = await this.pds();
        const recordBody = { ...opts.record };
        const blobCids = {};
        if (opts.blobs && opts.blobs.size > 0) {
            if (!this.config.ipfsApiUrl) {
                throw new Error("[etzhayyim-sdk] write(): blobs supplied but ipfsApiUrl not configured");
            }
            for (const [field, blob] of opts.blobs.entries()) {
                const pinned = await ipfsModule.pinBlob(this.config.ipfsApiUrl, blob);
                blobCids[field] = pinned.cid;
                recordBody[field] = {
                    $type: "blob",
                    ref: { $link: pinned.cid },
                    mimeType: blob.type || "application/octet-stream",
                    size: pinned.size,
                };
            }
        }
        const { uri, cid } = await pdsModule.createRecord(agent, this.config.did, opts.collection, recordBody, opts.rkey);
        // Anchoring is async, done by 50-infra/anchor-cron in batches. We
        // surface 0n as "deferred to next batch". `anchorNow: true` would
        // submit synchronously via l2.AnchorClient — TODO when the synchronous
        // path is wired (requires a signer + sequencing the MST root for this
        // single record, which is non-trivial; the cron handles it correctly).
        return {
            uri,
            cid,
            blobCids,
            pendingAnchor: 0n,
        };
    }
    async read(opts) {
        const agent = await this.pds();
        const fetchBlobs = opts.fetchBlobs !== false;
        if (opts.rkey) {
            const rec = await pdsModule.getRecord(agent, this.config.did, opts.collection, opts.rkey);
            if (!rec)
                return { records: [] };
            return {
                records: [await this.#materializeBlobs(rec, fetchBlobs)],
            };
        }
        const limit = Math.min(opts.limit ?? 50, 100);
        const { records: raw, cursor } = await pdsModule.listRecords(agent, this.config.did, opts.collection, { limit, cursor: opts.cursor });
        // Prefix filter: client-side over the fetched page. listRecords paginates
        // by cursor in TID order; callers wanting comprehensive prefix scans must
        // continue paging. mst-projector emits indexed snapshots for large
        // collections where O(N) prefix scan is impractical.
        const filtered = opts.prefix
            ? raw.filter((r) => (r.uri.split("/").pop() ?? "").startsWith(opts.prefix))
            : raw;
        const records = await Promise.all(filtered.map((r) => this.#materializeBlobs(r, fetchBlobs)));
        return { records, cursor };
    }
    async #materializeBlobs(rec, fetchBlobs) {
        if (!fetchBlobs) {
            return { uri: rec.uri, cid: rec.cid, value: rec.value };
        }
        const value = rec.value;
        if (!value || typeof value !== "object") {
            return { uri: rec.uri, cid: rec.cid, value: rec.value };
        }
        const blobs = {};
        for (const [k, v] of Object.entries(value)) {
            if (v &&
                typeof v === "object" &&
                v.$type === "blob") {
                const cid = v.ref?.$link;
                if (cid) {
                    blobs[k] = await ipfsModule.fetchBlob(this.config.ipfsGateway, cid);
                }
            }
        }
        return {
            uri: rec.uri,
            cid: rec.cid,
            value: rec.value,
            blobs: Object.keys(blobs).length > 0 ? blobs : undefined,
        };
    }
    /**
     * Pin raw bytes to IPFS and return the content-addressed CID. Tier D
     * blob path — callers store the returned CID inside an MST record via
     * a `payloadKind: "ipfs"` discriminator (ADR-2605231400 §7).
     *
     * Independent of `write()` because gsplat / vision / satellite payloads
     * are produced by long-running jobs whose register-side record lands
     * minutes later. Splitting the pin from the record write lets the
     * caller hash the payload before deciding whether to re-upload.
     */
    async uploadBlob(opts) {
        if (!this.config.ipfsApiUrl) {
            throw new Error("[etzhayyim-sdk] uploadBlob(): ipfsApiUrl not configured");
        }
        const sizeProbe = opts.data instanceof Blob ? opts.data.size : opts.data.byteLength;
        if (sizeProbe === 0) {
            throw new Error("[etzhayyim-sdk] uploadBlob(): empty payload");
        }
        const mediaType = opts.mediaType ??
            (opts.data instanceof Blob && opts.data.type
                ? opts.data.type
                : "application/octet-stream");
        const pinned = await ipfsModule.pinBlob(this.config.ipfsApiUrl, opts.data);
        return {
            cid: pinned.cid,
            sizeBytes: pinned.size,
            mediaType,
        };
    }
    async verify(_recordUri) {
        throw new Error("[etzhayyim-sdk] verify() not yet implemented. " +
            "TODO: (1) parse AT URI → DID/collection/rkey, (2) fetch record CID " +
            "from PDS, (3) traverse MST upward to the root, (4) query anchor " +
            "contract on Base L2 for the latest root containing this MST entry, " +
            "(5) return Merkle proof + on-chain anchor tx ref.");
    }
    async *subscribe(_opts) {
        throw new Error("[etzhayyim-sdk] subscribe() not yet implemented. " +
            "TODO: open WebSocket to pds /xrpc/com.atproto.sync.subscribeRepos, " +
            "filter ops by opts.collections, yield events.");
    }
    // ─── Payment surface (ADR-2605172100) ────────────────────────────
    /** One-shot USDC payment on Base L2. See ./pay.ts for full opts. */
    async pay(opts) {
        const { pay } = await import("./pay.js");
        return pay(opts);
    }
    /** Open a Superfluid streaming payment. */
    async payStream(opts) {
        const { payStream } = await import("./pay.js");
        return payStream(opts);
    }
    /** Close a Superfluid streaming payment. */
    async payStreamStop(streamId) {
        const { payStreamStop } = await import("./pay.js");
        return payStreamStop(streamId);
    }
    /** Open a Gnosis-Safe-backed escrow (2-of-3: user/recipient/arbiter). */
    async escrowOpen(opts) {
        const { escrowOpen } = await import("./pay.js");
        return escrowOpen(opts);
    }
    /** Release or refund an open escrow. */
    async escrowRelease(safeAddress, to) {
        const { escrowRelease } = await import("./pay.js");
        return escrowRelease(safeAddress, to);
    }
    /** Distribute USDC through an immutable 0xSplits contract. */
    async splitDistribute(opts) {
        const { splitDistribute } = await import("./pay.js");
        return splitDistribute(opts);
    }
    // ─── Basic-income / adherent surface (ADR-2605172300) ─────────────
    /** Optional BI module config. Set per-instance when BI is in use. */
    biConfig;
    /** Mint adherent SBT on geth-private. */
    async biJoin(opts) {
        const { join } = await import("./bi.js");
        return join(opts, this.biConfig ?? {});
    }
    /** Record a participation event. */
    async biAttest(opts) {
        const { attest } = await import("./bi.js");
        return attest(opts, this.biConfig ?? {});
    }
    /** Read accrual + status snapshot for an adherent. */
    async biStatus(tokenId) {
        const { status } = await import("./bi.js");
        return status(tokenId, this.biConfig ?? {});
    }
    /** Claim accrued kisha. Returns immediately on geth-private issue;
     *  the returned `fulfilled` promise resolves once Base settlement lands. */
    async biClaim(opts) {
        const { claim } = await import("./bi.js");
        return claim(opts, this.biConfig ?? {});
    }
    /** Submit a cell-signed phenotype multiplier update (S2). Requires a
     *  signer registered as a cell in Phenotype.sol. Normally invoked
     *  from the Python EligibilityCell; exposed in TS for test rigs. */
    async biSetPhenotype(input) {
        const { setPhenotype } = await import("./bi.js");
        return setPhenotype(input, this.biConfig ?? {});
    }
    /** Submit a governance proposal that adjusts one constitutional mutable. */
    async biPropose(opts) {
        const { propose } = await import("./bi.js");
        return propose(opts, this.biConfig ?? {});
    }
    /** Cast a vote on an active governance proposal. */
    async biVote(proposalId, choice) {
        const { vote } = await import("./bi.js");
        return vote(proposalId, choice, this.biConfig ?? {});
    }
    /** Read the current state of a governance proposal. */
    async biProposalState(proposalId) {
        const { proposalState } = await import("./bi.js");
        return proposalState(proposalId, this.biConfig ?? {});
    }
    // ─── Encrypted records (ADR-2605181100, Tahoe-pattern) ───────────
    /**
     * Write an encrypted record + per-recipient key-wraps in one call.
     *
     * Plaintext is CBOR-encoded and sealed under XChaCha20-Poly1305 with a
     * fresh per-record symmetric key. The key is wrapped to each recipient
     * via the established Signal session (DID-bound per ADR-2605181100). The
     * envelope is stored as `com.etzhayyim.encrypted.record`; one
     * `com.etzhayyim.encrypted.keyWrap` is written per recipient.
     */
    async encryptedWrite(opts) {
        const { encryptedWrite } = await import("./encrypted.js");
        return encryptedWrite(this, opts);
    }
    /**
     * Read and decrypt encrypted records the caller has a read-cap for.
     *
     * Enumerates `com.etzhayyim.encrypted.keyWrap` in the caller's own PDS,
     * unwraps each key via the matching Signal session, and decrypts the
     * referenced `com.etzhayyim.encrypted.record` envelopes.
     */
    async encryptedRead(opts) {
        const { encryptedRead } = await import("./encrypted.js");
        return encryptedRead(this, opts);
    }
}
// ─── Re-exports ─────────────────────────────────────────────────────
export * as pds from "./pds.js";
export * as ipfs from "./ipfs.js";
export * as l2 from "./l2.js";
export * as pay from "./pay.js";
export * as bi from "./bi.js";
export * as paymaster from "./paymaster.js";
export * as crypto from "./crypto.js";
export * as signal from "./signal.js";
export * as pq from "./pq.js";
export * as kdf from "./kdf.js";
export * as didSignal from "./did-signal.js";
export * as atproto from "./atproto.js";
export * as kotobaDatomic from "./kotoba-datomic/index.js";
export { parseUsdc, parseUsdcPerSecond, USDC_BASE } from "./pay.js";
export { ETZHAYYIM_PRIVATE_CHAIN_ID, ETZHAYYIM_PRIVATE_RPC_DEFAULT, } from "./bi.js";
export { sponsoredWriteContract } from "./paymaster.js";
export { AtpAgent, AtpBaseClient, createAgent, xrpc, } from "./atproto.js";
export { donate, isAllowedDonationPurpose, mapDonationPurpose, } from "./donate.js";

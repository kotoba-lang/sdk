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
export interface EtzhayyimConfig {
    /** The actor's DID. Must resolve to a PDS endpoint. */
    did: string;
    /** PDS HTTP endpoint. Default: from DID document `service[type=AtprotoPersonalDataServer]`. */
    pdsUrl?: string;
    /** IPFS HTTP gateway for blob fetch. Default: `https://ipfs.etzhayyim.com`. */
    ipfsGateway?: string;
    /** IPFS HTTP API for pin. Required for write operations with blobs. */
    ipfsApiUrl?: string;
    /** Base L2 RPC URL. Default: `https://mainnet.base.org`. */
    l2RpcUrl?: string;
    /**
     * kotoba-datomic-projection: feed-discover projector DID (ADR-2605231500).
     * When set, feed read paths (`yoro-kotoba/src/feed.ts` getTimeline /
     * getDiscoverFeed) consult the cross-DID projection emitted by
     * mst-projector instead of the single-actor MST. Falls back to the
     * single-actor read on miss.
     */
    projectionDiscoverDid?: string;
    /**
     * kotoba server base URL (e.g. `https://kotoba.etzhayyim.com` or
     * `http://127.0.0.1:8077`). When set, `yoro-kotoba` feed/graph/actor reads
     * resolve through the kotoba Datom log (`datomic.datoms`) — the canonical
     * read path (ADR-2606013200, supersedes the kotoba-datomic-projection leg).
     * Falls back to the PDS/projection path when unset.
     */
    kotobaUrl?: string;
    /**
     * Multibase CID of the kotoba graph holding the yoro feed Datoms.
     * Defaults to the `yoro-social-v1` graph. Shared with the ingest script and
     * the kotoba-server boot registration. See ADR-2606013200.
     */
    yoroGraphCid?: string;
    /** Address of the anchor contract on Base L2 (ADR-2605171800 Stage 5). */
    anchorContract?: `0x${string}`;
    /** Signer for both PDS writes and L2 anchor txns. Pre-bound to `did`. */
    signer?: Signer;
    /**
     * Resumable PDS session. If supplied, write/read use this without
     * re-authenticating. Mutually exclusive with `auth`.
     */
    session?: {
        did: string;
        handle: string;
        accessJwt: string;
        refreshJwt: string;
    };
    /**
     * Password-based PDS login. The SDK calls `agent.login()` on first
     * `pds()` resolution. Use only in trusted environments (servers,
     * CLI seeders); browsers should use OAuth + session.
     */
    auth?: {
        handle: string;
        password: string;
    };
}
export interface Signer {
    signMessage(msg: Uint8Array): Promise<Uint8Array>;
    publicKeyMultibase: string;
}
export interface WriteOpts<T extends Record<string, unknown>> {
    /** Lexicon NSID. e.g. `com.etzhayyim.apps.openIsco.occupation`. */
    collection: string;
    /** Record body. Validated against the resolved lexicon shape. */
    record: T;
    /**
     * Optional record key. If omitted, the SDK generates a TID
     * (timestamp-based; AT Protocol convention).
     */
    rkey?: string;
    /**
     * Optional blobs to pin to IPFS. Keys become CID references inside
     * the record body via the lexicon's $type=blob refs.
     */
    blobs?: Map<string, Blob>;
    /**
     * If true, anchor this record's MST root to Base L2 immediately
     * (synchronous). Default false — anchoring is batched per the
     * SDK's anchor scheduler (every N records or T seconds).
     */
    anchorNow?: boolean;
}
export interface WriteReceipt {
    /** AT URI of the created record. `at://<did>/<collection>/<rkey>`. */
    uri: string;
    /** Content CID of the record. */
    cid: string;
    /** CIDs of any pinned blobs, keyed by the lexicon field name. */
    blobCids: Record<string, string>;
    /**
     * L2 batch sequence number this record will land in. The actual
     * on-chain anchor tx is async unless `anchorNow: true` was set.
     */
    pendingAnchor: bigint;
}
export interface UploadBlobOpts {
    /** Raw bytes to pin. Empty / zero-byte payloads are rejected. */
    data: Uint8Array | Blob;
    /**
     * MIME type echoed back in the receipt and used when the caller stores
     * the resulting CID inside an MST record. Not transmitted to Kubo
     * (Kubo treats all blob payloads as opaque bytes).
     */
    mediaType?: string;
}
export interface UploadBlobReceipt {
    /** Content-addressed CID returned by Kubo. */
    cid: string;
    /** Byte length as reported by Kubo. */
    sizeBytes: number;
    /** Echoed MIME type (defaults to `application/octet-stream`). */
    mediaType: string;
}
export interface ReadOpts {
    /** Lexicon NSID. */
    collection: string;
    /** Specific record key. If set, returns single record. */
    rkey?: string;
    /** Key-prefix filter for MST traversal. */
    prefix?: string;
    /** Pagination cursor (from previous response). */
    cursor?: string;
    /** Page size. Default 50, max 100. */
    limit?: number;
    /** If false, skip blob fetch (return only CID refs). Default true. */
    fetchBlobs?: boolean;
}
export interface ReadResponse<T> {
    records: Array<{
        uri: string;
        cid: string;
        value: T;
        blobs?: Record<string, Blob>;
    }>;
    cursor?: string;
}
export interface VerifyResult {
    /** True if the record is included in an anchored MST root. */
    included: boolean;
    /** L2 anchor tx that finalized the MST root containing this record. */
    anchoredAt?: {
        txHash: `0x${string}`;
        blockNumber: bigint;
        rootCid: string;
    };
    /** Merkle proof from record CID up to the anchored root. */
    merklePath?: string[];
    /** If !included, the reason. */
    reason?: "not-yet-anchored" | "record-not-found" | "anchor-mismatch";
}
export interface SubscribeOpts {
    /** Lexicon NSID(s) to filter the firehose. */
    collections: string[];
    /** Cursor to resume from. Default: now. */
    cursor?: string;
}
export interface SubscribeEvent<T> {
    uri: string;
    cid: string;
    value: T;
    op: "create" | "update" | "delete";
    seq: bigint;
}
export declare class Etzhayyim {
    #private;
    readonly config: Required<Omit<EtzhayyimConfig, "signer" | "pdsUrl" | "ipfsApiUrl" | "anchorContract" | "session" | "auth" | "projectionDiscoverDid" | "kotobaUrl" | "yoroGraphCid">> & Pick<EtzhayyimConfig, "signer" | "pdsUrl" | "ipfsApiUrl" | "anchorContract" | "session" | "auth" | "projectionDiscoverDid" | "kotobaUrl" | "yoroGraphCid">;
    constructor(config: EtzhayyimConfig);
    /**
     * Lazy-resolve DID → PDS URL, instantiate AtpAgent, attach session/login.
     * Anonymous reads work without `session` or `auth`; writes require one.
     */
    pds(): Promise<AtpAgent>;
    write<T extends Record<string, unknown>>(opts: WriteOpts<T>): Promise<WriteReceipt>;
    read<T>(opts: ReadOpts): Promise<ReadResponse<T>>;
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
    uploadBlob(opts: UploadBlobOpts): Promise<UploadBlobReceipt>;
    verify(_recordUri: string): Promise<VerifyResult>;
    subscribe<T>(_opts: SubscribeOpts): AsyncGenerator<SubscribeEvent<T>>;
    /** One-shot USDC payment on Base L2. See ./pay.ts for full opts. */
    pay(opts: Parameters<typeof import("./pay.js").pay>[0]): Promise<import("./pay.js").PaymentReceipt>;
    /** Open a Superfluid streaming payment. */
    payStream(opts: import("./pay.js").PayStreamOpts): Promise<{
        streamId: import("viem").Hex;
        recordUri: string;
        startedAt: bigint;
    }>;
    /** Close a Superfluid streaming payment. */
    payStreamStop(streamId: `0x${string}`): Promise<void>;
    /** Open a Gnosis-Safe-backed escrow (2-of-3: user/recipient/arbiter). */
    escrowOpen(opts: import("./pay.js").EscrowOpenOpts): Promise<{
        safeAddress: import("abitype").Address;
        recordUri: string;
    }>;
    /** Release or refund an open escrow. */
    escrowRelease(safeAddress: `0x${string}`, to: "recipient" | "user"): Promise<{
        txHash: import("viem").Hash;
        recordUri: string;
    }>;
    /** Distribute USDC through an immutable 0xSplits contract. */
    splitDistribute(opts: import("./pay.js").SplitDistributeOpts): Promise<{
        txHash: import("viem").Hash;
        recordUri: string;
    }>;
    /** Optional BI module config. Set per-instance when BI is in use. */
    biConfig?: import("./bi.js").BIConfig;
    /** Mint adherent SBT on geth-private. */
    biJoin(opts: import("./bi.js").JoinOpts): Promise<import("./bi.js").JoinResult>;
    /** Record a participation event. */
    biAttest(opts: import("./bi.js").AttestOpts): Promise<import("./bi.js").AttestResult>;
    /** Read accrual + status snapshot for an adherent. */
    biStatus(tokenId: bigint): Promise<import("./bi.js").KishaStatus>;
    /** Claim accrued kisha. Returns immediately on geth-private issue;
     *  the returned `fulfilled` promise resolves once Base settlement lands. */
    biClaim(opts: import("./bi.js").ClaimOpts): Promise<import("./bi.js").ClaimResult>;
    /** Submit a cell-signed phenotype multiplier update (S2). Requires a
     *  signer registered as a cell in Phenotype.sol. Normally invoked
     *  from the Python EligibilityCell; exposed in TS for test rigs. */
    biSetPhenotype(input: import("./bi.js").PhenotypeUpdateInput): Promise<import("./bi.js").PhenotypeUpdateResult>;
    /** Submit a governance proposal that adjusts one constitutional mutable. */
    biPropose(opts: import("./bi.js").ProposeOpts): Promise<bigint>;
    /** Cast a vote on an active governance proposal. */
    biVote(proposalId: bigint, choice: "for" | "against" | "abstain"): Promise<void>;
    /** Read the current state of a governance proposal. */
    biProposalState(proposalId: bigint): Promise<"Pending" | "Active" | "Defeated" | "Succeeded" | "Queued" | "Executed" | "Canceled" | "Expired">;
    /**
     * Write an encrypted record + per-recipient key-wraps in one call.
     *
     * Plaintext is CBOR-encoded and sealed under XChaCha20-Poly1305 with a
     * fresh per-record symmetric key. The key is wrapped to each recipient
     * via the established Signal session (DID-bound per ADR-2605181100). The
     * envelope is stored as `com.etzhayyim.encrypted.record`; one
     * `com.etzhayyim.encrypted.keyWrap` is written per recipient.
     */
    encryptedWrite<T extends Record<string, unknown>>(opts: import("./encrypted.js").EncryptedWriteOpts<T>): Promise<import("./encrypted.js").EncryptedWriteReceipt>;
    /**
     * Read and decrypt encrypted records the caller has a read-cap for.
     *
     * Enumerates `com.etzhayyim.encrypted.keyWrap` in the caller's own PDS,
     * unwraps each key via the matching Signal session, and decrypts the
     * referenced `com.etzhayyim.encrypted.record` envelopes.
     */
    encryptedRead<T>(opts: import("./encrypted.js").EncryptedReadOpts): Promise<import("./encrypted.js").EncryptedReadResponse<T>>;
}
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
export { sponsoredWriteContract, type SponsoredBundle } from "./paymaster.js";
export { AtpAgent, AtpBaseClient, createAgent, xrpc, type AppBskyActorDefs, type AppBskyFeedDefs, type AppBskyRichtextFacet, type CreateAgentOpts, type XrpcOpts, } from "./atproto.js";
export { donate, isAllowedDonationPurpose, mapDonationPurpose, type DonateOpts, type DonateConfig, type DonateResult, type DonatePurpose, } from "./donate.js";

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

// ─── Configuration ──────────────────────────────────────────────────

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

// ─── Write API (replaces SQL INSERT) ────────────────────────────────

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

// ─── Blob upload API (Tier D — content-addressed IPFS pin) ─────────

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

// ─── Read API (replaces SQL SELECT) ─────────────────────────────────

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

// ─── Verify API (replaces audit trail) ──────────────────────────────

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

// ─── Subscribe API (replaces streaming MV) ──────────────────────────

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

// ─── Main SDK class ─────────────────────────────────────────────────

export class Etzhayyim {
  readonly config: Required<
    Omit<
      EtzhayyimConfig,
      | "signer"
      | "pdsUrl"
      | "ipfsApiUrl"
      | "anchorContract"
      | "session"
      | "auth"
      | "projectionDiscoverDid"
      | "kotobaUrl"
      | "yoroGraphCid"
    >
  > &
    Pick<
      EtzhayyimConfig,
      | "signer"
      | "pdsUrl"
      | "ipfsApiUrl"
      | "anchorContract"
      | "session"
      | "auth"
      | "projectionDiscoverDid"
      | "kotobaUrl"
      | "yoroGraphCid"
    >;

  #pds?: AtpAgent;

  constructor(config: EtzhayyimConfig) {
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
  async pds(): Promise<AtpAgent> {
    if (this.#pds) return this.#pds;

    const service =
      this.config.pdsUrl ?? (await pdsModule.resolvePds(this.config.did));
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
    } else if (this.config.auth) {
      await agent.login({
        identifier: this.config.auth.handle,
        password: this.config.auth.password,
      });
    }

    this.#pds = agent;
    return agent;
  }

  async write<T extends Record<string, unknown>>(
    opts: WriteOpts<T>
  ): Promise<WriteReceipt> {
    const agent = await this.pds();

    const recordBody: Record<string, unknown> = { ...opts.record };
    const blobCids: Record<string, string> = {};

    if (opts.blobs && opts.blobs.size > 0) {
      if (!this.config.ipfsApiUrl) {
        throw new Error(
          "[etzhayyim-sdk] write(): blobs supplied but ipfsApiUrl not configured"
        );
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

    const { uri, cid } = await pdsModule.createRecord(
      agent,
      this.config.did,
      opts.collection,
      recordBody,
      opts.rkey
    );

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

  async read<T>(opts: ReadOpts): Promise<ReadResponse<T>> {
    const agent = await this.pds();
    const fetchBlobs = opts.fetchBlobs !== false;

    if (opts.rkey) {
      const rec = await pdsModule.getRecord(
        agent,
        this.config.did,
        opts.collection,
        opts.rkey
      );
      if (!rec) return { records: [] };
      return {
        records: [await this.#materializeBlobs<T>(rec, fetchBlobs)],
      };
    }

    const limit = Math.min(opts.limit ?? 50, 100);
    const { records: raw, cursor } = await pdsModule.listRecords(
      agent,
      this.config.did,
      opts.collection,
      { limit, cursor: opts.cursor }
    );

    // Prefix filter: client-side over the fetched page. listRecords paginates
    // by cursor in TID order; callers wanting comprehensive prefix scans must
    // continue paging. mst-projector emits indexed snapshots for large
    // collections where O(N) prefix scan is impractical.
    const filtered = opts.prefix
      ? raw.filter((r) => (r.uri.split("/").pop() ?? "").startsWith(opts.prefix!))
      : raw;

    const records = await Promise.all(
      filtered.map((r) => this.#materializeBlobs<T>(r, fetchBlobs))
    );
    return { records, cursor };
  }

  async #materializeBlobs<T>(
    rec: { uri: string; cid: string; value: unknown },
    fetchBlobs: boolean
  ): Promise<{
    uri: string;
    cid: string;
    value: T;
    blobs?: Record<string, Blob>;
  }> {
    if (!fetchBlobs) {
      return { uri: rec.uri, cid: rec.cid, value: rec.value as T };
    }
    const value = rec.value as Record<string, unknown> | null;
    if (!value || typeof value !== "object") {
      return { uri: rec.uri, cid: rec.cid, value: rec.value as T };
    }
    const blobs: Record<string, Blob> = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        v &&
        typeof v === "object" &&
        (v as { $type?: unknown }).$type === "blob"
      ) {
        const cid = (v as { ref?: { $link?: string } }).ref?.$link;
        if (cid) {
          blobs[k] = await ipfsModule.fetchBlob(this.config.ipfsGateway, cid);
        }
      }
    }
    return {
      uri: rec.uri,
      cid: rec.cid,
      value: rec.value as T,
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
  async uploadBlob(opts: UploadBlobOpts): Promise<UploadBlobReceipt> {
    if (!this.config.ipfsApiUrl) {
      throw new Error(
        "[etzhayyim-sdk] uploadBlob(): ipfsApiUrl not configured"
      );
    }
    const sizeProbe =
      opts.data instanceof Blob ? opts.data.size : opts.data.byteLength;
    if (sizeProbe === 0) {
      throw new Error("[etzhayyim-sdk] uploadBlob(): empty payload");
    }
    const mediaType =
      opts.mediaType ??
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

  async verify(_recordUri: string): Promise<VerifyResult> {
    throw new Error(
      "[etzhayyim-sdk] verify() not yet implemented. " +
        "TODO: (1) parse AT URI → DID/collection/rkey, (2) fetch record CID " +
        "from PDS, (3) traverse MST upward to the root, (4) query anchor " +
        "contract on Base L2 for the latest root containing this MST entry, " +
        "(5) return Merkle proof + on-chain anchor tx ref."
    );
  }

  async *subscribe<T>(_opts: SubscribeOpts): AsyncGenerator<SubscribeEvent<T>> {
    throw new Error(
      "[etzhayyim-sdk] subscribe() not yet implemented. " +
        "TODO: open WebSocket to pds /xrpc/com.atproto.sync.subscribeRepos, " +
        "filter ops by opts.collections, yield events."
    );
  }

  // ─── Payment surface (ADR-2605172100) ────────────────────────────

  /** One-shot USDC payment on Base L2. See ./pay.ts for full opts. */
  async pay(opts: Parameters<typeof import("./pay.js").pay>[0]) {
    const { pay } = await import("./pay.js");
    return pay(opts);
  }

  /** Open a Superfluid streaming payment. */
  async payStream(opts: import("./pay.js").PayStreamOpts) {
    const { payStream } = await import("./pay.js");
    return payStream(opts);
  }

  /** Close a Superfluid streaming payment. */
  async payStreamStop(streamId: `0x${string}`) {
    const { payStreamStop } = await import("./pay.js");
    return payStreamStop(streamId);
  }

  /** Open a Gnosis-Safe-backed escrow (2-of-3: user/recipient/arbiter). */
  async escrowOpen(opts: import("./pay.js").EscrowOpenOpts) {
    const { escrowOpen } = await import("./pay.js");
    return escrowOpen(opts);
  }

  /** Release or refund an open escrow. */
  async escrowRelease(safeAddress: `0x${string}`, to: "recipient" | "user") {
    const { escrowRelease } = await import("./pay.js");
    return escrowRelease(safeAddress, to);
  }

  /** Distribute USDC through an immutable 0xSplits contract. */
  async splitDistribute(opts: import("./pay.js").SplitDistributeOpts) {
    const { splitDistribute } = await import("./pay.js");
    return splitDistribute(opts);
  }

  // ─── Basic-income / adherent surface (ADR-2605172300) ─────────────

  /** Optional BI module config. Set per-instance when BI is in use. */
  biConfig?: import("./bi.js").BIConfig;

  /** Mint adherent SBT on geth-private. */
  async biJoin(opts: import("./bi.js").JoinOpts) {
    const { join } = await import("./bi.js");
    return join(opts, this.biConfig ?? {});
  }

  /** Record a participation event. */
  async biAttest(opts: import("./bi.js").AttestOpts) {
    const { attest } = await import("./bi.js");
    return attest(opts, this.biConfig ?? {});
  }

  /** Read accrual + status snapshot for an adherent. */
  async biStatus(tokenId: bigint) {
    const { status } = await import("./bi.js");
    return status(tokenId, this.biConfig ?? {});
  }

  /** Claim accrued kisha. Returns immediately on geth-private issue;
   *  the returned `fulfilled` promise resolves once Base settlement lands. */
  async biClaim(opts: import("./bi.js").ClaimOpts) {
    const { claim } = await import("./bi.js");
    return claim(opts, this.biConfig ?? {});
  }

  /** Submit a cell-signed phenotype multiplier update (S2). Requires a
   *  signer registered as a cell in Phenotype.sol. Normally invoked
   *  from the Python EligibilityCell; exposed in TS for test rigs. */
  async biSetPhenotype(input: import("./bi.js").PhenotypeUpdateInput) {
    const { setPhenotype } = await import("./bi.js");
    return setPhenotype(input, this.biConfig ?? {});
  }

  /** Submit a governance proposal that adjusts one constitutional mutable. */
  async biPropose(opts: import("./bi.js").ProposeOpts) {
    const { propose } = await import("./bi.js");
    return propose(opts, this.biConfig ?? {});
  }

  /** Cast a vote on an active governance proposal. */
  async biVote(proposalId: bigint, choice: "for" | "against" | "abstain") {
    const { vote } = await import("./bi.js");
    return vote(proposalId, choice, this.biConfig ?? {});
  }

  /** Read the current state of a governance proposal. */
  async biProposalState(proposalId: bigint) {
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
  async encryptedWrite<T extends Record<string, unknown>>(
    opts: import("./encrypted.js").EncryptedWriteOpts<T>
  ): Promise<import("./encrypted.js").EncryptedWriteReceipt> {
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
  async encryptedRead<T>(
    opts: import("./encrypted.js").EncryptedReadOpts
  ): Promise<import("./encrypted.js").EncryptedReadResponse<T>> {
    const { encryptedRead } = await import("./encrypted.js");
    return encryptedRead<T>(this, opts);
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
export {
  ETZHAYYIM_PRIVATE_CHAIN_ID,
  ETZHAYYIM_PRIVATE_RPC_DEFAULT,
} from "./bi.js";
export { sponsoredWriteContract, type SponsoredBundle } from "./paymaster.js";
export {
  AtpAgent,
  AtpBaseClient,
  createAgent,
  xrpc,
  type AppBskyActorDefs,
  type AppBskyFeedDefs,
  type AppBskyRichtextFacet,
  type CreateAgentOpts,
  type XrpcOpts,
} from "./atproto.js";
export {
  donate,
  isAllowedDonationPurpose,
  mapDonationPurpose,
  type DonateOpts,
  type DonateConfig,
  type DonateResult,
  type DonatePurpose,
} from "./donate.js";

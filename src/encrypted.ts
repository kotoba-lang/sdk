/**
 * @etzhayyim/sdk/encrypted — orchestration for Tahoe-pattern encrypted
 * records on the AT Protocol substrate.
 *
 * Per ADR-2605181100. Combines:
 *   - crypto.ts        AEAD record-at-rest encryption
 *   - signal.ts        per-recipient key-wrap via Signal session
 *   - did-signal.ts    DID ↔ Signal identity binding verification
 *   - pds.ts           PDS write/read of envelope + keyWrap records
 *
 * The standalone functions below take their dependencies explicitly
 * (agent, sender DID, sender stores, recipient resolver). The
 * `Etzhayyim` class methods in index.ts are thin wrappers that pull
 * the same dependencies out of the instance config.
 */

import type {AtpAgent} from "@atproto/api";

import {blake2b} from "@noble/hashes/blake2b";

import {
  decrypt,
  encrypt,
  generateKey,
  type EncryptedEnvelope,
  type PadOption,
  type PadScheme,
  type SymmetricKey,
} from "./crypto.js";
import {
  verifySignalIdentityHybrid,
  type SignedSignalIdentity,
} from "./did-signal.js";
import * as pds from "./pds.js";
import {
  establishSession,
  establishSessionInitiator,
  establishSessionResponder,
  unwrapKey,
  wrapKey,
  type SessionHandle,
} from "./signal.js";
import {
  PQ_SUITE,
  type HybridKemHandshake,
  type HybridKemPublicBundle,
  type HybridKemSecretBundle,
} from "./pq.js";

const COLLECTION_RECORD = "com.etzhayyim.encrypted.record";
const COLLECTION_KEYWRAP = "com.etzhayyim.encrypted.keyWrap";
const COLLECTION_SIGNAL_IDENTITY = "com.etzhayyim.encrypted.signalIdentity";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ResolvedRecipientIdentity {
  /** Publishable bundle stored in `com.etzhayyim.encrypted.signalIdentity`. */
  publishable: {
    signalIdentityKey: Uint8Array;
    signalRegistrationId: number;
    signedPreKey?: Uint8Array;
    signedPreKeyId?: number;
    signedPreKeySignature?: Uint8Array;
  };
  /** Full signed-record form, used for DID-binding verification. */
  signed: SignedSignalIdentity;
  /** Recipient's Ed25519 DID verification key (resolved from DID document). */
  didVerificationKey: Uint8Array;
  /**
   * Recipient's ML-DSA-65 verification key, when the DID document publishes
   * one (pqh-v1, ADR-2606111300). When set, the binding's pqSignature is
   * REQUIRED — stripping it fails verification.
   */
  didPqVerificationKey?: Uint8Array;
}

/**
 * Resolve a recipient's Signal identity + DID-binding key. Apps with a real
 * did:web / did:plc resolver wire it in here. Tests pass an in-process map.
 */
export type RecipientIdentityResolver = (
  recipientDid: string
) => Promise<ResolvedRecipientIdentity | null>;

export interface EncryptedWriteOpts<T extends Record<string, unknown>> {
  /** Lexicon NSID of the wrapper record. Default: com.etzhayyim.encrypted.record. */
  collection?: string;

  /** Lexicon NSID describing the inner plaintext shape (informational). */
  innerType?: string;

  /** Plaintext record body. CBOR-serializable. */
  record: T;

  /** DIDs to grant read-cap. Sender is auto-added unless `wrapToSelf: false`. */
  recipients: string[];

  /** Also wrap to sender DID (default true). */
  wrapToSelf?: boolean;

  /** Optional override rkey for the envelope record. Default: SDK-generated. */
  rkey?: string;

  /**
   * Pad ciphertext to a fixed bucket size before AEAD. Off by default in
   * v0.1.x; will flip to "bucket" in v0.2.0. Per ADR-2605181200.
   */
  pad?: PadOption;

  /**
   * Replace the timestamp-based TID rkey with a blinded rkey derived from
   * the per-envelope symmetric key. Off by default in v0.1.x; will flip on
   * in v0.2.0. Per ADR-2605181200.
   */
  blindRkey?: boolean;
}

export interface EncryptedWriteReceipt {
  /** AT URI of the encrypted envelope record. */
  uri: string;
  /** CID of the envelope record. */
  cid: string;
  /** keyId (matches envelope.keyId + keyWrap.keyId). */
  keyId: string;
  /** AT URIs of the per-recipient keyWrap records. */
  keyWraps: Array<{recipient: string; uri: string; cid: string}>;
  /**
   * DIDs that could not be resolved or whose signalIdentity binding failed
   * to verify. These recipients did not receive a keyWrap. The envelope is
   * still written (the caller can republish keyWraps later).
   */
  skipped: Array<{recipient: string; reason: string}>;
}

export interface EncryptedReadOpts {
  collection?: string;
  innerType?: string;
  cursor?: string;
  limit?: number;
  /**
   * DIDs whose keyWrap collections to enumerate. The recipient discovers
   * keys by scanning each declared sender's PDS for keyWrap records whose
   * `recipient` field matches `selfDid`. Default: [selfDid] — covers the
   * wrapToSelf-only flow (journal records). For DM-style flows the
   * caller passes the set of known counterparties.
   */
  fromSenders?: string[];
}

export interface EncryptedReadResponse<T> {
  records: Array<{
    uri: string;
    cid: string;
    value: T;
    sender: string;
    createdAt: string;
  }>;
  cursor?: string;
  /** keyWraps that resolved but whose envelope decrypt failed. */
  failed: Array<{uri: string; reason: string}>;
}

// ── Lexicon record shapes ────────────────────────────────────────────────────

interface EncryptedRecordLex {
  v: 1;
  alg: string;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  keyId: string;
  sender: string;
  innerType?: string;
  pad?: PadScheme;
  createdAt: string;
}

// ── rkey blinding (ADR-2605181200) ───────────────────────────────────────────

/** AT Proto TID alphabet (base32-sortable, lowercase). */
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

/**
 * Derive a TID-shaped (13-char base32-sortable) rkey from `symKey || seq`.
 *
 * The first character is fixed to `"2"` so the result satisfies the AT Proto
 * TID validator (real TIDs in the post-2010 epoch start with `"2"` or `"3"`;
 * forcing `"2"` is indistinguishable from a real TID with high timestamp
 * entropy in the upper bits). The remaining 12 chars carry 60 bits of
 * keyed entropy from BLAKE2b-128(symKey || seq).
 */
export function blindRkey(symKey: Uint8Array, seq: number): string {
  if (seq < 0 || seq > 0xffffffff || !Number.isInteger(seq)) {
    throw new Error("[etzhayyim-sdk/encrypted] blindRkey seq must be u32");
  }
  const seqBytes = new Uint8Array(4);
  new DataView(seqBytes.buffer).setUint32(0, seq, false);
  const buf = new Uint8Array(symKey.length + 4);
  buf.set(symKey, 0);
  buf.set(seqBytes, symKey.length);
  const h = blake2b(buf, {dkLen: 16});

  let out = "2";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < h.length && out.length < 13; i++) {
    value = ((value << 8) | h[i]) >>> 0;
    bits += 8;
    while (bits >= 5 && out.length < 13) {
      bits -= 5;
      out += TID_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  return out;
}

interface KeyWrapLex {
  v: 1;
  keyId: string;
  sender: string;
  recipient: string;
  ciphertext: Uint8Array;
  signalSessionId: string;
  /** AT URI of the encrypted envelope this wrap unlocks. */
  recordUri: string;
  /**
   * pqh-v1 hybrid handshake (ADR-2606111300). When present the recipient
   * derives the wrap key via X25519+ML-KEM-768 decapsulation with their own
   * secret bundle — no pre-established session needed, and a recorded wire
   * capture requires breaking BOTH components to recover the record key.
   */
  pqSuite?: typeof PQ_SUITE;
  pqX25519Ephemeral?: Uint8Array;
  pqMlkemCiphertext?: Uint8Array;
  createdAt: string;
}

/** Extract the recipient's published pqh-v1 KEM bundle, if complete. */
function kemBundleOf(signed: SignedSignalIdentity): HybridKemPublicBundle | null {
  if (
    signed.pqSuite === PQ_SUITE &&
    signed.pqX25519PublicKey instanceof Uint8Array &&
    signed.pqMlkemPublicKey instanceof Uint8Array
  ) {
    return {
      suite: PQ_SUITE,
      x25519PublicKey: signed.pqX25519PublicKey,
      mlkemPublicKey: signed.pqMlkemPublicKey,
    };
  }
  return null;
}

// ── Standalone write ─────────────────────────────────────────────────────────

export interface StandaloneWriteDeps {
  /** PDS agent authenticated to write under `senderDid`. */
  agent: AtpAgent;
  /** Sender's DID. */
  senderDid: string;
  /** Resolver for recipient identities. See `RecipientIdentityResolver`. */
  resolveRecipientIdentity: RecipientIdentityResolver;
}

export async function encryptedWriteStandalone<T extends Record<string, unknown>>(
  deps: StandaloneWriteDeps,
  opts: EncryptedWriteOpts<T>
): Promise<EncryptedWriteReceipt> {
  const collection = opts.collection ?? COLLECTION_RECORD;
  const wrapToSelf = opts.wrapToSelf ?? true;

  // 1. Generate a fresh symmetric key and seal the plaintext.
  const symKey = generateKey();
  const envelope: EncryptedEnvelope = encrypt({
    key: symKey,
    sender: deps.senderDid,
    plaintext: opts.record,
    innerType: opts.innerType,
    pad: opts.pad,
  });

  // 2. Write the envelope record to the sender's PDS.
  const envelopeLex: EncryptedRecordLex = {
    v: 1,
    alg: envelope.alg,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
    keyId: envelope.keyId,
    sender: envelope.sender,
    innerType: envelope.innerType,
    pad: envelope.pad,
    createdAt: envelope.createdAt,
  };
  // Per ADR-2605181200: when blindRkey is set, seq=0 for the envelope and
  // seq=1+ for keyWraps under the same symKey. With one symKey per envelope
  // (current SDK design) seq never exceeds (1 + recipients.length).
  const envelopeRkey =
    opts.rkey ?? (opts.blindRkey ? blindRkey(symKey, 0) : undefined);
  const envelopeReceipt = await pds.createRecord(
    deps.agent,
    deps.senderDid,
    collection,
    envelopeLex,
    envelopeRkey
  );

  // 3. For each recipient (incl. self when wrapToSelf): establish Signal
  //    session, wrap the symKey, write the keyWrap record. Skip recipients
  //    whose identity cannot be resolved/verified — caller can retry later.
  const recipientSet = new Set<string>(opts.recipients);
  if (wrapToSelf) recipientSet.add(deps.senderDid);

  const keyWraps: Array<{recipient: string; uri: string; cid: string}> = [];
  const skipped: Array<{recipient: string; reason: string}> = [];

  // keyWrap rkey sequence starts at 1 (envelope used seq=0). Skipped
  // recipients don't consume a seq, so we increment only on successful write.
  let kwSeq = 1;
  for (const recipientDid of recipientSet) {
    let resolved: ResolvedRecipientIdentity | null;
    try {
      resolved = await deps.resolveRecipientIdentity(recipientDid);
    } catch (err) {
      skipped.push({
        recipient: recipientDid,
        reason: `identity resolver threw: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }
    if (!resolved) {
      skipped.push({
        recipient: recipientDid,
        reason: "no com.etzhayyim.encrypted.signalIdentity record found",
      });
      continue;
    }
    const binding = verifySignalIdentityHybrid({
      signed: resolved.signed,
      didVerificationKey: resolved.didVerificationKey,
      didPqVerificationKey: resolved.didPqVerificationKey,
    });
    if (!binding) {
      skipped.push({
        recipient: recipientDid,
        reason: "DID-binding signature failed verification",
      });
      continue;
    }

    let session: SessionHandle;
    let wrap: ReturnType<typeof wrapKey>;
    let handshake: HybridKemHandshake | undefined;
    try {
      const recipientKem = kemBundleOf(resolved.signed);
      if (recipientKem) {
        // R2 (ADR-2606111300, suite pqh-v1): encapsulate to the recipient's
        // signature-covered hybrid KEM bundle. The handshake travels in the
        // keyWrap record; the recipient decapsulates with their own secret
        // bundle — no shared in-memory session required.
        const init = establishSessionInitiator({
          senderDid: deps.senderDid,
          recipientDid,
          recipientKem,
        });
        session = init.session;
        handshake = init.handshake;
      } else {
        // Legacy R1.0 placeholder (no published KEM bundle): in-memory
        // XChaCha20 session, same-process only. One R-cycle read-compat per
        // crypto-agility-policy; recipients SHOULD republish their
        // signalIdentity with a pqh-v1 bundle.
        session = establishSession({
          senderDid: deps.senderDid,
          recipientDid,
        });
      }
      wrap = wrapKey({
        session,
        plaintext: Buffer.from(symKey).toString("base64"),
      });
    } catch (err) {
      skipped.push({
        recipient: recipientDid,
        reason: `Signal session/wrap failed: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }

    const keyWrapLex: KeyWrapLex = {
      v: 1,
      keyId: envelope.keyId,
      sender: deps.senderDid,
      recipient: recipientDid,
      ciphertext: wrap.ciphertext,
      signalSessionId: wrap.signalSessionId,
      recordUri: envelopeReceipt.uri,
      pqSuite: handshake ? PQ_SUITE : undefined,
      pqX25519Ephemeral: handshake?.x25519Ephemeral,
      pqMlkemCiphertext: handshake?.mlkemCiphertext,
      createdAt: envelope.createdAt,
    };
    const kwRkey = opts.blindRkey ? blindRkey(symKey, kwSeq) : undefined;
    const kwReceipt = await pds.createRecord(
      deps.agent,
      deps.senderDid,
      COLLECTION_KEYWRAP,
      keyWrapLex,
      kwRkey
    );
    keyWraps.push({recipient: recipientDid, uri: kwReceipt.uri, cid: kwReceipt.cid});
    if (opts.blindRkey) kwSeq++;
  }

  return {
    uri: envelopeReceipt.uri,
    cid: envelopeReceipt.cid,
    keyId: envelope.keyId,
    keyWraps,
    skipped,
  };
}

// ── Standalone read ──────────────────────────────────────────────────────────

export interface StandaloneReadDeps {
  /** PDS agent authenticated to read under `selfDid`. */
  agent: AtpAgent;
  /** Self DID — the recipient enumerating their own keyWrap collection. */
  selfDid: string;
  /**
   * Resolver to fetch a sender's envelope record. The envelope lives in the
   * sender's PDS (not the recipient's), so callers with a multi-PDS view
   * inject a sender-PDS-aware fetcher here. Default: same agent as `agent`
   * (single-PDS model used by tests).
   */
  fetchEnvelope?: (senderDid: string, recordUri: string) => Promise<EncryptedRecordLex | null>;
  /**
   * Recipient's own pqh-v1 hybrid KEM key material (ADR-2606111300). The
   * secret bundle NEVER leaves the member device; the public bundle MUST be
   * the one published (signature-covered) in the recipient's signalIdentity.
   * Required to unwrap pqSuite="pqh-v1" keyWraps; legacy wraps fall back to
   * the in-memory session model.
   */
  recipientKem?: {
    secretBundle: HybridKemSecretBundle;
    publicBundle: HybridKemPublicBundle;
  };
}

export async function encryptedReadStandalone<T>(
  deps: StandaloneReadDeps,
  opts: EncryptedReadOpts = {}
): Promise<EncryptedReadResponse<T>> {
  const fetchEnvelope =
    deps.fetchEnvelope ?? defaultEnvelopeFetcher(deps.agent);

  // 1. Enumerate keyWraps. Scan each declared sender's PDS for keyWrap
  //    records targeting us. Default scan set is just self (for the
  //    self-wrap / journal use case).
  const senders = opts.fromSenders ?? [deps.selfDid];
  // cursor pagination is single-sender-scoped. When fromSenders has >1 entry
  // the caller can only meaningfully paginate one sender at a time; on a
  // multi-sender call we honor opts.cursor for the first sender then start
  // fresh for the rest.
  let cursor = opts.cursor;
  let lastCursor: string | undefined;
  const allKwRecords: Array<{
    uri: string;
    cid: string;
    value: unknown;
  }> = [];
  for (const senderDid of senders) {
    const list = await pds.listRecords(
      deps.agent,
      senderDid,
      COLLECTION_KEYWRAP,
      {
        limit: opts.limit ?? 50,
        cursor,
        reverse: true,
      }
    );
    lastCursor = list.cursor;
    for (const r of list.records) {
      if ((r.value as KeyWrapLex).recipient === deps.selfDid) {
        allKwRecords.push(r);
      }
    }
    cursor = undefined;
  }

  const records: EncryptedReadResponse<T>["records"] = [];
  const failed: EncryptedReadResponse<T>["failed"] = [];

  for (const kwRecord of allKwRecords) {
    const kw = kwRecord.value as KeyWrapLex;
    // 2. Unwrap the symmetric key.
    let symKey: Uint8Array;
    try {
      let session: SessionHandle;
      if (kw.pqSuite === PQ_SUITE) {
        // R2 (pqh-v1): re-derive the wrap key from the handshake carried in
        // the keyWrap record + our own KEM secret bundle. Works across
        // processes/devices — nothing was pre-shared except published keys.
        if (!deps.recipientKem) {
          throw new Error(
            "keyWrap is pqh-v1 but StandaloneReadDeps.recipientKem is not configured"
          );
        }
        session = establishSessionResponder({
          senderDid: kw.sender,
          recipientDid: kw.recipient,
          handshake: {
            suite: PQ_SUITE,
            x25519Ephemeral: ensureBytes(kw.pqX25519Ephemeral),
            mlkemCiphertext: ensureBytes(kw.pqMlkemCiphertext),
          },
          recipientKemSecret: deps.recipientKem.secretBundle,
          recipientKemPublic: deps.recipientKem.publicBundle,
        });
      } else {
        // Legacy R1.0: in-memory XChaCha20 session (same-process model).
        session = kw.signalSessionId;
      }
      const symKeyB64 = unwrapKey({
        session,
        ciphertext: ensureBytes(kw.ciphertext),
      });
      symKey = Uint8Array.from(Buffer.from(symKeyB64, "base64"));
    } catch (err) {
      failed.push({
        uri: kwRecord.uri,
        reason: `unwrap failed: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }

    // 3. Fetch the referenced envelope record.
    let envelopeLex: EncryptedRecordLex | null;
    try {
      envelopeLex = await fetchEnvelope(kw.sender, kw.recordUri);
    } catch (err) {
      failed.push({
        uri: kwRecord.uri,
        reason: `envelope fetch failed: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }
    if (!envelopeLex) {
      failed.push({uri: kwRecord.uri, reason: "envelope record not found"});
      continue;
    }

    // 4. Optional innerType filter.
    if (opts.innerType && envelopeLex.innerType !== opts.innerType) {
      continue;
    }

    // 5. Decrypt the envelope.
    let plaintext: T;
    try {
      plaintext = decrypt<T>({
        key: symKey as SymmetricKey,
        envelope: {
          v: 1,
          alg: envelopeLex.alg as "xchacha20poly1305",
          nonce: ensureBytes(envelopeLex.nonce),
          ciphertext: ensureBytes(envelopeLex.ciphertext),
          keyId: envelopeLex.keyId,
          sender: envelopeLex.sender,
          innerType: envelopeLex.innerType,
          createdAt: envelopeLex.createdAt,
        },
      });
    } catch (err) {
      failed.push({
        uri: kwRecord.uri,
        reason: `decrypt failed: ${(err as Error).message ?? String(err)}`,
      });
      continue;
    }

    records.push({
      uri: kw.recordUri,
      cid: "", // CID is on the envelope record, not the keyWrap; left empty here.
      value: plaintext,
      sender: kw.sender,
      createdAt: envelopeLex.createdAt,
    });
  }

  return {records, cursor: lastCursor, failed};
}

function defaultEnvelopeFetcher(
  agent: AtpAgent
): (senderDid: string, recordUri: string) => Promise<EncryptedRecordLex | null> {
  return async (senderDid, recordUri) => {
    // recordUri is `at://<sender>/<collection>/<rkey>`.
    const parts = recordUri.replace(/^at:\/\//, "").split("/");
    if (parts.length < 3) return null;
    const collection = parts[1];
    const rkey = parts[2];
    const r = await pds.getRecord(agent, senderDid, collection, rkey);
    return (r?.value as EncryptedRecordLex | undefined) ?? null;
  };
}

function ensureBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v as number[]);
  if (
    typeof v === "object" &&
    v !== null &&
    (v as {type?: unknown}).type === "Buffer" &&
    Array.isArray((v as {data?: unknown}).data)
  ) {
    // Node JSON serialization of Buffer.
    return new Uint8Array((v as {data: number[]}).data);
  }
  throw new TypeError("encrypted.ts: expected Uint8Array");
}

// ── Helper to publish your signalIdentity record ─────────────────────────────

export interface PublishSignalIdentityOpts {
  agent: AtpAgent;
  selfDid: string;
  signed: SignedSignalIdentity;
}

export async function publishSignalIdentity(
  opts: PublishSignalIdentityOpts
): Promise<{uri: string; cid: string}> {
  return pds.createRecord(
    opts.agent,
    opts.selfDid,
    COLLECTION_SIGNAL_IDENTITY,
    {
      did: opts.signed.did,
      signalIdentityKey: opts.signed.signalIdentityKey,
      signalRegistrationId: opts.signed.signalRegistrationId,
      signedPreKey: opts.signed.signedPreKey,
      signedPreKeyId: opts.signed.signedPreKeyId,
      signedPreKeySignature: opts.signed.signedPreKeySignature,
      pqSuite: opts.signed.pqSuite,
      pqX25519PublicKey: opts.signed.pqX25519PublicKey,
      pqMlkemPublicKey: opts.signed.pqMlkemPublicKey,
      createdAt: opts.signed.createdAt,
      signature: opts.signed.signature,
      pqSignature: opts.signed.pqSignature,
    }
  );
}

// ── Etzhayyim-class wrappers (legacy) ────────────────────────────────────────

import type {Etzhayyim} from "./index.js";

/**
 * Class-instance shim. The instance must have:
 *   - `pdsAgent` (set via `e.pdsAgent = ...` or future config)
 *   - `signalStores`
 *   - `resolveRecipientIdentity`
 *
 * For now these are stubbed-out shims that surface a clearer error if the
 * caller forgot to wire them. Apps that want the class-method ergonomic
 * should configure the instance once at startup.
 */
export async function encryptedWrite<T extends Record<string, unknown>>(
  e: Etzhayyim & {
    pdsAgent?: AtpAgent;
    resolveRecipientIdentity?: RecipientIdentityResolver;
  },
  opts: EncryptedWriteOpts<T>
): Promise<EncryptedWriteReceipt> {
  if (!e.pdsAgent || !e.resolveRecipientIdentity) {
    throw new Error(
      "[etzhayyim-sdk/encrypted] Etzhayyim instance missing pdsAgent / " +
        "resolveRecipientIdentity. Configure these on the " +
        "instance, or use encryptedWriteStandalone() directly."
    );
  }
  return encryptedWriteStandalone(
    {
      agent: e.pdsAgent,
      senderDid: e.config.did,
      resolveRecipientIdentity: e.resolveRecipientIdentity,
    },
    opts
  );
}

export async function encryptedRead<T>(
  e: Etzhayyim & {
    pdsAgent?: AtpAgent;
    fetchEnvelope?: StandaloneReadDeps["fetchEnvelope"];
    recipientKem?: StandaloneReadDeps["recipientKem"];
  },
  opts: EncryptedReadOpts
): Promise<EncryptedReadResponse<T>> {
  if (!e.pdsAgent) {
    throw new Error(
      "[etzhayyim-sdk/encrypted] Etzhayyim instance missing pdsAgent. " +
        "Configure it on the instance, or use " +
        "encryptedReadStandalone() directly."
    );
  }
  return encryptedReadStandalone<T>(
    {
      agent: e.pdsAgent,
      selfDid: e.config.did,
      fetchEnvelope: e.fetchEnvelope,
      recipientKem: e.recipientKem,
    },
    opts
  );
}

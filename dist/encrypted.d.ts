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
import type { AtpAgent } from "@atproto/api";
import { type PadOption, type PadScheme } from "./crypto.js";
import { type SignedSignalIdentity } from "./did-signal.js";
import { type HybridKemPublicBundle, type HybridKemSecretBundle } from "./pq.js";
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
export type RecipientIdentityResolver = (recipientDid: string) => Promise<ResolvedRecipientIdentity | null>;
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
    keyWraps: Array<{
        recipient: string;
        uri: string;
        cid: string;
    }>;
    /**
     * DIDs that could not be resolved or whose signalIdentity binding failed
     * to verify. These recipients did not receive a keyWrap. The envelope is
     * still written (the caller can republish keyWraps later).
     */
    skipped: Array<{
        recipient: string;
        reason: string;
    }>;
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
    failed: Array<{
        uri: string;
        reason: string;
    }>;
}
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
/**
 * Derive a TID-shaped (13-char base32-sortable) rkey from `symKey || seq`.
 *
 * The first character is fixed to `"2"` so the result satisfies the AT Proto
 * TID validator (real TIDs in the post-2010 epoch start with `"2"` or `"3"`;
 * forcing `"2"` is indistinguishable from a real TID with high timestamp
 * entropy in the upper bits). The remaining 12 chars carry 60 bits of
 * keyed entropy from BLAKE2b-128(symKey || seq).
 */
export declare function blindRkey(symKey: Uint8Array, seq: number): string;
export interface StandaloneWriteDeps {
    /** PDS agent authenticated to write under `senderDid`. */
    agent: AtpAgent;
    /** Sender's DID. */
    senderDid: string;
    /** Resolver for recipient identities. See `RecipientIdentityResolver`. */
    resolveRecipientIdentity: RecipientIdentityResolver;
}
export declare function encryptedWriteStandalone<T extends Record<string, unknown>>(deps: StandaloneWriteDeps, opts: EncryptedWriteOpts<T>): Promise<EncryptedWriteReceipt>;
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
export declare function encryptedReadStandalone<T>(deps: StandaloneReadDeps, opts?: EncryptedReadOpts): Promise<EncryptedReadResponse<T>>;
export interface PublishSignalIdentityOpts {
    agent: AtpAgent;
    selfDid: string;
    signed: SignedSignalIdentity;
}
export declare function publishSignalIdentity(opts: PublishSignalIdentityOpts): Promise<{
    uri: string;
    cid: string;
}>;
import type { Etzhayyim } from "./index.js";
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
export declare function encryptedWrite<T extends Record<string, unknown>>(e: Etzhayyim & {
    pdsAgent?: AtpAgent;
    resolveRecipientIdentity?: RecipientIdentityResolver;
}, opts: EncryptedWriteOpts<T>): Promise<EncryptedWriteReceipt>;
export declare function encryptedRead<T>(e: Etzhayyim & {
    pdsAgent?: AtpAgent;
    fetchEnvelope?: StandaloneReadDeps["fetchEnvelope"];
    recipientKem?: StandaloneReadDeps["recipientKem"];
}, opts: EncryptedReadOpts): Promise<EncryptedReadResponse<T>>;
export {};

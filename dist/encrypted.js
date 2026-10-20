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
import { blake2b } from "@noble/hashes/blake2b";
import { decrypt, encrypt, generateKey, } from "./crypto.js";
import { verifySignalIdentityHybrid, } from "./did-signal.js";
import * as pds from "./pds.js";
import { establishSession, establishSessionInitiator, establishSessionResponder, unwrapKey, wrapKey, } from "./signal.js";
import { PQ_SUITE, } from "./pq.js";
const COLLECTION_RECORD = "com.etzhayyim.encrypted.record";
const COLLECTION_KEYWRAP = "com.etzhayyim.encrypted.keyWrap";
const COLLECTION_SIGNAL_IDENTITY = "com.etzhayyim.encrypted.signalIdentity";
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
export function blindRkey(symKey, seq) {
    if (seq < 0 || seq > 0xffffffff || !Number.isInteger(seq)) {
        throw new Error("[etzhayyim-sdk/encrypted] blindRkey seq must be u32");
    }
    const seqBytes = new Uint8Array(4);
    new DataView(seqBytes.buffer).setUint32(0, seq, false);
    const buf = new Uint8Array(symKey.length + 4);
    buf.set(symKey, 0);
    buf.set(seqBytes, symKey.length);
    const h = blake2b(buf, { dkLen: 16 });
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
/** Extract the recipient's published pqh-v1 KEM bundle, if complete. */
function kemBundleOf(signed) {
    if (signed.pqSuite === PQ_SUITE &&
        signed.pqX25519PublicKey instanceof Uint8Array &&
        signed.pqMlkemPublicKey instanceof Uint8Array) {
        return {
            suite: PQ_SUITE,
            x25519PublicKey: signed.pqX25519PublicKey,
            mlkemPublicKey: signed.pqMlkemPublicKey,
        };
    }
    return null;
}
export async function encryptedWriteStandalone(deps, opts) {
    const collection = opts.collection ?? COLLECTION_RECORD;
    const wrapToSelf = opts.wrapToSelf ?? true;
    // 1. Generate a fresh symmetric key and seal the plaintext.
    const symKey = generateKey();
    const envelope = encrypt({
        key: symKey,
        sender: deps.senderDid,
        plaintext: opts.record,
        innerType: opts.innerType,
        pad: opts.pad,
    });
    // 2. Write the envelope record to the sender's PDS.
    const envelopeLex = {
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
    const envelopeRkey = opts.rkey ?? (opts.blindRkey ? blindRkey(symKey, 0) : undefined);
    const envelopeReceipt = await pds.createRecord(deps.agent, deps.senderDid, collection, envelopeLex, envelopeRkey);
    // 3. For each recipient (incl. self when wrapToSelf): establish Signal
    //    session, wrap the symKey, write the keyWrap record. Skip recipients
    //    whose identity cannot be resolved/verified — caller can retry later.
    const recipientSet = new Set(opts.recipients);
    if (wrapToSelf)
        recipientSet.add(deps.senderDid);
    const keyWraps = [];
    const skipped = [];
    // keyWrap rkey sequence starts at 1 (envelope used seq=0). Skipped
    // recipients don't consume a seq, so we increment only on successful write.
    let kwSeq = 1;
    for (const recipientDid of recipientSet) {
        let resolved;
        try {
            resolved = await deps.resolveRecipientIdentity(recipientDid);
        }
        catch (err) {
            skipped.push({
                recipient: recipientDid,
                reason: `identity resolver threw: ${err.message ?? String(err)}`,
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
        let session;
        let wrap;
        let handshake;
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
            }
            else {
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
        }
        catch (err) {
            skipped.push({
                recipient: recipientDid,
                reason: `Signal session/wrap failed: ${err.message ?? String(err)}`,
            });
            continue;
        }
        const keyWrapLex = {
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
        const kwReceipt = await pds.createRecord(deps.agent, deps.senderDid, COLLECTION_KEYWRAP, keyWrapLex, kwRkey);
        keyWraps.push({ recipient: recipientDid, uri: kwReceipt.uri, cid: kwReceipt.cid });
        if (opts.blindRkey)
            kwSeq++;
    }
    return {
        uri: envelopeReceipt.uri,
        cid: envelopeReceipt.cid,
        keyId: envelope.keyId,
        keyWraps,
        skipped,
    };
}
export async function encryptedReadStandalone(deps, opts = {}) {
    const fetchEnvelope = deps.fetchEnvelope ?? defaultEnvelopeFetcher(deps.agent);
    // 1. Enumerate keyWraps. Scan each declared sender's PDS for keyWrap
    //    records targeting us. Default scan set is just self (for the
    //    self-wrap / journal use case).
    const senders = opts.fromSenders ?? [deps.selfDid];
    // cursor pagination is single-sender-scoped. When fromSenders has >1 entry
    // the caller can only meaningfully paginate one sender at a time; on a
    // multi-sender call we honor opts.cursor for the first sender then start
    // fresh for the rest.
    let cursor = opts.cursor;
    let lastCursor;
    const allKwRecords = [];
    for (const senderDid of senders) {
        const list = await pds.listRecords(deps.agent, senderDid, COLLECTION_KEYWRAP, {
            limit: opts.limit ?? 50,
            cursor,
            reverse: true,
        });
        lastCursor = list.cursor;
        for (const r of list.records) {
            if (r.value.recipient === deps.selfDid) {
                allKwRecords.push(r);
            }
        }
        cursor = undefined;
    }
    const records = [];
    const failed = [];
    for (const kwRecord of allKwRecords) {
        const kw = kwRecord.value;
        // 2. Unwrap the symmetric key.
        let symKey;
        try {
            let session;
            if (kw.pqSuite === PQ_SUITE) {
                // R2 (pqh-v1): re-derive the wrap key from the handshake carried in
                // the keyWrap record + our own KEM secret bundle. Works across
                // processes/devices — nothing was pre-shared except published keys.
                if (!deps.recipientKem) {
                    throw new Error("keyWrap is pqh-v1 but StandaloneReadDeps.recipientKem is not configured");
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
            }
            else {
                // Legacy R1.0: in-memory XChaCha20 session (same-process model).
                session = kw.signalSessionId;
            }
            const symKeyB64 = unwrapKey({
                session,
                ciphertext: ensureBytes(kw.ciphertext),
            });
            symKey = Uint8Array.from(Buffer.from(symKeyB64, "base64"));
        }
        catch (err) {
            failed.push({
                uri: kwRecord.uri,
                reason: `unwrap failed: ${err.message ?? String(err)}`,
            });
            continue;
        }
        // 3. Fetch the referenced envelope record.
        let envelopeLex;
        try {
            envelopeLex = await fetchEnvelope(kw.sender, kw.recordUri);
        }
        catch (err) {
            failed.push({
                uri: kwRecord.uri,
                reason: `envelope fetch failed: ${err.message ?? String(err)}`,
            });
            continue;
        }
        if (!envelopeLex) {
            failed.push({ uri: kwRecord.uri, reason: "envelope record not found" });
            continue;
        }
        // 4. Optional innerType filter.
        if (opts.innerType && envelopeLex.innerType !== opts.innerType) {
            continue;
        }
        // 5. Decrypt the envelope.
        let plaintext;
        try {
            plaintext = decrypt({
                key: symKey,
                envelope: {
                    v: 1,
                    alg: envelopeLex.alg,
                    nonce: ensureBytes(envelopeLex.nonce),
                    ciphertext: ensureBytes(envelopeLex.ciphertext),
                    keyId: envelopeLex.keyId,
                    sender: envelopeLex.sender,
                    innerType: envelopeLex.innerType,
                    createdAt: envelopeLex.createdAt,
                },
            });
        }
        catch (err) {
            failed.push({
                uri: kwRecord.uri,
                reason: `decrypt failed: ${err.message ?? String(err)}`,
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
    return { records, cursor: lastCursor, failed };
}
function defaultEnvelopeFetcher(agent) {
    return async (senderDid, recordUri) => {
        // recordUri is `at://<sender>/<collection>/<rkey>`.
        const parts = recordUri.replace(/^at:\/\//, "").split("/");
        if (parts.length < 3)
            return null;
        const collection = parts[1];
        const rkey = parts[2];
        const r = await pds.getRecord(agent, senderDid, collection, rkey);
        return r?.value ?? null;
    };
}
function ensureBytes(v) {
    if (v instanceof Uint8Array)
        return v;
    if (Array.isArray(v))
        return new Uint8Array(v);
    if (typeof v === "object" &&
        v !== null &&
        v.type === "Buffer" &&
        Array.isArray(v.data)) {
        // Node JSON serialization of Buffer.
        return new Uint8Array(v.data);
    }
    throw new TypeError("encrypted.ts: expected Uint8Array");
}
export async function publishSignalIdentity(opts) {
    return pds.createRecord(opts.agent, opts.selfDid, COLLECTION_SIGNAL_IDENTITY, {
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
    });
}
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
export async function encryptedWrite(e, opts) {
    if (!e.pdsAgent || !e.resolveRecipientIdentity) {
        throw new Error("[etzhayyim-sdk/encrypted] Etzhayyim instance missing pdsAgent / " +
            "resolveRecipientIdentity. Configure these on the " +
            "instance, or use encryptedWriteStandalone() directly.");
    }
    return encryptedWriteStandalone({
        agent: e.pdsAgent,
        senderDid: e.config.did,
        resolveRecipientIdentity: e.resolveRecipientIdentity,
    }, opts);
}
export async function encryptedRead(e, opts) {
    if (!e.pdsAgent) {
        throw new Error("[etzhayyim-sdk/encrypted] Etzhayyim instance missing pdsAgent. " +
            "Configure it on the instance, or use " +
            "encryptedReadStandalone() directly.");
    }
    return encryptedReadStandalone({
        agent: e.pdsAgent,
        selfDid: e.config.did,
        fetchEnvelope: e.fetchEnvelope,
        recipientKem: e.recipientKem,
    }, opts);
}

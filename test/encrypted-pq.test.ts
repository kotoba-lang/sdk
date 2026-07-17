/**
 * encrypted + pqh-v1 (ADR-2606111300) — R2 key-wrap wiring.
 *
 * Proves the property the R1.0 placeholder could not provide: after ALL
 * in-memory Signal sessions are cleared (simulating a different process /
 * device), the recipient still recovers the record key from the pqh-v1
 * handshake carried in the keyWrap record + their own KEM secret bundle.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AtpAgent } from "@atproto/api";
import { ed25519 } from "@noble/curves/ed25519";
import { randomBytes } from "@noble/hashes/utils";

import { startFakePds } from "./fake-pds.mjs";
import {
  signSignalIdentityHybrid,
  type SignedSignalIdentity,
} from "../src/did-signal.js";
import {
  generateHybridKemKeyPair,
  generateMlDsaKeyPair,
  PQ_SUITE,
  type HybridKemKeyPair,
} from "../src/pq.js";
import { _clearSessions } from "../src/signal.js";
import {
  encryptedReadStandalone,
  encryptedWriteStandalone,
  publishSignalIdentity,
  type ResolvedRecipientIdentity,
} from "../src/encrypted.js";

const ALICE_DID = "did:test:alice";
const BOB_DID = "did:test:bob";

interface PqActor {
  did: string;
  didSigningKey: Uint8Array;
  didVerificationKey: Uint8Array;
  pqSigningKey: Uint8Array;
  pqVerificationKey: Uint8Array;
  kem: HybridKemKeyPair;
  signed: SignedSignalIdentity;
}

function makePqActor(did: string): PqActor {
  const didSigningKey = ed25519.utils.randomPrivateKey();
  const didVerificationKey = ed25519.getPublicKey(didSigningKey);
  const mlDsa = generateMlDsaKeyPair();
  const kem = generateHybridKemKeyPair();

  const signed = signSignalIdentityHybrid(
    {
      did,
      signalIdentityKey: randomBytes(32),
      signalRegistrationId: 1,
      pqSuite: PQ_SUITE,
      pqX25519PublicKey: kem.publicBundle.x25519PublicKey,
      pqMlkemPublicKey: kem.publicBundle.mlkemPublicKey,
      createdAt: new Date().toISOString(),
    },
    didSigningKey,
    mlDsa.secretKey
  );

  return {
    did,
    didSigningKey,
    didVerificationKey,
    pqSigningKey: mlDsa.secretKey,
    pqVerificationKey: mlDsa.publicKey,
    kem,
    signed,
  };
}

function makeResolver(actors: PqActor[]) {
  const map = new Map(actors.map((a) => [a.did, a]));
  return async (did: string): Promise<ResolvedRecipientIdentity | null> => {
    const a = map.get(did);
    if (!a) return null;
    return {
      publishable: {
        signalIdentityKey: a.signed.signalIdentityKey,
        signalRegistrationId: a.signed.signalRegistrationId,
      },
      signed: a.signed,
      didVerificationKey: a.didVerificationKey,
      didPqVerificationKey: a.pqVerificationKey,
    };
  };
}

describe("encrypted — pqh-v1 R2 key-wrap", () => {
  let pds: Awaited<ReturnType<typeof startFakePds>>;
  let agent: AtpAgent;
  let alice: PqActor;
  let bob: PqActor;

  beforeAll(async () => {
    pds = await startFakePds({ sessionDid: ALICE_DID, sessionHandle: "alice.test" });
    agent = new AtpAgent({ service: pds.url });
    await agent.resumeSession({
      did: ALICE_DID,
      handle: "alice.test",
      accessJwt: "stub",
      refreshJwt: "stub",
      active: true,
    });
    alice = makePqActor(ALICE_DID);
    bob = makePqActor(BOB_DID);
    await publishSignalIdentity({ agent, selfDid: ALICE_DID, signed: alice.signed });
    await publishSignalIdentity({ agent, selfDid: BOB_DID, signed: bob.signed });
  });

  afterAll(async () => {
    await pds?.stop();
  });

  it("recipient recovers the record across a session wipe (cross-process)", async () => {
    const receipt = await encryptedWriteStandalone(
      {
        agent,
        senderDid: ALICE_DID,
        resolveRecipientIdentity: makeResolver([alice, bob]),
      },
      {
        record: { text: "pqh-v1 sealed note", n: 42 },
        recipients: [BOB_DID],
        wrapToSelf: false,
      }
    );
    expect(receipt.skipped).toEqual([]);
    expect(receipt.keyWraps).toHaveLength(1);

    // Simulate a different process/device: every in-memory session is gone.
    // Legacy R1.0 wraps are unrecoverable past this line; pqh-v1 wraps are not.
    _clearSessions();

    const res = await encryptedReadStandalone<{ text: string; n: number }>(
      {
        agent,
        selfDid: BOB_DID,
        recipientKem: {
          secretBundle: bob.kem.secretBundle,
          publicBundle: bob.kem.publicBundle,
        },
      },
      { fromSenders: [ALICE_DID] }
    );
    expect(res.failed).toEqual([]);
    expect(res.records).toHaveLength(1);
    expect(res.records[0].value).toEqual({ text: "pqh-v1 sealed note", n: 42 });
    expect(res.records[0].sender).toBe(ALICE_DID);
  });

  it("the wrong recipient's KEM secret cannot unwrap", async () => {
    await encryptedWriteStandalone(
      {
        agent,
        senderDid: ALICE_DID,
        resolveRecipientIdentity: makeResolver([alice, bob]),
      },
      {
        record: { text: "for bob only" },
        recipients: [BOB_DID],
        wrapToSelf: false,
      }
    );
    _clearSessions();

    const mallory = makePqActor("did:test:mallory");
    const res = await encryptedReadStandalone(
      {
        agent,
        selfDid: BOB_DID, // scans bob-targeted wraps...
        recipientKem: {
          // ...but holds mallory's secrets.
          secretBundle: mallory.kem.secretBundle,
          publicBundle: mallory.kem.publicBundle,
        },
      },
      { fromSenders: [ALICE_DID] }
    );
    expect(res.records).toEqual([]);
    expect(res.failed.length).toBeGreaterThan(0);
    for (const f of res.failed) {
      expect(f.reason).toMatch(/unwrap failed/);
    }
  });

  it("pqh-v1 wrap without recipientKem fails with a clear reason", async () => {
    _clearSessions();
    const res = await encryptedReadStandalone(
      { agent, selfDid: BOB_DID },
      { fromSenders: [ALICE_DID] }
    );
    expect(res.records).toEqual([]);
    for (const f of res.failed) {
      expect(f.reason).toMatch(/recipientKem is not configured/);
    }
  });

  it("downgrade: a binding stripped of its pqSignature is skipped at write", async () => {
    const stripped: PqActor = {
      ...bob,
      signed: (() => {
        const { pqSignature: _pq, ...rest } = bob.signed;
        return rest as SignedSignalIdentity;
      })(),
    };
    const receipt = await encryptedWriteStandalone(
      {
        agent,
        senderDid: ALICE_DID,
        resolveRecipientIdentity: makeResolver([alice, stripped]),
      },
      {
        record: { text: "must not be wrapped" },
        recipients: [BOB_DID],
        wrapToSelf: false,
      }
    );
    expect(receipt.keyWraps).toEqual([]);
    expect(receipt.skipped).toHaveLength(1);
    expect(receipt.skipped[0].reason).toMatch(/DID-binding/);
  });
});

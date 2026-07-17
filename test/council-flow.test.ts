/**
 * Reference impl — uhl-right-neural council deliberation flow over the
 * Tahoe-pattern encrypted-record substrate (ADR-2605181100).
 *
 * Two council members (Alice, Bob) each generate:
 *   - an Ed25519 DID signing key (stands in for did:web verificationMethod),
 *   - a libsignal IdentityKey + signed pre-key,
 *   - a DID-signed com.etzhayyim.encrypted.signalIdentity record published
 *     to a single shared fake-PDS (multi-session mode).
 *
 * Flow:
 *   1. Alice writes an encrypted PROPOSAL with recipients [Alice, Bob].
 *   2. Bob enumerates keyWraps in his own and Alice's repos, unwraps the
 *      symmetric key via Signal session, decrypts the proposal envelope.
 *   3. Bob writes an encrypted VOTE referencing the proposal AT URI, with
 *      recipients [Alice, Bob].
 *   4. Alice enumerates keyWraps the same way, decrypts the vote.
 *
 * This validates the full path: AEAD + libsignal X3DH + DID-binding +
 * cross-actor PDS read.
 */

import {AtpAgent} from "@atproto/api";
import {ed25519} from "@noble/curves/ed25519";
import {randomBytes} from "@noble/hashes/utils";
import {beforeAll, afterAll, describe, expect, it} from "vitest";

import {
  encryptedReadStandalone,
  encryptedWriteStandalone,
  publishSignalIdentity,
  type RecipientIdentityResolver,
  type ResolvedRecipientIdentity,
} from "../src/encrypted.js";
import {signSignalIdentity, type SignedSignalIdentity} from "../src/did-signal.js";
// @ts-expect-error fake-pds is a sibling .mjs without TS types
import {startFakePds} from "./fake-pds.mjs";

type PublishableIdentity = ResolvedRecipientIdentity["publishable"];
function makePublishableIdentity(): PublishableIdentity {
  return {
    signalIdentityKey: randomBytes(32),
    signalRegistrationId: 1,
    signedPreKey: randomBytes(32),
    signedPreKeyId: 1,
    signedPreKeySignature: randomBytes(64),
  };
}

interface CouncilActor {
  did: string;
  didPrivKey: Uint8Array;
  didPubKey: Uint8Array;
  publishable: PublishableIdentity;
  signed: SignedSignalIdentity;
  agent: AtpAgent;
  accessJwt: string;
}

interface Proposal {
  title: string;
  body: string;
  author: string;
  category: string;
  createdAt: string;
}

interface Vote {
  proposalUri: string;
  voter: string;
  choice: "for" | "against" | "abstain";
  rationale?: string;
  createdAt: string;
}

const ALICE_DID = "did:web:alice.council.test";
const BOB_DID = "did:web:bob.council.test";

describe("council deliberation flow (Tahoe-pattern E2E)", () => {
  let pds: {url: string; port: number; records: Map<string, unknown>; stop(): Promise<void>};
  let alice: CouncilActor;
  let bob: CouncilActor;

  async function makeActor(
    did: string,
    handle: string,
    accessJwt: string,
    sharedSessions: Map<string, {did: string; handle: string}>
  ): Promise<CouncilActor> {
    sharedSessions.set(accessJwt, {did, handle});

    const didPrivKey = ed25519.utils.randomPrivateKey();
    const didPubKey = ed25519.getPublicKey(didPrivKey);

    const publishable = makePublishableIdentity();

    const signed = signSignalIdentity(
      {
        did,
        signalIdentityKey: publishable.signalIdentityKey,
        signalRegistrationId: publishable.signalRegistrationId,
        signedPreKey: publishable.signedPreKey,
        signedPreKeyId: publishable.signedPreKeyId,
        signedPreKeySignature: publishable.signedPreKeySignature,
        createdAt: new Date().toISOString(),
      },
      didPrivKey
    );

    const agent = new AtpAgent({service: pds.url});
    await agent.resumeSession({
      did,
      handle,
      accessJwt,
      refreshJwt: `refresh-${accessJwt}`,
      active: true,
    });

    return {did, didPrivKey, didPubKey, publishable, signed, agent, accessJwt};
  }

  beforeAll(async () => {
    const sharedSessions = new Map<string, {did: string; handle: string}>();
    pds = await startFakePds({port: 0, sessions: sharedSessions});

    alice = await makeActor(ALICE_DID, "alice.council.test", "jwt-alice", sharedSessions);
    bob = await makeActor(BOB_DID, "bob.council.test", "jwt-bob", sharedSessions);

    // Publish each actor's signalIdentity record into their own repo.
    await publishSignalIdentity({agent: alice.agent, selfDid: alice.did, signed: alice.signed});
    await publishSignalIdentity({agent: bob.agent, selfDid: bob.did, signed: bob.signed});
  });

  afterAll(async () => {
    await pds?.stop();
  });

  function recipientResolver(): RecipientIdentityResolver {
    // The two-actor universe is closed; resolve by DID lookup. Apps with a
    // real did:web / did:plc resolver wire it here.
    const byDid: Record<string, CouncilActor> = {
      [alice.did]: alice,
      [bob.did]: bob,
    };
    return async (recipientDid: string): Promise<ResolvedRecipientIdentity | null> => {
      const a = byDid[recipientDid];
      if (!a) return null;
      return {
        publishable: a.signed,
        signed: a.signed,
        didVerificationKey: a.didPubKey,
      };
    };
  }

  it("Alice writes a proposal; Bob reads and decrypts it", async () => {
    const proposal: Proposal = {
      title: "Refer patient #42 to UMich",
      body: "DFNB9 + neural-axis pattern matches the UMich cohort. " +
        "Proposing referral with ethics review.",
      author: alice.did,
      category: "medical-referral",
      createdAt: new Date().toISOString(),
    };

    const receipt = await encryptedWriteStandalone(
      {
        agent: alice.agent,
        senderDid: alice.did,
        resolveRecipientIdentity: recipientResolver(),
      },
      {
        innerType: "com.etzhayyim.governance.proposal",
        record: proposal as unknown as Record<string, unknown>,
        recipients: [bob.did],
      }
    );

    expect(receipt.uri).toMatch(/^at:\/\/did:web:alice/);
    expect(receipt.keyWraps).toHaveLength(2); // bob + self
    expect(receipt.skipped).toHaveLength(0);

    const proposalUri = receipt.uri;

    // Bob reads. fromSenders=[alice.did] scans Alice's keyWrap collection
    // for entries whose recipient === bob.did.
    const bobView = await encryptedReadStandalone<Proposal>(
      {
        agent: bob.agent,
        selfDid: bob.did,
      },
      {
        fromSenders: [alice.did],
      }
    );

    expect(bobView.records).toHaveLength(1);
    expect(bobView.failed).toHaveLength(0);
    expect(bobView.records[0].sender).toBe(alice.did);
    expect(bobView.records[0].value.title).toBe(proposal.title);
    expect(bobView.records[0].value.category).toBe("medical-referral");
    expect(bobView.records[0].uri).toBe(proposalUri);

    // Stash for the next test.
    (alice as CouncilActor & {lastProposalUri?: string}).lastProposalUri = proposalUri;
  });

  it("Bob votes; Alice reads and tallies", async () => {
    const proposalUri =
      (alice as CouncilActor & {lastProposalUri?: string}).lastProposalUri;
    expect(proposalUri).toBeDefined();

    const vote: Vote = {
      proposalUri: proposalUri!,
      voter: bob.did,
      choice: "for",
      rationale: "DFNB9 fit is strong; UMich consent process meets ethics bar.",
      createdAt: new Date().toISOString(),
    };

    const receipt = await encryptedWriteStandalone(
      {
        agent: bob.agent,
        senderDid: bob.did,
        resolveRecipientIdentity: recipientResolver(),
      },
      {
        innerType: "com.etzhayyim.governance.vote",
        record: vote as unknown as Record<string, unknown>,
        recipients: [alice.did],
      }
    );

    expect(receipt.keyWraps).toHaveLength(2); // alice + self
    expect(receipt.skipped).toHaveLength(0);

    const aliceView = await encryptedReadStandalone<Vote>(
      {
        agent: alice.agent,
        selfDid: alice.did,
      },
      {
        fromSenders: [bob.did],
        innerType: "com.etzhayyim.governance.vote",
      }
    );

    expect(aliceView.records).toHaveLength(1);
    expect(aliceView.failed).toHaveLength(0);
    const v = aliceView.records[0].value;
    expect(v.choice).toBe("for");
    expect(v.voter).toBe(bob.did);
    expect(v.proposalUri).toBe(proposalUri);

    // Trivial tally over the single vote.
    const tally = {for: 0, against: 0, abstain: 0};
    for (const r of aliceView.records) tally[r.value.choice]++;
    expect(tally).toEqual({for: 1, against: 0, abstain: 0});
  });

  it("rejects a forged signalIdentity (wrong DID key)", async () => {
    // Carol tries to MitM by submitting Bob's signal identity bound to a
    // different DID key. The resolver returns the wrong didVerificationKey;
    // verifySignalIdentity inside encryptedWriteStandalone should mark Carol
    // as skipped.
    const carolDid = "did:web:carol.attacker.test";
    const carolPriv = ed25519.utils.randomPrivateKey();
    const carolWrongPub = ed25519.getPublicKey(ed25519.utils.randomPrivateKey()); // unrelated key

    const carolPublishable = makePublishableIdentity();
    const carolSigned = signSignalIdentity(
      {
        did: carolDid,
        signalIdentityKey: carolPublishable.signalIdentityKey,
        signalRegistrationId: carolPublishable.signalRegistrationId,
        signedPreKey: carolPublishable.signedPreKey,
        signedPreKeyId: carolPublishable.signedPreKeyId,
        signedPreKeySignature: carolPublishable.signedPreKeySignature,
        createdAt: new Date().toISOString(),
      },
      carolPriv
    );

    const resolverWithCarol: RecipientIdentityResolver = async (did) => {
      if (did === carolDid) {
        return {
          publishable: carolSigned,
          signed: carolSigned,
          didVerificationKey: carolWrongPub, // mismatched → verify fails
        };
      }
      return null;
    };

    const receipt = await encryptedWriteStandalone(
      {
        agent: alice.agent,
        senderDid: alice.did,
        resolveRecipientIdentity: resolverWithCarol,
      },
      {
        innerType: "com.etzhayyim.governance.proposal",
        record: {title: "x", body: "y", author: alice.did, category: "x", createdAt: "t"},
        recipients: [carolDid],
        wrapToSelf: false,
      }
    );

    expect(receipt.skipped).toHaveLength(1);
    expect(receipt.skipped[0].recipient).toBe(carolDid);
    expect(receipt.skipped[0].reason).toMatch(/DID-binding/);
    expect(receipt.keyWraps).toHaveLength(0);
  });
});

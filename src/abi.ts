/**
 * @etzhayyim/sdk/abi — minimal ABI fragments for the contracts the SDK
 * touches. Hand-pinned to the deployed bytecode of:
 *
 *   - 50-infra/etzhayyim-membership-contract/src/EtzhayyimMembership.sol
 *   - 50-infra/etzhayyim-chain-contracts/src/AdherentRegistry.sol
 *   - 50-infra/etzhayyim-chain-contracts/src/KishaStream.sol
 *   - 50-infra/etzhayyim-chain-contracts/src/base/KishaPayout.sol
 *
 * Only the functions / events the SDK calls or reads are included; full
 * ABIs ship with the contract artifacts and can be loaded from there
 * if a caller needs broader surface area.
 *
 * The `as const` annotations are intentional — viem uses them to
 * infer parameter types statically.
 */

// ─── EtzhayyimMembership (Base L2, ADR-2605172600) ──────────────────

export const ETZHAYYIM_MEMBERSHIP_ABI = [
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [
      { name: "oathHash", type: "bytes32" },
      { name: "githubUsername", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "members",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "oathHash", type: "bytes32" },
      { name: "githubUsername", type: "string" },
      { name: "joinedAt", type: "uint64" },
      { name: "revokedAt", type: "uint64" },
      { name: "level", type: "uint8" },
    ],
  },
  {
    type: "event",
    name: "Joined",
    anonymous: false,
    inputs: [
      { name: "member", type: "address", indexed: true },
      { name: "oathHash", type: "bytes32", indexed: true },
      { name: "githubUsername", type: "string", indexed: false },
      { name: "joinedAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "error",
    name: "AlreadyMember",
    inputs: [{ name: "sender", type: "address" }],
  },
  {
    type: "error",
    name: "EmptyOathHash",
    inputs: [],
  },
] as const;

// ─── AdherentRegistry (geth-private, ADR-2605172300 S0) ─────────────

export const ADHERENT_REGISTRY_ABI = [
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [
      { name: "holder", type: "address" },
      { name: "did", type: "string" },
      { name: "attestationCid", type: "bytes32" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "attest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "eventType", type: "bytes32" },
      { name: "evidenceCid", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "windowSecs", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getRecord",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "holder", type: "address" },
          { name: "did", type: "string" },
          { name: "joinAttestation", type: "bytes32" },
          { name: "joinedAt", type: "uint64" },
          { name: "lastAttestedAt", type: "uint64" },
          { name: "attestationCount", type: "uint32" },
          { name: "revoked", type: "bool" },
          { name: "revokeReason", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "Joined",
    anonymous: false,
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "did", type: "string", indexed: false },
      { name: "attestationCid", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Attested",
    anonymous: false,
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "eventType", type: "bytes32", indexed: true },
      { name: "evidenceCid", type: "bytes32", indexed: false },
      { name: "attestedAt", type: "uint64", indexed: false },
    ],
  },
] as const;

// ─── Phenotype (geth-private, ADR-2605172300 S2) ────────────────────

export const PHENOTYPE_ABI = [
  {
    type: "function",
    name: "getMultiplierBps",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "expectedNonce",
    stateMutability: "view",
    inputs: [{ name: "cell", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "payloadHash",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "newBps", type: "uint16" },
      { name: "epoch", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "cell", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setMultiplier",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "newBps", type: "uint16" },
      { name: "epoch", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "cell", type: "address" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "MultiplierSet",
    anonymous: false,
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "cell", type: "address", indexed: true },
      { name: "oldBps", type: "uint16", indexed: false },
      { name: "newBps", type: "uint16", indexed: false },
      { name: "epoch", type: "uint64", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ─── KishaStream (geth-private, ADR-2605172300 S1) ──────────────────

export const KISHA_STREAM_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "baseRecipient", type: "address" },
      { name: "maxAmount", type: "uint256" },
    ],
    outputs: [
      { name: "ticketId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "accruedNow",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "baseRatePerDay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "ClaimTicketIssued",
    anonymous: false,
    inputs: [
      { name: "ticketId", type: "bytes32", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "baseRecipient", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "claimSeq", type: "uint64", indexed: false },
      { name: "issuedAt", type: "uint64", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  // Errors — exposed so the SDK can map them to typed JS errors.
  { type: "error", name: "NotHolder", inputs: [] },
  { type: "error", name: "TokenRevoked", inputs: [] },
  { type: "error", name: "NotActive", inputs: [] },
  { type: "error", name: "NothingAccrued", inputs: [] },
  { type: "error", name: "AmountAboveAccrued", inputs: [] },
] as const;

// ─── KishaPayout (Base L2, ADR-2605172300 S1) ───────────────────────

export const KISHA_PAYOUT_ABI = [
  {
    type: "function",
    name: "fulfilled",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Fulfilled",
    anonymous: false,
    inputs: [
      { name: "ticketId", type: "bytes32", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "baseRecipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fulfilledAt", type: "uint64", indexed: false },
    ],
  },
] as const;

// ─── Constitution (geth-private, ADR-2605172300 S0) ─────────────────
// Only the surface the SDK needs to encode setMutable() proposals.

export const CONSTITUTION_ABI = [
  {
    type: "function",
    name: "setMutable",
    stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "bytes32" },
      { name: "value", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getMutable",
    stateMutability: "view",
    inputs: [{ name: "key", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "governance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ─── Governance (geth-private, ADR-2605172300 S3) ───────────────────

export const GOVERNANCE_ABI = [
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "targets", type: "address[]" },
      { name: "calldatas", type: "bytes[]" },
      { name: "descCid", type: "bytes32" },
    ],
    outputs: [{ name: "proposalId", type: "uint256" }],
  },
  {
    type: "function",
    name: "castVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "choice", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "queue",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "ProposalCreated",
    anonymous: false,
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      { name: "proposerTokenId", type: "uint256", indexed: true },
      { name: "targets", type: "address[]", indexed: false },
      { name: "calldatas", type: "bytes[]", indexed: false },
      { name: "descCid", type: "bytes32", indexed: false },
      { name: "voteStart", type: "uint64", indexed: false },
      { name: "voteEnd", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoteCast",
    anonymous: false,
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "choice", type: "uint8", indexed: false },
      { name: "voter", type: "address", indexed: false },
    ],
  },
] as const;

/**
 * Governance proposal state mirror — matches the on-chain
 * `Governance.State` enum exactly. Used by `Etzhayyim.biProposalState()`.
 */
export const GOVERNANCE_STATE = {
  Pending: 0,
  Active: 1,
  Defeated: 2,
  Succeeded: 3,
  Queued: 4,
  Executed: 5,
  Canceled: 6,
  Expired: 7,
} as const;

export type GovernanceStateLabel = keyof typeof GOVERNANCE_STATE;

/** Vote choice → uint8 mapping. Matches Governance.castVote semantics. */
export const VOTE_CHOICE = {
  against: 0,
  for: 1,
  abstain: 2,
} as const;

// ─── Lexicon NSID for the oath AT Record (ADR-2605172600) ───────────

export const OATH_RECORD_NSID = "com.etzhayyim.apps.etzhayyim.oath" as const;

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
export declare const ETZHAYYIM_MEMBERSHIP_ABI: readonly [{
    readonly type: "function";
    readonly name: "join";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "oathHash";
        readonly type: "bytes32";
    }, {
        readonly name: "githubUsername";
        readonly type: "string";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "members";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "oathHash";
        readonly type: "bytes32";
    }, {
        readonly name: "githubUsername";
        readonly type: "string";
    }, {
        readonly name: "joinedAt";
        readonly type: "uint64";
    }, {
        readonly name: "revokedAt";
        readonly type: "uint64";
    }, {
        readonly name: "level";
        readonly type: "uint8";
    }];
}, {
    readonly type: "event";
    readonly name: "Joined";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "member";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "oathHash";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "githubUsername";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "joinedAt";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}, {
    readonly type: "error";
    readonly name: "AlreadyMember";
    readonly inputs: readonly [{
        readonly name: "sender";
        readonly type: "address";
    }];
}, {
    readonly type: "error";
    readonly name: "EmptyOathHash";
    readonly inputs: readonly [];
}];
export declare const ADHERENT_REGISTRY_ABI: readonly [{
    readonly type: "function";
    readonly name: "join";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "holder";
        readonly type: "address";
    }, {
        readonly name: "did";
        readonly type: "string";
    }, {
        readonly name: "attestationCid";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "attest";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "eventType";
        readonly type: "bytes32";
    }, {
        readonly name: "evidenceCid";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "tokenOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "isActive";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "windowSecs";
        readonly type: "uint64";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly type: "function";
    readonly name: "getRecord";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "holder";
            readonly type: "address";
        }, {
            readonly name: "did";
            readonly type: "string";
        }, {
            readonly name: "joinAttestation";
            readonly type: "bytes32";
        }, {
            readonly name: "joinedAt";
            readonly type: "uint64";
        }, {
            readonly name: "lastAttestedAt";
            readonly type: "uint64";
        }, {
            readonly name: "attestationCount";
            readonly type: "uint32";
        }, {
            readonly name: "revoked";
            readonly type: "bool";
        }, {
            readonly name: "revokeReason";
            readonly type: "bytes32";
        }];
    }];
}, {
    readonly type: "event";
    readonly name: "Joined";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "holder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "did";
        readonly type: "string";
        readonly indexed: false;
    }, {
        readonly name: "attestationCid";
        readonly type: "bytes32";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "Attested";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "eventType";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "evidenceCid";
        readonly type: "bytes32";
        readonly indexed: false;
    }, {
        readonly name: "attestedAt";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}];
export declare const PHENOTYPE_ABI: readonly [{
    readonly type: "function";
    readonly name: "getMultiplierBps";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint16";
    }];
}, {
    readonly type: "function";
    readonly name: "expectedNonce";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "cell";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint64";
    }];
}, {
    readonly type: "function";
    readonly name: "payloadHash";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "newBps";
        readonly type: "uint16";
    }, {
        readonly name: "epoch";
        readonly type: "uint64";
    }, {
        readonly name: "nonce";
        readonly type: "uint64";
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
    }, {
        readonly name: "evidenceHash";
        readonly type: "bytes32";
    }, {
        readonly name: "cell";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
}, {
    readonly type: "function";
    readonly name: "setMultiplier";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "newBps";
        readonly type: "uint16";
    }, {
        readonly name: "epoch";
        readonly type: "uint64";
    }, {
        readonly name: "nonce";
        readonly type: "uint64";
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
    }, {
        readonly name: "evidenceHash";
        readonly type: "bytes32";
    }, {
        readonly name: "cell";
        readonly type: "address";
    }, {
        readonly name: "sig";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "event";
    readonly name: "MultiplierSet";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "cell";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "oldBps";
        readonly type: "uint16";
        readonly indexed: false;
    }, {
        readonly name: "newBps";
        readonly type: "uint16";
        readonly indexed: false;
    }, {
        readonly name: "epoch";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "evidenceHash";
        readonly type: "bytes32";
        readonly indexed: false;
    }];
}];
export declare const KISHA_STREAM_ABI: readonly [{
    readonly type: "function";
    readonly name: "claim";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }, {
        readonly name: "baseRecipient";
        readonly type: "address";
    }, {
        readonly name: "maxAmount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "ticketId";
        readonly type: "bytes32";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "accruedNow";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "tokenId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "baseRatePerDay";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "event";
    readonly name: "ClaimTicketIssued";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "ticketId";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "holder";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "baseRecipient";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "claimSeq";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "issuedAt";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "expiresAt";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}, {
    readonly type: "error";
    readonly name: "NotHolder";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "TokenRevoked";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotActive";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NothingAccrued";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "AmountAboveAccrued";
    readonly inputs: readonly [];
}];
export declare const KISHA_PAYOUT_ABI: readonly [{
    readonly type: "function";
    readonly name: "fulfilled";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly type: "event";
    readonly name: "Fulfilled";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "ticketId";
        readonly type: "bytes32";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "baseRecipient";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "fulfilledAt";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}];
export declare const CONSTITUTION_ABI: readonly [{
    readonly type: "function";
    readonly name: "setMutable";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "key";
        readonly type: "bytes32";
    }, {
        readonly name: "value";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "getMutable";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "key";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bytes32";
    }];
}, {
    readonly type: "function";
    readonly name: "governance";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}];
export declare const GOVERNANCE_ABI: readonly [{
    readonly type: "function";
    readonly name: "propose";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "targets";
        readonly type: "address[]";
    }, {
        readonly name: "calldatas";
        readonly type: "bytes[]";
    }, {
        readonly name: "descCid";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "castVote";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
    }, {
        readonly name: "choice";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "queue";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "execute";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "state";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
}, {
    readonly type: "event";
    readonly name: "ProposalCreated";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "proposer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "proposerTokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "targets";
        readonly type: "address[]";
        readonly indexed: false;
    }, {
        readonly name: "calldatas";
        readonly type: "bytes[]";
        readonly indexed: false;
    }, {
        readonly name: "descCid";
        readonly type: "bytes32";
        readonly indexed: false;
    }, {
        readonly name: "voteStart";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "voteEnd";
        readonly type: "uint64";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "VoteCast";
    readonly anonymous: false;
    readonly inputs: readonly [{
        readonly name: "proposalId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: true;
    }, {
        readonly name: "choice";
        readonly type: "uint8";
        readonly indexed: false;
    }, {
        readonly name: "voter";
        readonly type: "address";
        readonly indexed: false;
    }];
}];
/**
 * Governance proposal state mirror — matches the on-chain
 * `Governance.State` enum exactly. Used by `Etzhayyim.biProposalState()`.
 */
export declare const GOVERNANCE_STATE: {
    readonly Pending: 0;
    readonly Active: 1;
    readonly Defeated: 2;
    readonly Succeeded: 3;
    readonly Queued: 4;
    readonly Executed: 5;
    readonly Canceled: 6;
    readonly Expired: 7;
};
export type GovernanceStateLabel = keyof typeof GOVERNANCE_STATE;
/** Vote choice → uint8 mapping. Matches Governance.castVote semantics. */
export declare const VOTE_CHOICE: {
    readonly against: 0;
    readonly for: 1;
    readonly abstain: 2;
};
export declare const OATH_RECORD_NSID: "com.etzhayyim.apps.etzhayyim.oath";

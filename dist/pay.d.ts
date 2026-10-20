/**
 * @etzhayyim/sdk/pay — On-chain payment helpers (Base L2 + USDC + ERC-20).
 *
 * v0.1.0: working EOA-based USDC.transfer path + payment.sent AT record
 * creation. ERC-4337 Smart Account + Paymaster + Superfluid + 0xSplits +
 * Safe escrow remain stubs for v0.2+.
 *
 * Hard rule: this is the ONLY seam where viem writeContract for value
 * transfer is allowed. App code MUST call Etzhayyim.pay() — direct USDC
 * transfers from app code are prohibited (ADR-2605172100).
 */
import { type Address, type Hash, type Hex, type PublicClient, type WalletClient } from "viem";
import { AtpAgent } from "@atproto/api";
/** USDC contract on Base L2 (Coinbase Bridged). 6 decimals. */
export declare const USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Default Base L2 RPC. */
export declare const BASE_RPC_DEFAULT: "https://mainnet.base.org";
/** USDC.transfer / .balanceOf / .approve ABI subset. */
export declare const USDC_ABI: readonly [{
    readonly type: "function";
    readonly name: "transfer";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
    readonly stateMutability: "nonpayable";
}, {
    readonly type: "function";
    readonly name: "balanceOf";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
    readonly stateMutability: "view";
}, {
    readonly type: "function";
    readonly name: "decimals";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
    readonly stateMutability: "view";
}];
export type PaymentPurpose = "donation" | "tip" | "subscription" | "purchase" | "refund" | "grant" | "offering" | "split";
/**
 * Convert human-readable USDC amount ("10.00") to base units (10_000_000n).
 * USDC has 6 decimals on Base.
 */
export declare function parseUsdc(human: string): bigint;
/**
 * Format a USDC base-units bigint as a human string.
 */
export declare function formatUsdc(micros: bigint): string;
/**
 * Convert "10.00 / month" to USDC base units per second.
 * For Superfluid streaming (v0.2 — currently stubbed in payStream).
 */
export declare function parseUsdcPerSecond(perPeriod: string): bigint;
export interface PayClientConfig {
    /** Base L2 RPC URL. */
    rpcUrl: string;
    /** EOA private key. v0.2 swaps this for an ERC-4337 Smart Account. */
    privateKey: Hex;
    /** USDC contract address. Default USDC_BASE. */
    tokenContract?: Address;
}
export interface PayOpts {
    /** Recipient address. v0.2 will accept did:web/did:plc too. */
    to: Address;
    /** Amount in USDC base units. Use parseUsdc("10.00") for human input. */
    amount: bigint;
    /** Recorded as the AT payment.sent record body. */
    reason: PaymentReason;
}
export interface PaymentReason {
    /** NSID. Default `com.etzhayyim.apps.payment.sent`. */
    collection?: string;
    /** Purpose tag. */
    purpose: PaymentPurpose;
    /** Optional AT URI of the thing being paid for. */
    forUri?: string;
    /** Optional memo (≤ 280 chars, plaintext). */
    memo?: string;
}
export interface PaymentReceipt {
    /** On-chain tx hash on Base L2. */
    txHash: Hash;
    /** Block number where the tx was included. */
    blockNumber: bigint;
    /** AT URI of the payment.sent record on the sender's PDS. (Empty if no PDS supplied.) */
    recordUri: string;
    /** Sender's on-chain address. Optional — relayed bi.claim fulfillments don't carry it. */
    from?: Address;
    /** Recipient. Optional for the same reason as `from`. */
    to?: Address;
    /** Amount in USDC base units. Optional for the same reason. */
    amount?: bigint;
    /** True iff the tx was bundled atomically (paymaster ERC-4337 batch). */
    atomicBatch?: boolean;
}
export declare class PayClient {
    readonly publicClient: PublicClient;
    readonly walletClient: WalletClient;
    readonly tokenContract: Address;
    readonly account: {
        address: Address;
        nonceManager?: import("viem").NonceManager | undefined;
        sign: (parameters: {
            hash: Hash;
        }) => Promise<Hex>;
        signAuthorization: (parameters: import("viem").AuthorizationRequest) => Promise<import("viem/accounts").SignAuthorizationReturnType>;
        signMessage: ({ message }: {
            message: import("viem").SignableMessage;
        }) => Promise<Hex>;
        signTransaction: <serializer extends import("viem").SerializeTransactionFn<import("viem").TransactionSerializable> = import("viem").SerializeTransactionFn<import("viem").TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: {
            serializer?: serializer | undefined;
        } | undefined) => Promise<Hex>;
        signTypedData: <const typedData extends import("abitype").TypedData | Record<string, unknown>, primaryType extends keyof typedData | "EIP712Domain" = keyof typedData>(parameters: import("viem").TypedDataDefinition<typedData, primaryType>) => Promise<Hex>;
        publicKey: Hex;
        source: "privateKey";
        type: "local";
    };
    constructor(cfg: PayClientConfig);
    /** USDC balance of an address. */
    balanceOf(addr: Address): Promise<bigint>;
    /**
     * One-shot USDC transfer. Optionally writes a payment.sent AT record to
     * the sender's PDS if `pdsAgent` is provided.
     */
    pay(opts: PayOpts, pdsAgent?: {
        agent: AtpAgent;
        did: string;
    }): Promise<PaymentReceipt>;
}
export declare function pay(opts: {
    rpcUrl: string;
    privateKey: Hex;
    to: Address;
    amount: bigint;
    reason: PaymentReason;
    tokenContract?: Address;
    pds?: {
        agent: AtpAgent;
        did: string;
    };
}): Promise<PaymentReceipt>;
export interface PayStreamOpts {
    to: Address;
    flowRate: bigint;
    reason: PaymentReason;
}
export declare function payStream(_opts: PayStreamOpts): Promise<{
    streamId: Hex;
    recordUri: string;
    startedAt: bigint;
}>;
export declare function payStreamStop(_streamId: Hex): Promise<void>;
export interface EscrowOpenOpts {
    to: Address;
    amount: bigint;
    arbiter: Address;
    dueDate: Date;
    reason: PaymentReason;
}
export declare function escrowOpen(_opts: EscrowOpenOpts): Promise<{
    safeAddress: Address;
    recordUri: string;
}>;
export declare function escrowRelease(_safeAddress: Address, _to: "recipient" | "user"): Promise<{
    txHash: Hash;
    recordUri: string;
}>;
export interface SplitDistributeOpts {
    splitAddress: Address;
    amount: bigint;
    reason: PaymentReason;
}
export declare function splitDistribute(_opts: SplitDistributeOpts): Promise<{
    txHash: Hash;
    recordUri: string;
}>;

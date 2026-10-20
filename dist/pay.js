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
import { createPublicClient, createWalletClient, http, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createRecord } from "./pds.js";
// ─── Constants ──────────────────────────────────────────────────────
/** USDC contract on Base L2 (Coinbase Bridged). 6 decimals. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Default Base L2 RPC. */
export const BASE_RPC_DEFAULT = "https://mainnet.base.org";
/** USDC.transfer / .balanceOf / .approve ABI subset. */
export const USDC_ABI = [
    {
        type: "function",
        name: "transfer",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "balanceOf",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "decimals",
        inputs: [],
        outputs: [{ name: "", type: "uint8" }],
        stateMutability: "view",
    },
];
// ─── Helpers ────────────────────────────────────────────────────────
/**
 * Convert human-readable USDC amount ("10.00") to base units (10_000_000n).
 * USDC has 6 decimals on Base.
 */
export function parseUsdc(human) {
    const [whole, frac = ""] = human.split(".");
    const padded = (frac + "000000").slice(0, 6);
    return BigInt(whole) * 1000000n + BigInt(padded || "0");
}
/**
 * Format a USDC base-units bigint as a human string.
 */
export function formatUsdc(micros) {
    const whole = micros / 1000000n;
    const frac = (micros % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
}
/**
 * Convert "10.00 / month" to USDC base units per second.
 * For Superfluid streaming (v0.2 — currently stubbed in payStream).
 */
export function parseUsdcPerSecond(perPeriod) {
    const m = perPeriod.match(/^([\d.]+)\s*\/\s*(second|minute|hour|day|week|month|year)$/);
    if (!m) {
        throw new Error(`[etzhayyim-sdk/pay] parseUsdcPerSecond: invalid format ${JSON.stringify(perPeriod)} ` +
            `(expected '<amount> / <second|minute|hour|day|week|month|year>')`);
    }
    const amount = parseUsdc(m[1]);
    const periodSec = {
        second: 1n,
        minute: 60n,
        hour: 3600n,
        day: 86400n,
        week: 604800n,
        month: 2592000n, // 30 days
        year: 31536000n,
    };
    return amount / periodSec[m[2]];
}
export class PayClient {
    publicClient;
    walletClient;
    tokenContract;
    account;
    constructor(cfg) {
        this.account = privateKeyToAccount(cfg.privateKey);
        this.tokenContract = cfg.tokenContract ?? USDC_BASE;
        this.publicClient = createPublicClient({ transport: http(cfg.rpcUrl) });
        this.walletClient = createWalletClient({
            account: this.account,
            transport: http(cfg.rpcUrl),
        });
    }
    /** USDC balance of an address. */
    async balanceOf(addr) {
        return (await this.publicClient.readContract({
            address: this.tokenContract,
            abi: USDC_ABI,
            functionName: "balanceOf",
            args: [addr],
        }));
    }
    /**
     * One-shot USDC transfer. Optionally writes a payment.sent AT record to
     * the sender's PDS if `pdsAgent` is provided.
     */
    async pay(opts, pdsAgent) {
        const chain = null;
        const txHash = await this.walletClient.writeContract({
            address: this.tokenContract,
            abi: USDC_ABI,
            functionName: "transfer",
            args: [opts.to, opts.amount],
            account: this.account,
            chain,
        });
        const receipt = await this.publicClient.waitForTransactionReceipt({
            hash: txHash,
        });
        if (receipt.status !== "success") {
            throw new Error(`[etzhayyim-sdk/pay] USDC.transfer reverted: ${txHash}`);
        }
        let recordUri = "";
        if (pdsAgent) {
            const chainId = await this.publicClient.getChainId();
            const collection = opts.reason.collection ?? "com.etzhayyim.apps.payment.sent";
            const record = {
                to: opts.to,
                amountUsdcMicros: Number(opts.amount), // safe up to 2^53; cast bigint to JSON number
                tokenContract: this.tokenContract,
                chainId,
                txHash: txHash,
                blockNumber: Number(receipt.blockNumber),
                purpose: opts.reason.purpose,
                forUri: opts.reason.forUri,
                memo: opts.reason.memo,
                sentAt: new Date().toISOString(),
                atomicBatch: false,
            };
            const res = await createRecord(pdsAgent.agent, pdsAgent.did, collection, record);
            recordUri = res.uri;
        }
        return {
            txHash,
            blockNumber: receipt.blockNumber,
            recordUri,
            from: this.account.address,
            to: opts.to,
            amount: opts.amount,
        };
    }
}
// ─── Functional API (matches earlier stub surface) ──────────────────
export async function pay(opts) {
    const client = new PayClient({
        rpcUrl: opts.rpcUrl,
        privateKey: opts.privateKey,
        tokenContract: opts.tokenContract,
    });
    return client.pay({ to: opts.to, amount: opts.amount, reason: opts.reason }, opts.pds);
}
export async function payStream(_opts) {
    throw new Error("[etzhayyim-sdk/pay] payStream() v0.2+: Superfluid.callAgreement(CFAv1.createFlow). " +
        "v0.1 only supports one-shot pay().");
}
export async function payStreamStop(_streamId) {
    throw new Error("[etzhayyim-sdk/pay] payStreamStop() v0.2+");
}
export async function escrowOpen(_opts) {
    throw new Error("[etzhayyim-sdk/pay] escrowOpen() v0.2+: Gnosis Safe 2-of-3 deploy.");
}
export async function escrowRelease(_safeAddress, _to) {
    throw new Error("[etzhayyim-sdk/pay] escrowRelease() v0.2+");
}
export async function splitDistribute(_opts) {
    throw new Error("[etzhayyim-sdk/pay] splitDistribute() v0.2+: 0xSplits.distributeERC20.");
}

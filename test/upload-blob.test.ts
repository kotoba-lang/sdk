/**
 * Tests for Etzhayyim.uploadBlob — Tier D content-addressed IPFS pin.
 *
 * Mocks `fetch` directly (ipfs.ts uses global fetch with FormData) to
 * verify:
 *   - empty payload rejection (before any HTTP)
 *   - missing ipfsApiUrl rejection (before any HTTP)
 *   - POST shape: /api/v0/add?pin=true&cid-version=1 + multipart body
 *   - response parsing (Kubo NDJSON, last line is the root)
 *   - mediaType default + override
 *   - Uint8Array vs Blob input parity
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Etzhayyim } from "../src/index.js";

const KUBO_ADD_BODY = '{"Name":"blob","Hash":"bafkrei-test","Size":"12"}\n';

function kuboOkResponse(): Response {
  return new Response(KUBO_ADD_BODY, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Etzhayyim.uploadBlob", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => kuboOkResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("rejects when ipfsApiUrl is not configured", async () => {
    const sdk = new Etzhayyim({ did: "did:web:test" });
    await expect(
      sdk.uploadBlob({ data: new Uint8Array([1, 2, 3]) })
    ).rejects.toThrow(/ipfsApiUrl not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty payloads before hitting Kubo", async () => {
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001",
    });
    await expect(sdk.uploadBlob({ data: new Uint8Array(0) })).rejects.toThrow(
      /empty payload/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to /api/v0/add and returns Kubo CID + size", async () => {
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001",
    });
    const receipt = await sdk.uploadBlob({
      data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      mediaType: "application/octet-stream",
    });
    expect(receipt.cid).toBe("bafkrei-test");
    expect(receipt.sizeBytes).toBe(12);
    expect(receipt.mediaType).toBe("application/octet-stream");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://kubo.local:5001/api/v0/add?pin=true&cid-version=1"
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("defaults mediaType to application/octet-stream", async () => {
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001",
    });
    const r = await sdk.uploadBlob({ data: new Uint8Array([1]) });
    expect(r.mediaType).toBe("application/octet-stream");
  });

  it("derives mediaType from Blob.type when no override is given", async () => {
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001",
    });
    const blob = new Blob([new Uint8Array([1, 2])], { type: "model/gltf-binary" });
    const r = await sdk.uploadBlob({ data: blob });
    expect(r.mediaType).toBe("model/gltf-binary");
  });

  it("strips trailing slashes from ipfsApiUrl", async () => {
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001///",
    });
    await sdk.uploadBlob({ data: new Uint8Array([1]) });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://kubo.local:5001/api/v0/add?pin=true&cid-version=1"
    );
  });

  it("surfaces Kubo HTTP failures", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("kubo unavailable", { status: 503 })
    );
    const sdk = new Etzhayyim({
      did: "did:web:test",
      ipfsApiUrl: "http://kubo.local:5001",
    });
    await expect(
      sdk.uploadBlob({ data: new Uint8Array([1]) })
    ).rejects.toThrow(/pin failed: 503/);
  });
});

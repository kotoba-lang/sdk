// In-memory fake PDS for SDK smoke tests.
//
// Implements the minimum XRPC surface that @atproto/api's AtpAgent
// touches when resuming a pre-existing session and writing records:
//
//   GET  /xrpc/com.atproto.server.getSession    → {did, handle, …}
//   POST /xrpc/com.atproto.server.refreshSession→ {accessJwt, refreshJwt, did, handle}
//   POST /xrpc/com.atproto.repo.createRecord    → {uri, cid}
//   GET  /xrpc/com.atproto.repo.listRecords     → {records}
//
// The server keeps records in an in-memory map keyed by
// (repo, collection, rkey). Callers can read back via listRecords for
// verification. NO authentication enforced — caller is expected to
// pre-authorize via the AtpAgent's session manager (resumeSession with
// a stub session).
//
// Usage:
//   import {startFakePds} from "./fake-pds.mjs";
//   const pds = await startFakePds({port: 4711});
//   const agent = new AtpAgent({service: pds.url});
//   await agent.resumeSession({did: "did:web:x", handle: "x", accessJwt: "fake", refreshJwt: "fake", active: true});
//   await agent.com.atproto.repo.createRecord({repo: "did:web:x", collection: "com.example", record: {}});
//   pds.records.size === 1;
//   await pds.stop();

import {createServer} from "node:http";
import {createHash, randomBytes} from "node:crypto";

const TID_BASE32 = "234567abcdefghijklmnopqrstuvwxyz";

function newTid() {
  // 13-char TID-shape stem. Not RFC-compliant but works as a unique rkey.
  let out = "";
  for (const b of randomBytes(13)) out += TID_BASE32[b % TID_BASE32.length];
  return out;
}

// A pre-canonicalized CIDv1 (raw sha2-256, base32 lower). atproto's
// lexicon validator rejects shorter / hex-only strings. We hand-pinned
// one valid CID and reuse it for every record — content-addressing
// fidelity isn't the property under test; the URI shape + record body
// is.
const FAKE_CID = "bafyreialr2vrqpzh4ay4r3jqfd76nlpchdfpyrhqbfgsodwxqndvonbymq";
function fakeCid(_record) {
  return FAKE_CID;
}

export async function startFakePds({
  port = 0,
  sessionDid = "did:web:fake.etzhayyim.test",
  sessionHandle = "fake.etzhayyim.test",
  // Optional: multi-session mode. Map<accessJwt, {did, handle}>. When set,
  // getSession looks up the session by the Authorization bearer token so
  // multiple actors can share one fake-pds instance.
  sessions = null,
} = {}) {
  /** @type {Map<string, {uri: string, cid: string, value: any}>} */
  const records = new Map();

  function lookupSession(headers) {
    if (!sessions) return {did: sessionDid, handle: sessionHandle};
    const auth = headers["authorization"] ?? headers["Authorization"] ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const s = sessions.get(token);
    if (s) return s;
    return {did: sessionDid, handle: sessionHandle};
  }

  const handlers = {
    "GET /xrpc/com.atproto.server.getSession": (_req, _body, _query, headers) => {
      // AtpAgent.resumeSession calls this to verify the session it was
      // handed; it expects the response DID to equal session.did. In
      // multi-session mode the DID is dispatched by the Authorization
      // bearer token.
      const s = lookupSession(headers);
      return {
        did: s.did,
        handle: s.handle,
        email: "fake@etzhayyim.test",
        emailConfirmed: true,
        active: true,
      };
    },

    "POST /xrpc/com.atproto.server.refreshSession": () => ({
      did: "did:web:fake.etzhayyim.test",
      handle: "fake.etzhayyim.test",
      accessJwt: "fake-access-" + newTid(),
      refreshJwt: "fake-refresh-" + newTid(),
      active: true,
    }),

    "POST /xrpc/com.atproto.repo.createRecord": (_req, body) => {
      if (!body?.repo || !body?.collection) {
        throw new Error("createRecord: repo + collection required");
      }
      const rkey = body.rkey ?? newTid();
      const uri = `at://${body.repo}/${body.collection}/${rkey}`;
      const cid = fakeCid(body.record);
      records.set(uri, {uri, cid, value: body.record});
      return {uri, cid, commit: {cid, rev: newTid()}, validationStatus: "valid"};
    },

    "GET /xrpc/com.atproto.repo.listRecords": (_req, _body, query) => {
      const repo = query.repo;
      const collection = query.collection;
      const out = [];
      for (const r of records.values()) {
        if (!r.uri.startsWith(`at://${repo}/${collection}/`)) continue;
        out.push({uri: r.uri, cid: r.cid, value: r.value});
      }
      // reverse=true → newest first (insertion order is creation order).
      if (query.reverse === "true") out.reverse();
      const limit = query.limit ? Number(query.limit) : 50;
      return {records: out.slice(0, limit)};
    },

    "GET /xrpc/com.atproto.repo.getRecord": (_req, _body, query) => {
      const repo = query.repo;
      const collection = query.collection;
      const rkey = query.rkey;
      const uri = `at://${repo}/${collection}/${rkey}`;
      const r = records.get(uri);
      if (!r) {
        const err = new Error("Record not found");
        err.statusCode = 404;
        throw err;
      }
      return {uri: r.uri, cid: r.cid, value: r.value};
    },
  };

  const server = createServer((req, res) => {
    let chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url, `http://localhost:${addr.port}`);
      const key = `${req.method} ${url.pathname}`;
      const handler = handlers[key];
      const headers = req.headers;
      let body = null;
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw && (headers["content-type"] ?? "").includes("json")) {
        try {
          body = JSON.parse(raw);
        } catch {}
      }
      const query = Object.fromEntries(url.searchParams.entries());
      try {
        const out = handler ? handler(req, body, query, headers) : {error: "MethodNotFound"};
        res.statusCode = handler ? 200 : 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({error: "BadRequest", message: String(err?.message ?? err)}));
      }
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    records,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

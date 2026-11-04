// coin1 test helper: the client's wallet (js/wallet.js) talking to the REAL worker code (server/index.js on node:sqlite) in
// process, so store / shop tests exercise the server-decided purchase path end to end. Node only, no network.
import { mkdtempSync, copyFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { DatabaseSync } from "node:sqlite";
const ROOT = new URL("..", import.meta.url).pathname;
class Sql { constructor() { this.db = new DatabaseSync(":memory:"); }
  exec(q, ...b) { const st = this.db.prepare(q); if (/^\s*SELECT/i.test(q)) { const rows = st.all(...b).map((r) => ({ ...r })); return { toArray: () => rows, one: () => rows[0] }; } st.run(...b); return { toArray: () => [], one: () => undefined }; } }
const pidOf = async (k) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ssp-pid|" + k)); return [...new Uint8Array(h)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join(""); };
export async function useServerWallet(S, dev = "ab".repeat(16)) {
  const dir = mkdtempSync(join(tmpdir(), "ssp-tw-")); copyFileSync(ROOT + "server/index.js", join(dir, "index.js")); for (const f of ["sim.js", "econ.js", "skins.js", "offers.js"]) copyFileSync(ROOT + "js/" + f, join(dir, f));
  const W = await import(join(dir, "index.js")), wl = await import("../js/wallet.js");
  const objs = new Map(), env = { ROOMS: { idFromName: (n) => n, get: (id) => ({ fetch: (u, i) => obj(id).fetch(u instanceof Request ? u : new Request(u, i)) }) } };
  const obj = (id) => { let o = objs.get(id); if (!o) { o = new W.Room({ storage: { sql: new Sql() }, acceptWebSocket() {}, getWebSockets: () => [], setWebSocketAutoResponse() {} }, env); objs.set(id, o); } return o; };
  const so = obj("social-v1"); wl.WL.S = S; S.p.dev = dev; /* the wallet follows the Store a test uses (tests build several) */ const pid = await pidOf(dev);
  let down = false; wl.WL.call = async (op, args = {}) => (down ? { err: "offline" } : JSON.parse(JSON.stringify(await so.sOp(pid, JSON.parse(JSON.stringify({ op, ...args }))))));
  wl.WL.up = () => !down;
  return { so, pid, wl, online: () => wl.online(), add: (c) => so.wAdd(pid, c, "test", "seed"), bal: () => so.wState(pid).bal, offline: (v) => { down = v; } };
}

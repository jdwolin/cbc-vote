// CBC Elder Retreat 2026 — ranked-choice ministry voting
// Storage: ntfy.sh topic (append-only event log, 12h cache) + archive.json (GitHub Action snapshot, permanent)
const TOPIC = "cbc-elder-retreat-2026-a4f7f5368db0";
const NTFY = "https://ntfy.sh/" + TOPIC;
const AREAS = [
  "Worship in Services (Preaching, Singing, Ordinances, Prayer, Giving)",
  "Life Groups", "Equipping Classes", "Youth Ministry", "Children's Ministry",
  "Men's Ministry", "Women's Ministry", "Seniors Ministry", "Counseling",
  "Local Outreach", "Global Missions"
];
const SHORT = a => a.startsWith("Worship in Services") ? "Worship in Services" : a;

function normName(s) {
  return (s || "").toLowerCase().replace(/\band\b/g, "&").replace(/[^a-z0-9&]+/g, " ").replace(/\s*&\s*/g, "&").trim();
}

// ---------- event store ----------
const Store = {
  events: new Map(), // id -> {id,time,data,seq}
  seq: 0,
  listeners: [],
  add(id, time, message) {
    if (!id || this.events.has(id)) return false;
    let data; try { data = JSON.parse(message); } catch (e) { return false; }
    if (!data || !data.type) return false;
    this.events.set(id, { id, time: Number(time) || 0, data, seq: this.seq++ });
    return true;
  },
  notify() { this.listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); },
  // Current state: latest vote per couple after latest reset
  state() {
    const evs = [...this.events.values()].sort((a, b) => a.time - b.time || a.seq - b.seq);
    let resetIdx = -1;
    evs.forEach((e, i) => { if (e.data.type === "reset") resetIdx = i; });
    const votes = new Map();
    for (let i = resetIdx + 1; i < evs.length; i++) {
      const e = evs[i], d = e.data;
      if (d.type === "vote" && d.key && Array.isArray(d.picks) && d.picks.length === 3) {
        votes.set(d.key, { key: d.key, name: d.name, picks: d.picks, time: e.time });
      } else if (d.type === "delete" && d.key) {
        votes.delete(d.key);
      }
    }
    const resetTime = resetIdx >= 0 ? evs[resetIdx].time : null;
    return { votes: [...votes.values()].sort((a, b) => a.time - b.time), resetTime };
  }
};

async function loadArchive() {
  try {
    const r = await fetch("archive.json?ts=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const arr = await r.json();
    let ch = false;
    for (const m of arr) ch = Store.add(m.id, m.time, m.message) || ch;
    if (ch) Store.notify();
  } catch (e) { console.warn("archive", e); }
}

async function pollNtfy() {
  const r = await fetch(NTFY + "/json?poll=1&since=all", { cache: "no-store" });
  if (!r.ok) throw new Error("ntfy " + r.status);
  const txt = await r.text();
  let ch = false;
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.event === "message") ch = Store.add(m.id, m.time, m.message) || ch; } catch (e) {}
  }
  if (ch) Store.notify();
}

let es = null, pollTimer = null;
function startLive() {
  loadArchive();
  pollNtfy().catch(() => {});
  if (window.EventSource) {
    try {
      es = new EventSource(NTFY + "/sse?since=all");
      es.onmessage = ev => {
        try { const m = JSON.parse(ev.data); if (m.event === "message" && Store.add(m.id, m.time, m.message)) Store.notify(); } catch (e) {}
      };
    } catch (e) { es = null; }
  }
  // safety net poll (slow, to be gentle on shared wifi IP limits)
  pollTimer = setInterval(() => { if (!document.hidden) pollNtfy().catch(() => {}); }, es ? 60000 : 20000);
  setInterval(() => { if (!document.hidden) loadArchive(); }, 300000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollNtfy().catch(() => {}); });
}

async function publish(obj) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(NTFY, { method: "POST", body: JSON.stringify(obj) });
      if (r.ok) { const m = await r.json(); Store.add(m.id, m.time, m.message); Store.notify(); return m; }
      lastErr = new Error("HTTP " + r.status);
    } catch (e) { lastErr = e; }
    await new Promise(res => setTimeout(res, 1200 * (i + 1)));
  }
  throw lastErr;
}

// ---------- optimal grouping ----------
// Hungarian algorithm (min cost, square matrix n x n). Returns assignment row->col.
function hungarian(cost) {
  const n = cost.length, INF = 1e18;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n);
  for (let j = 1; j <= n; j++) if (p[j]) ans[p[j] - 1] = j - 1;
  return ans;
}
function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i <= arr.length - (k - cur.length); i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const PTS = [3, 2, 1];
function points(v, area) { const i = v.picks.indexOf(area); return i >= 0 ? PTS[i] : 0; }

// votes: [{name,picks}]. Returns {groups:[{area,members:[{name,rank,pts}]}], score, maxScore}
function makeGroups(votesIn, randomize = true) {
  const votes = randomize ? shuffle(votesIn) : votesIn.slice();
  const n = votes.length;
  if (n < 2) return { error: "Need at least 2 couples to make groups." };
  const g = Math.floor(n / 2), odd = n % 2 === 1;
  let areaPool = AREAS.slice();
  while (areaPool.length < g) areaPool = areaPool.concat(AREAS); // >22 couples: areas may repeat
  const idxs = areaPool.map((_, i) => i);
  // weight: 100*points + 1 if couple got any of their picks (tie-break: fewer zero-point couples)
  const W = (v, a) => { const p = points(v, a); return p * 100 + (p > 0 ? 1 : 0); };
  let best = [], bestVal = -1;
  for (const set of combos(randomize ? shuffle(idxs) : idxs, g)) {
    const tripleOpts = odd ? set : [null];
    for (const t of tripleOpts) {
      const slots = [];
      for (const ai of set) { slots.push(ai, ai); if (ai === t) slots.push(ai); }
      const cost = votes.map(v => slots.map(ai => -W(v, areaPool[ai])));
      const asg = hungarian(cost);
      let val = 0; asg.forEach((c, r) => { val -= cost[r][c]; });
      if (val > bestVal) { bestVal = val; best = [{ slots, asg }]; }
      else if (val === bestVal && best.length < 50) best.push({ slots, asg });
    }
  }
  const pick = randomize ? best[Math.floor(Math.random() * best.length)] : best[0];
  const byArea = new Map();
  pick.asg.forEach((c, r) => {
    const ai = pick.slots[c];
    if (!byArea.has(ai)) byArea.set(ai, []);
    const v = votes[r], area = areaPool[ai], rank = v.picks.indexOf(area);
    byArea.get(ai).push({ name: v.name, rank, pts: rank >= 0 ? PTS[rank] : 0 });
  });
  const groups = [...byArea.entries()].map(([ai, members]) => ({ area: areaPool[ai], members, pts: members.reduce((s, m) => s + m.pts, 0) }));
  groups.sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area));
  const score = groups.reduce((s, x) => s + x.pts, 0);
  const firsts = groups.reduce((s, x) => s + x.members.filter(m => m.rank === 0).length, 0);
  const seconds = groups.reduce((s, x) => s + x.members.filter(m => m.rank === 1).length, 0);
  const thirds = groups.reduce((s, x) => s + x.members.filter(m => m.rank === 2).length, 0);
  return { groups, score, maxScore: 3 * n, n, firsts, seconds, thirds, none: n - firsts - seconds - thirds, ties: best.length };
}
if (typeof module !== "undefined") module.exports = { makeGroups, AREAS, normName, hungarian };

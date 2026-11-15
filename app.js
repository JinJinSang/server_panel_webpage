/* ARC GPU Queue dashboard — plain JS, no dependencies. Reads snapshot.json (+ history.json) produced by collect.py. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SKU_LABEL = { l40s: "L40S", h100: "H100", a100: "A100", v100: "V100", a6000: "A6000", rtx8000: "RTX 8000", any: "any GPU" };
  const skuName = s => SKU_LABEL[s] || (s || "").toUpperCase();
  const fmtMin = m => {
    if (m == null || isNaN(m)) return "–";
    m = Math.round(m); const sign = m < 0 ? "-" : ""; m = Math.abs(m);
    if (m < 60) return `${sign}${m}m`;
    if (m < 1440) return `${sign}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
    return `${sign}${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  };
  const fmtH = h => h == null ? "–" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`;
  const fmtTs = s => { if (!s) return "–"; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const gb = mb => mb >= 1024 ? `${Math.round(mb / 1024)}G` : `${mb}M`;
  const req = j => `${j.gpus_per_node}×${skuName(j.sku)}${j.nodes > 1 ? ` ×${j.nodes}n` : ""} · ${j.cpus_per_node}c · ${gb(j.mem_mb)} · ${fmtMin(j.limit_min)}`;
  const state = { snap: null, hist: null, sku: localStorage.getItem("sku") || "l40s", tab: location.hash.slice(1) || "nodes" };

  // ---------------------------------------------------------------- data loading
  const cfg = () => { try { return JSON.parse(localStorage.getItem("cfg") || "{}"); } catch { return {}; } };
  async function fetchJson(name) {
    const c = cfg();
    const src = new URLSearchParams(location.search).get("src");
    if (src) return (await fetch(`${src.replace(/\/$/, "")}/${name}?t=${Date.now()}`)).json();
    try {
      const r = await fetch(`data/${name}?t=${Date.now()}`, { cache: "no-store" });
      if (r.ok) return r.json();
    } catch { }
    if (!c.repo) throw new Error("no data source configured");
    const r = await fetch(`https://api.github.com/repos/${c.repo}/contents/${name}?ref=${c.branch || "data"}&t=${Date.now()}`,
      { headers: { Accept: "application/vnd.github.raw+json", ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) }, cache: "no-store" });
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${name}`);
    return r.json();
  }
  async function load() {
    $("#age").textContent = "loading…";
    try {
      state.snap = await fetchJson("snapshot.json");
      try { state.hist = await fetchJson("history.json"); } catch { state.hist = null; }
      $("#error").hidden = true;
      render();
    } catch (e) {
      $("#error").hidden = false;
      $("#error").innerHTML = `Could not load data: ${esc(e.message)}. <button class="btn" id="err-cfg">Configure source</button>`;
      $("#err-cfg").onclick = () => $("#dlg").showModal();
      $("#age").textContent = "no data";
    }
  }

  // ---------------------------------------------------------------- header
  function renderHeader() {
    const s = state.snap;
    const ageMin = (Date.now() / 1000 - s.generated_epoch) / 60;
    const el = $("#age");
    el.textContent = `${fmtTs(s.generated)} (${ageMin < 1.5 ? "just now" : fmtMin(ageMin) + " ago"})${s.errors.length ? " · collector errors" : ""}`;
    el.classList.toggle("stale", ageMin > 20);
    el.title = `collected on ${s.host} in ${s.stats.collect_seconds}s` + (s.errors.length ? "\n" + s.errors.join("\n") : "");
    const sel = $("#sku");
    const opts = s.skus.map(k => `<option value="${k}">${skuName(k)}</option>`).join("") + `<option value="all">all GPU types</option>`;
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    if (!s.skus.includes(state.sku) && state.sku !== "all") state.sku = s.skus[0];
    sel.value = state.sku;
  }
  const inSku = x => state.sku === "all" || x.sku === state.sku || x.sku === "any";

  // ---------------------------------------------------------------- jobs index
  function jobClass(r) {
    if (r.user === state.snap.user) return "c-mine";
    if (r.nodes > 1) return "c-multi";
    if (!["standard", "basic", "priority"].includes(r.qos)) return "c-group";
    if (r.qos === "priority") return "c-prio";
    return "c-std";
  }
  function jobTip(r) {
    return `job ${r.job}${r.array ? ` (array ${r.array})` : ""} · ${r.name}\n${r.user} · ${r.account} · QoS ${r.qos} · ${r.partition}\n` +
      `${req(r)}\nnodes: ${Object.keys(r.per_node).join(", ")}\nsubmitted ${fmtTs(r.submit)} · started ${fmtTs(r.start)}\n` +
      `elapsed ${fmtMin(r.elapsed_min)} of ${fmtMin(r.limit_min)} · ends by ${fmtTs(r.end)} (${fmtMin(r.left_min)} left)`;
  }

  // ---------------------------------------------------------------- nodes tab
  function renderNodes() {
    const s = state.snap;
    const nodes = s.nodes.filter(n => state.sku === "all" || n.sku === state.sku);
    const byJob = Object.fromEntries(s.running.map(r => [r.job, r]));
    const usable = nodes.filter(n => !/^(down|drain|drng|maint|resv|fail|unk)/.test(n.state));
    const gTotal = usable.reduce((a, n) => a + n.gpus_total, 0), gFree = usable.reduce((a, n) => a + n.gpus_free, 0);
    const wholeFree = usable.filter(n => n.gpus_free === n.gpus_total).length;
    const nextWhole = Math.min(...usable.map(n => n.all_free_min ?? Infinity));
    const nextOne = Math.min(...usable.map(n => n.next_gpu_free_min ?? Infinity));
    $("#node-tiles").innerHTML = [
      [gFree, `free GPUs of ${gTotal}`], [gTotal - gFree, "GPUs in use"], [wholeFree, "whole nodes free"],
      [nextOne === Infinity ? "–" : nextOne === 0 ? "now" : fmtMin(nextOne), "next free GPU (by time limit)"],
      [nextWhole === Infinity ? "–" : nextWhole === 0 ? "now" : fmtMin(nextWhole), "next whole node (by time limit)"],
      [nodes.length - usable.length, "nodes down / drained"],
    ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
    const sort = $("#node-sort").value;
    nodes.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "idle" ? b.gpus_free - a.gpus_free || a.name.localeCompare(b.name)
      : (a.all_free_min ?? 1e9) - (b.all_free_min ?? 1e9) || a.name.localeCompare(b.name));
    $("#nodes").innerHTML = nodes.map(n => {
      const bad = !usable.includes(n);
      const slots = n.gpu_slots.map(sl => {
        const r = sl.job && byJob[sl.job];
        if (!r) return `<div class="slot free" title="free"><div class="t">free</div></div>`;
        const frac = r.limit_min ? Math.min(1, (r.elapsed_min || 0) / r.limit_min) : 0;
        return `<div class="slot ${jobClass(r)}" data-job="${esc(r.job)}" data-tip="${esc(jobTip(r))}"><div class="fill"></div><div class="prog" style="width:${(frac * 100).toFixed(0)}%"></div>` +
          `<div class="t">${esc(r.user)}${r.nodes > 1 ? ` · ${r.nodes}n` : ""}</div><div class="b">${fmtMin(r.left_min)}</div></div>`;
      }).join("");
      return `<div class="node${bad ? " unusable" : ""}"><div class="hd"><span>${esc(n.name)} <span class="st">${skuName(n.sku)}</span></span><span class="st">${esc(n.state)}${n.reason ? " · " + esc(n.reason) : ""}</span></div>` +
        `<div class="slots">${slots}</div>` +
        `<div class="kv"><span>cores <b>${n.cpus_alloc}</b>/${n.cpus_total}</span><span>mem <b>${Math.round(n.mem_alloc_mb / 1024)}</b>/${Math.round(n.mem_mb / 1024)} G</span></div>` +
        `<div class="meter" style="margin-top:3px"><i style="width:${(100 * n.cpus_alloc / n.cpus_total).toFixed(0)}%"></i></div>` +
        `<div class="kv"><span>next GPU <b>${n.next_gpu_free_min === 0 ? "now" : fmtMin(n.next_gpu_free_min)}</b></span><span>all free <b>${n.all_free_min === 0 ? "now" : fmtMin(n.all_free_min)}</b></span></div></div>`;
    }).join("");
  }

  // ---------------------------------------------------------------- queue tab
  function scoreBar(p) {
    const b = p.prio; if (!b) return `<span class="score" title="no breakdown available"></span>`;
    const max = 10000, w = k => `${(100 * Math.min(max, b[k]) / max).toFixed(1)}%`;
    return `<span class="score${b.estimated ? " est" : ""}" title="fair-share ${b.fairshare} · QoS ${b.qos} · age ${b.age} · size ${b.size}${b.estimated ? " (estimated: Slurm reports no breakdown while the job is not eligible)" : ""}"><i class="fs" style="width:${w("fairshare")}"></i><i class="qos" style="width:${w("qos")}"></i><i class="age" style="width:${w("age")}"></i><i class="size" style="width:${w("size")}"></i></span>`;
  }
  function renderQueue() {
    const s = state.snap, me = s.user;
    const all = s.pending.filter(inSku);
    const run = all.filter(p => p.feasibility === "runnable");
    const counts = {}; all.forEach(p => counts[p.feasibility] = (counts[p.feasibility] || 0) + 1);
    const tasksRun = run.reduce((a, p) => a + p.tasks_runnable, 0), gpusRun = run.reduce((a, p) => a + p.tasks_runnable * p.gpus_per_node * p.nodes, 0);
    $("#queue-tiles").innerHTML = [
      [run.length, `runnable jobs (${tasksRun} tasks)`], [gpusRun, "GPUs they want"], [counts.blocked || 0, "blocked by a cap"],
      [counts.never || 0, "can never run"], [(counts.held || 0) + (counts.dependency || 0), "held / dependency"],
      [run.filter(p => p.slurm_start).length, "with a Slurm start estimate"],
    ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    // histogram of runnable scores (one bar per job row), with my what-if scores marked
    const bins = 28, width = 250, hist = new Array(bins).fill(0);
    run.forEach(p => hist[Math.min(bins - 1, Math.floor(p.priority / width))]++);
    const top = Math.max(1, ...hist);
    const myStd = s.estimates.whatif.find(w => w.qos === "standard" && !w.fairshare_assumed)?.score, myPrio = s.estimates.whatif.find(w => w.qos === "priority" && !w.fairshare_assumed)?.score;
    $("#hist").innerHTML = hist.map((c, i) => `<div class="bin" style="height:${(100 * c / top).toFixed(1)}%" data-tip="${i * width}–${(i + 1) * width - 1} points: ${c} jobs"></div>`).join("") +
      [[myStd, "me, standard"], [myPrio, "me, priority"]].filter(x => x[0]).map(([v, l]) => `<div class="mark" style="left:${(100 * Math.min(v, bins * width) / (bins * width)).toFixed(2)}%"><span>${l} ${v}</span></div>`).join("");
    $("#hist-axis").innerHTML = `<span>0</span><span>${bins * width / 2}</span><span>${bins * width}+</span>`;
    $("#hist-table").innerHTML = `<tr><th>points</th><th class="num">jobs</th></tr>` + hist.map((c, i) => c ? `<tr><td>${i * width}–${(i + 1) * width - 1}</td><td class="num">${c}</td></tr>` : "").join("");

    const qsel = $("#q-qos"), qoses = [...new Set(all.map(p => p.qos))].sort();
    const cur = qsel.value; qsel.innerHTML = `<option value="">any QoS</option>` + qoses.map(q => `<option>${q}</option>`).join(""); qsel.value = qoses.includes(cur) ? cur : "";
    const feas = $("#q-feas").value, q = $("#q-search").value.trim().toLowerCase(), onlyMine = $("#q-mine").getAttribute("aria-pressed") === "true";
    const myMin = Math.min(...s.pending.filter(p => p.user === me).map(p => p.priority), myStd || Infinity);
    let rows = all.filter(p => (feas === "all" || p.feasibility === feas) && (!qsel.value || p.qos === qsel.value) &&
      (!q || [p.user, p.account, p.job, p.name].some(x => String(x).toLowerCase().includes(q))) && (!onlyMine || p.feasibility === "runnable" && p.priority >= myMin));
    $("#q-count").textContent = `${rows.length} rows`;
    const h = `<tr><th class="num">#</th><th>job</th><th>user</th><th>account · QoS</th><th>request</th><th>partition</th><th class="num">waited</th><th>score</th><th>status</th><th>Slurm est.</th><th>planner (limit / typical)</th></tr>`;
    const explain = p => {
      const q = s.qos[p.qos] || {}, grp = !["standard", "basic", "priority"].includes(p.qos);
      const what = p.tasks > 1 ? `Job array: ${p.tasks} tasks, each ${p.gpus_per_node}×${skuName(p.sku)}${p.nodes > 1 ? ` on ${p.nodes} nodes` : ""} for up to ${fmtMin(p.limit_min)}${p.throttle ? `, at most ${p.throttle} tasks running at once` : ""}. A new task starts whenever one finishes.`
        : `Single job: ${p.gpus_per_node}×${skuName(p.sku)}${p.nodes > 1 ? ` on ${p.nodes} nodes` : ""} for up to ${fmtMin(p.limit_min)}.`;
      const qosTxt = grp ? `QoS ${p.qos}: +${q.points ?? "?"} priority points; the group may hold at most ${q.grp_gpus ?? "?"} GPUs at a time and holds ${q.running_gpus ?? "?"} now.`
        : p.qos === "priority" ? `QoS priority: +${q.points ?? 1000} points, paid with credit.` : `QoS ${p.qos}: no bonus; rank comes from fair-share and waiting time.`;
      return `${what}\n${qosTxt}\nStatus: ${p.feasibility}${p.reason ? ` (${p.reason})` : ""}.`;
    };
    $("#queue").innerHTML = h + rows.slice(0, 400).map((p, i) => {
      const est = p.plan ? `${fmtMin(p.plan.limit)} / ${fmtMin(p.plan.typical)}` : "–";
      const slurm = p.slurm_start ? fmtMin((new Date(p.slurm_start) - new Date(s.generated)) / 60000) : "–";
      const q = s.qos[p.qos] || {}, grp = !["standard", "basic", "priority"].includes(p.qos);
      const qosCell = grp ? `<span class="badge cap" title="group cap">${esc(p.qos)} · cap ${q.grp_gpus ?? "?"} GPUs, ${q.running_gpus ?? "?"} in use</span>` : `<span class="muted">${esc(p.qos)}${q.points ? ` +${q.points}` : ""}</span>`;
      return `<tr class="${p.user === me ? "mine" : ""}" data-tip="${esc(explain(p))}"><td class="num">${i + 1}</td><td>${esc(p.job)}${p.tasks > 1 ? `<br><span class="muted">array · ${p.tasks} tasks${p.throttle ? `, ≤${p.throttle} at once` : ""}</span>` : ""}<br><span class="muted">${esc(p.name)}</span></td>` +
        `<td>${esc(p.user)}</td><td>${esc(p.account)}<br>${qosCell}</td><td>${p.tasks > 1 ? `<span class="muted">each task: </span>` : ""}${req(p)}</td><td>${esc(p.partition)}</td><td class="num">${fmtMin(p.waited_min)}</td>` +
        `<td>${scoreBar(p)}<b>${p.priority}</b></td><td><span class="badge ${p.feasibility}">${p.feasibility}</span><br><span class="muted">${esc(p.reason || "")}</span></td><td>${slurm}</td><td>${est}</td></tr>`;
    }).join("") + (rows.length > 400 ? `<tr><td colspan="11" class="muted">… ${rows.length - 400} more rows (use the filters)</td></tr>` : "");
  }

  // ---------------------------------------------------------------- my jobs tab
  function renderMine() {
    const s = state.snap, me = s.user, est = s.estimates, hist = state.hist;
    const fs = s.mine.fairshare.map(f => `[${f.account}] ${Math.round(f.user_factor * 10000)} pts`).join(" · ");
    $("#mine-tiles").innerHTML = [
      [s.mine.running.length, "running"], [s.mine.pending.length, "waiting"],
      ...s.mine.fairshare.map(f => [Math.round(f.user_factor * 10000), `fair-share points · ${f.account}`]),
      ...s.mine.fairshare.filter(f => f.account === s.config.whatif_account).map(f => [Math.round(f.account_raw_usage_h ?? 0).toLocaleString(), `account usage counted, core-h`]),
    ].map(([v, l]) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    const running = s.running.filter(r => r.user === me);
    $("#mine-running").innerHTML = running.length ? running.map(r => {
      const frac = r.limit_min ? Math.min(1, r.elapsed_min / r.limit_min) : 0;
      return `<div class="card"><h3>${esc(r.job)} <small>${esc(r.name)}</small></h3><div class="note">${req(r)} · ${esc(r.qos)} · ${Object.keys(r.per_node).join(", ")}</div>` +
        `<div class="meter"><i style="width:${(frac * 100).toFixed(0)}%"></i></div><div class="kv"><span>elapsed <b>${fmtMin(r.elapsed_min)}</b> of ${fmtMin(r.limit_min)}</span><span>ends by <b>${fmtTs(r.end)}</b></span></div>` +
        `<div class="kv"><span>submitted ${fmtTs(r.submit)}</span><span>waited <b>${fmtMin((new Date(r.start) - new Date(r.submit)) / 60000)}</b></span><span>started ${fmtTs(r.start)}</span></div></div>`;
    }).join("") : `<p class="note">none</p>`;

    const pend = s.pending.filter(p => p.user === me);
    $("#mine-pending").innerHTML = pend.length ? pend.map(p => {
      const e = est.queued[p.job] || {}; const b = p.prio || {};
      const hb = e.history ? `${fmtH(e.history.median_h)} median · ${fmtH(e.history.p90_h)} p90 (n=${e.history.n})` : "–";
      return `<div class="card"><h3>${esc(p.job)} <small>${esc(p.name)}</small></h3><div class="note">${req(p)} · ${esc(p.qos)} · ${esc(p.partition)} · <span class="badge ${p.feasibility}">${p.feasibility}</span> ${esc(p.reason || "")}</div>` +
        `<div class="kv"><span>score ${scoreBar(p)}<b>${p.priority}</b></span><span>fair-share ${b.fairshare ?? "–"} · QoS ${b.qos ?? "–"} · age ${b.age ?? "–"} · size ${b.size ?? "–"}${b.estimated ? " (estimated)" : ""}</span></div>` +
        `<div class="kv"><span>ahead of me: <b>${e.jobs_ahead ?? "–"}</b> jobs (${e.tasks_ahead ?? "–"} tasks wanting ${e.gpus_ahead ?? "–"} GPUs) of ${e.competitors ?? "–"} competing for ${skuName(e.sku)}</span></div>` +
        `<div class="kv"><span>submitted ${fmtTs(p.submit)} · waited <b>${fmtMin(p.waited_min)}</b></span></div>` +
        `<div class="kv"><span>Slurm's estimate <b>${p.slurm_start ? fmtTs(p.slurm_start) : "none"}</b></span></div>` +
        `<div class="kv"><span>planner, by time limits <b>${fmtMin(e.limit?.start_min)}</b> ${e.limit?.nodes?.length ? "on " + e.limit.nodes.join(", ") : ""}</span></div>` +
        `<div class="kv"><span>planner, typical run times <b>${fmtMin(e.typical?.start_min)}</b> ${e.typical?.nodes?.length ? "on " + e.typical.nodes.join(", ") : ""}</span></div>` +
        `<div class="kv"><span>history for this request: ${hb}</span></div></div>`;
    }).join("") : `<p class="note">none</p>`;

    $("#whatif-note").textContent = `${skuName(s.config.whatif_sku)}, ${s.config.cores_per_gpu} cores and ${s.config.mem_per_gpu_gb} GB per GPU, account ${s.config.whatif_account}`;
    const wh = `<tr><th>request</th><th>QoS</th><th class="num">fair-share</th><th class="num">score</th><th class="num">jobs ahead</th><th class="num">GPUs they want</th><th>start, by time limits</th><th>start, typical run times</th><th>history: median / p75 / p90</th></tr>`;
    $("#whatif").innerHTML = wh + est.whatif.map(w => {
      const h = w.history ? `${fmtH(w.history.median_h)} / ${fmtH(w.history.p75_h)} / ${fmtH(w.history.p90_h)} <span class="muted">(n=${w.history.n})</span>` : "<span class='muted'>no data</span>";
      return `<tr${w.fairshare_assumed ? ' class="assumed"' : ""}><td>${w.gpus}×${skuName(s.config.whatif_sku)}${w.nodes > 1 ? ` on ${w.nodes} nodes` : ""} · ${w.cores}c · ${w.mem_gb}G · ${w.hours}h</td><td>${w.qos}</td><td class="num">${w.fairshare ?? "–"}${w.fairshare_assumed ? ' <span class="muted">if</span>' : ""}</td><td class="num">${w.score}</td><td class="num">${w.jobs_ahead} <span class="muted">(${w.tasks_ahead} tasks)</span></td><td class="num">${w.gpus_ahead}</td>` +
        `<td><b>${fmtMin(w.limit?.start_min)}</b> ${w.limit?.nodes?.length ? `<span class="muted">${w.limit.nodes.join(", ")}</span>` : w.limit?.start_min == null ? `<span class="muted">beyond ${s.config.horizon_h / 24} days</span>` : ""}</td>` +
        `<td><b>${fmtMin(w.typical?.start_min)}</b> ${w.typical?.nodes?.length ? `<span class="muted">${w.typical.nodes.join(", ")}</span>` : ""}</td><td>${h}</td></tr>`;
    }).join("");
    $("#whatif-legend").innerHTML = `<b>By time limits</b>: every running and higher-priority job is assumed to use its full time limit (pessimistic). <b>Typical run times</b>: each user's measured ratio of run time to limit is applied (default ${s.config.default_ratio}). ` +
      `<b>History</b>: real waits of all users' jobs with the same request over the last ${hist?.days ?? 90} days. Rows marked <i>if</i> assume a fair-share score you do not have yet. Jobs submitted later with a higher score, and group-QoS jobs, can still jump ahead.`;

    const acc = hist?.accuracy;
    const ah = `<tr><th>request class</th><th class="num">jobs</th><th class="num">actual wait, median</th><th class="num">planner by limits: median error · |mean|</th><th class="num">planner typical: median error · |mean|</th><th class="num">Slurm's estimate: median error · |mean|</th></tr>`;
    const accRow = (k, a) => `<tr><td>${k === "all" ? "<b>all</b>" : k.split("|").map((x, i) => i === 0 ? skuName(x) : i === 1 ? x + " GPU" : i === 2 ? x + " node" : x).join(" · ")}</td><td class="num">${a.n}</td><td class="num">${fmtH(a.actual?.median)}</td>` +
      ["limit", "typical", "slurm"].map(m => `<td class="num">${a[m] ? `${a[m].median > 0 ? "+" : ""}${a[m].median} · ${a[m].mean_abs}` : "–"}</td>`).join("") + "</tr>";
    $("#accuracy").innerHTML = acc && Object.keys(acc).length ? ah + Object.entries(acc).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => accRow(k, a)).join("")
      : `<tr><td class="muted">No scored estimates yet. The collector logs its first estimate for every pending job; the daily history run compares them with the real start times.</td></tr>`;

    const rh = `<tr><th>job</th><th>name</th><th>state</th><th>request</th><th>QoS</th><th>submitted</th><th class="num">waited</th><th class="num">ran</th><th>nodes</th></tr>`;
    $("#recent").innerHTML = rh + s.mine.recent.slice().reverse().map(r => {
      const waited = r.start ? (new Date(r.start) - new Date(r.submit)) / 60000 : null;
      return `<tr><td>${esc(r.job)}</td><td>${esc(r.name)}</td><td>${esc(r.state)}</td><td>${r.gpus}×${skuName(r.sku || "gpu")}</td><td>${esc(r.qos)}</td><td>${fmtTs(r.submit)}</td><td class="num">${fmtMin(waited)}</td><td class="num">${fmtMin(r.elapsed_min)} / ${fmtMin(r.limit_min)}</td><td>${esc(r.nodes)}</td></tr>`;
    }).join("");
  }

  // ---------------------------------------------------------------- render + events
  function render() {
    if (!state.snap) return;
    renderHeader(); renderNodes(); renderQueue(); renderMine();
    $$("[role=tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    ["nodes", "queue", "mine"].forEach(t => $(`#tab-${t}`).hidden = t !== state.tab);
  }
  $$("[role=tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; location.hash = state.tab; render(); });
  $("#sku").onchange = e => { state.sku = e.target.value; localStorage.setItem("sku", state.sku); render(); };
  ["#node-sort", "#q-feas", "#q-qos"].forEach(id => $(id).onchange = render);
  $("#q-search").oninput = render;
  $("#q-mine").onclick = e => { e.target.setAttribute("aria-pressed", e.target.getAttribute("aria-pressed") !== "true"); render(); };
  $("#refresh").onclick = load;
  $("#theme").onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark"; localStorage.setItem("theme", document.documentElement.dataset.theme);
  };
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch { }
  $("#settings").onclick = () => { const c = cfg(); $("#cfg-repo").value = c.repo || ""; $("#cfg-branch").value = c.branch || "data"; $("#cfg-token").value = c.token || ""; $("#dlg").showModal(); };
  $("#cfg-cancel").onclick = () => $("#dlg").close();
  $("#cfg-save").onclick = () => { localStorage.setItem("cfg", JSON.stringify({ repo: $("#cfg-repo").value.trim(), branch: $("#cfg-branch").value.trim() || "data", token: $("#cfg-token").value.trim() })); $("#dlg").close(); load(); };

  // tooltips + multi-node highlight
  const tip = $("#tip");
  document.addEventListener("mouseover", e => {
    const t = e.target.closest("[data-tip]"); if (!t) return;
    tip.textContent = t.dataset.tip; tip.style.display = "block";
    if (t.dataset.job) $$(`.slot[data-job="${CSS.escape(t.dataset.job)}"]`).forEach(x => x.classList.add("hl"));
  });
  document.addEventListener("mousemove", e => { if (tip.style.display === "block") { tip.style.left = Math.min(innerWidth - 330, e.clientX + 14) + "px"; tip.style.top = Math.min(innerHeight - 140, e.clientY + 14) + "px"; } });
  document.addEventListener("mouseout", e => { const t = e.target.closest("[data-tip]"); if (!t) return; tip.style.display = "none"; $$(".slot.hl").forEach(x => x.classList.remove("hl")); });
  document.addEventListener("click", e => { const t = e.target.closest(".slot[data-job]"); if (t && matchMedia("(hover: none)").matches) { tip.textContent = t.dataset.tip; tip.style.display = tip.style.display === "block" ? "none" : "block"; tip.style.left = "16px"; tip.style.top = (e.clientY + 12) + "px"; } });

  load();
  setInterval(load, 2 * 60 * 1000);
  setInterval(() => { if (state.snap) renderHeader(); }, 30 * 1000);
})();

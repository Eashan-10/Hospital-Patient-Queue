/* ============================================================
   Ward Queue — single-page frontend
   One file drives both views:
     "/"              -> the three tabs (manage / search / queue)
     "/patient/<id>"  -> a patient profile
   ============================================================ */
(() => {
  "use strict";

  /* ---------------- helpers ---------------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove("show"), 2800);
  }

  async function api(url, method = "GET", body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body && JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || "Something went wrong.");
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  const badge = p => `<span class="badge u${p.urgency}">${p.urgency}  ${p.urgency_label}</span>`;
  const fmtTime = iso => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function fmtWait(iso) {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
  }

  const readFields = p => ({
    name: $(p + "-name").value,
    age: $(p + "-age").value,
    gender: $(p + "-gender").value,
    urgency: document.querySelector(`input[name="${p}-urg"]:checked`).value,
    notes: $(p + "-notes").value
  });
  function fillFields(p, o) {
    $(p + "-name").value = o.name;
    $(p + "-age").value = o.age;
    $(p + "-gender").value = o.gender;
    $(p + "-notes").value = o.notes || "";
    document.querySelector(`input[name="${p}-urg"][value="${o.urgency}"]`).checked = true;
  }
  const resetFields = p => fillFields(p, { name: "", age: "", gender: "Female", urgency: 3, notes: "" });

  function confirmDuplicate(d, verb) {
    return new Promise(resolve => {
      const dlg = $("dupdlg");
      $("dup-text").innerHTML =
        `<strong>${esc(d.name)}</strong> (${d.age}, ${esc(d.gender)}) is already registered as ` +
        `<strong>${esc(d.id)}</strong> with urgency ${esc(String(d.urgency_label).toLowerCase())}. ` +
        `Check the profile before continuing.`;
      $("dup-link").href = `/patient/${d.id}`;
      $("dup-go").textContent = verb;
      dlg.returnValue = "";
      dlg.onclose = () => resolve(dlg.returnValue === "force");
      dlg.showModal();
    });
  }

  async function saveWithDupCheck(url, method, body, verb) {
    try {
      return await api(url, method, body);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.duplicate) {
        return (await confirmDuplicate(e.data.duplicate, verb))
          ? api(url, method, { ...body, force: true })
          : null;
      }
      throw e;
    }
  }

  function animateNumber(el, to, dur = 600) {
    to = Number(to) || 0;
    if (!el) return;
    if (reduced()) { el.textContent = String(to); el.dataset.v = to; return; }
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = String(to); return; }
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- routing ---------------- */
  const cleanPath = location.pathname.replace(/\/+$/, "") || "/";
  const profileMatch = cleanPath.match(/^\/patient\/(.+)$/);
  const profileId = profileMatch ? decodeURIComponent(profileMatch[1]) : null;
  const isProfile = !!profileId;

  const TABS = {
    manage: ["Manage Patients", "Register new arrivals and update existing records."],
    search: ["Search Patient", "Find a patient by ID or name."],
    queue:  ["Current Queue", "Most urgent first; ties go to the earlier arrival."]
  };

  /* ---------------- state ---------------- */
  let all = [];
  let prevIds = new Set();
  let flashNext = false;
  let cur = null;
  let waitTimer = null;

  const emptyRow = (text, cols = 6) =>
    `<tr class="empty-row"><td colspan="${cols}"><div class="empty-inline">${esc(text)}</div></td></tr>`;
  const skeletonRows = (cols = 6, n = 6) =>
    Array.from({ length: n }, () => `<tr class="sk-row"><td colspan="${cols}"><span class="sk bar"></span></td></tr>`).join("");

  /* ---------------- tabs ---------------- */
  function showTab() {
    const key = TABS[location.hash.slice(1)] ? location.hash.slice(1) : "manage";
    document.querySelectorAll(".panel").forEach(s => s.hidden = s.id !== key);
    document.querySelectorAll("[data-nav]").forEach(a => {
      const on = a.dataset.nav === key;
      a.classList.toggle("on", on);
      a.setAttribute("aria-current", on ? "page" : "false");
    });
    $("view-title").textContent = TABS[key][0];
    $("view-subtitle").textContent = TABS[key][1];
    document.title = `${TABS[key][0]}  Ward Queue`;
    if (!all.length) { $("rows").innerHTML = skeletonRows(); $("search-tbody").innerHTML = skeletonRows(); }
    safeRefresh();
  }

  async function refresh() {
    all = await api("/api/queue");
    renderStats(); renderQueue(); renderSearch();
  }
  const safeRefresh = () => refresh().catch(x => toast(x.message));

  /* ---------------- manage ---------------- */
  function resetForm() {
    resetFields("f");
    $("pid").value = "";
    $("form-title").textContent = "Register a patient";
    $("save").textContent = "Register patient";
    $("cancel").hidden = true;
  }
  function startEdit(p) {
    fillFields("f", p);
    $("pid").value = p.id;
    $("form-title").textContent = `Edit ${p.id}`;
    $("save").textContent = "Save changes";
    $("cancel").hidden = false;
    $("saved").innerHTML = "";
    location.hash = "manage";
    showTab();
    $("f-name").focus();
  }
  function renderStats() {
    animateNumber($("stat-total"), all.length);
    animateNumber($("stat-critical"), all.filter(p => p.urgency === 5).length);
    $("stat-wait").textContent = all.length
      ? fmtWait(all.reduce((a, b) => (a.arrived_at <= b.arrived_at ? a : b)).arrived_at)
      : "–";
    const recent = [...all]
      .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at) || b.id.localeCompare(a.id))
      .slice(0, 5);
    $("recent").innerHTML = recent.length
      ? recent.map(p => `<a class="mini u${p.urgency}" href="/patient/${p.id}"><span class="mini-main"><strong>${esc(p.name)}</strong><span class="mini-id">${esc(p.id)}</span></span>${badge(p)}</a>`).join("")
      : `<div class="mini-empty"><p>No one is waiting yet.</p></div>`;
  }

  /* ---------------- search ---------------- */
  function renderSearch() {
    const raw = $("search-input").value.trim();
    const q = raw.toLowerCase();
    const body = $("search-tbody");
    if (!q) { body.innerHTML = emptyRow("Type a name or patient ID to begin."); return; }
    const hits = all.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    body.innerHTML = hits.length
      ? hits.map(p => `<tr class="u${p.urgency}">
          <td data-label="ID"><a href="/patient/${p.id}">${esc(p.id)}</a></td>
          <td data-label="Name">${esc(p.name)}</td>
          <td data-label="Age / Gender">${p.age}, ${esc(p.gender)}</td>
          <td data-label="Urgency">${badge(p)}</td>
          <td data-label="Rank">${p.rank} of ${p.queue_size}</td>
          <td data-label="Actions" class="actions"><a class="btn sm" href="/patient/${p.id}">Profile</a><button class="sm" type="button" data-edit="${p.id}">Edit</button></td>
        </tr>`).join("")
      : emptyRow(`No patient matches "${raw}".`);
  }

  /* ---------------- queue ---------------- */
  function renderQueue() {
    $("count").textContent = all.length;
    $("empty").hidden = all.length > 0;
    const firstLoad = prevIds.size === 0;
    $("rows").innerHTML = all.map(p => {
      const isNew = !firstLoad && !prevIds.has(p.id);
      const flash = isNew || (flashNext && p.rank === 1);
      return `<tr class="u${p.urgency}${p.rank === 1 ? " next" : ""}${flash ? " flash" : ""}">
        <td data-label="Rank" class="rank">${p.rank}</td>
        <td data-label="Patient"><a href="/patient/${p.id}">${esc(p.name)}</a>${p.rank === 1 ? '<span class="tag">Next</span>' : ""}</td>
        <td data-label="ID">${esc(p.id)}</td>
        <td data-label="Age">${p.age}</td>
        <td data-label="Gender">${esc(p.gender)}</td>
        <td data-label="Urgency">${badge(p)}</td>
      </tr>`;
    }).join("");
    prevIds = new Set(all.map(p => p.id));
    flashNext = false;
  }

  /* ---------------- density ---------------- */
  const DKEY = "wq-density";
  function setDensity(d) {
    document.querySelectorAll("[data-density]").forEach(b => {
      const on = b.dataset.density === d;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const scroller = document.querySelector("#queue .scroll");
    if (scroller) scroller.classList.toggle("dense", d === "compact");
    try { localStorage.setItem(DKEY, d); } catch (e) {}
  }

  /* ---------------- profile ---------------- */
  const I = {
    wait: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    age: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a9 9 0 0 1 9 9c0 4-2.5 7-5 8.5V22H8v-2.5C5.5 18 3 15 3 11a9 9 0 0 1 9-9Z"/></svg>',
    gender: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="14" r="5"/><path d="M14 10l5-5M15 4h4v4"/></svg>',
    arrived: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>'
  };

  function renderNotFound() {
    $("view-title").textContent = "Patient not found";
    $("view-subtitle").textContent = "This patient is no longer in the queue.";
    $("profile").innerHTML = `<div class="card empty">
      <svg width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">
        <ellipse cx="60" cy="74" rx="42" ry="7" fill="#e2ecfb"/>
        <rect x="26" y="20" width="68" height="48" rx="10" fill="#f1f7ff" stroke="#c6d6ee" stroke-width="2"/>
        <path d="M44 40l32 18M76 40L44 58" stroke="#c6d6ee" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <h3>Patient not found</h3>
      <p class="muted">No patient has the ID ${esc(profileId)}. They may already have been called or removed.</p>
      <a class="btn primary" href="/#manage">Search again</a>
    </div>`;
  }

  function renderProfile() {
    const p = cur;
    $("profile").innerHTML = `
    <header class="ph u${p.urgency}">
      <div class="ph-main">
        <p class="pid">${esc(p.id)}
          <button class="copy" id="copy" type="button" aria-label="Copy patient ID">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </p>
        <h1>${esc(p.name)}</h1>
        <ul class="ph-meta">
          <li>${I.age} ${p.age} yrs</li>
          <li>${I.gender} ${esc(p.gender)}</li>
          <li>${I.arrived} Arrived ${fmtTime(p.arrived_at)}</li>
        </ul>
      </div>
      <div class="ph-side">
        ${badge(p)}
        <div class="ph-rank"><span>Queue position</span><strong>${p.rank} of ${p.queue_size}</strong></div>
      </div>
    </header>

    <div class="stats">
      <div class="stat"><span class="stat-ico">${I.wait}</span><div><span class="stat-label">Waiting</span><strong id="wait">${fmtWait(p.arrived_at)}</strong></div></div>
      <div class="stat"><span class="stat-ico">${I.age}</span><div><span class="stat-label">Age</span><strong>${p.age} yrs</strong></div></div>
      <div class="stat"><span class="stat-ico">${I.gender}</span><div><span class="stat-label">Gender</span><strong>${esc(p.gender)}</strong></div></div>
      <div class="stat"><span class="stat-ico">${I.arrived}</span><div><span class="stat-label">Arrived</span><strong>${fmtTime(p.arrived_at)}</strong></div></div>
    </div>

    <div class="cols">
      <section class="card">
        <div class="card-head">
          <span class="card-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span>
          <div><h2>Notes</h2></div>
        </div>
        ${p.notes ? `<p class="notes-body">${esc(p.notes)}</p>` : '<p class="muted">No notes recorded.</p>'}
      </section>
      <section class="card">
        <div class="card-head">
          <span class="card-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 5-7"/></svg></span>
          <div><h2>Activity</h2><p class="card-sub">${p.history.length} event${p.history.length === 1 ? "" : "s"}</p></div>
        </div>
        <ol class="log">${[...p.history].reverse().map(h => `<li><time>${fmtTime(h.t)}</time>${esc(h.text)}</li>`).join("")}</ol>
      </section>
    </div>

    <div class="page-actions">
      <button id="edit" class="primary" type="button">Edit patient</button>
      <button id="print" class="btn" type="button">Print</button>
      <button id="del" class="danger" type="button">Remove from queue</button>
    </div>`;

    $("edit").onclick = () => { fillFields("e", p); $("editdlg").showModal(); };
    $("print").onclick = () => window.print();
    $("copy").onclick = async () => {
      try { await navigator.clipboard.writeText(p.id); toast("Patient ID copied."); }
      catch (e) { toast("Could not copy — select the ID manually."); }
    };
    $("del").onclick = async () => {
      if (!confirm(`Remove ${p.name} from the queue?`)) return;
      try { await api(`/api/patients/${p.id}`, "DELETE"); location.href = "/#queue"; }
      catch (x) { toast(x.message); }
    };

    clearInterval(waitTimer);
    waitTimer = setInterval(() => { const w = $("wait"); if (w) w.textContent = fmtWait(p.arrived_at); }, 30000);
  }

  async function loadProfile() {
    try {
      cur = await api(`/api/patients/${encodeURIComponent(profileId)}`);
      $("profile").dataset.id = cur.id;
      renderProfile();
      $("view-title").textContent = cur.name;
      $("view-subtitle").textContent = `Patient ${cur.id}  position ${cur.rank} of ${cur.queue_size}.`;
      document.title = `${cur.name}  Ward Queue`;
    } catch (x) {
      renderNotFound();
    }
  }

  /* ---------------- wiring ---------------- */
  // live character counters
  document.querySelectorAll("[data-count-for]").forEach(el => {
    const t = document.getElementById(el.dataset.countFor);
    if (!t) return;
    const max = t.maxLength > 0 ? t.maxLength : 500;
    const upd = () => {
      el.textContent = `${t.value.length} / ${max}`;
      el.classList.toggle("over", t.value.length >= max);
    };
    t.addEventListener("input", upd);
    upd();
  });

  // manage form
  $("cancel").onclick = resetForm;
  $("form").onsubmit = async e => {
    e.preventDefault();
    const id = $("pid").value;
    try {
      const p = await saveWithDupCheck(
        id ? `/api/patients/${id}` : "/api/patients",
        id ? "PUT" : "POST",
        readFields("f"),
        id ? "Save anyway" : "Register anyway"
      );
      if (!p) return;
      toast(id ? `Saved changes for ${p.name}.` : `Registered ${p.name} as ${p.id}.`);
      $("saved").innerHTML = `<p class="notice"><span>${id ? "Saved changes for" : "Registered"} <strong>${esc(p.name)}</strong>${id ? "" : ` as <strong>${esc(p.id)}</strong>`}. <a href="/patient/${p.id}">Open profile</a></span></p>`;
      resetForm();
      safeRefresh();
    } catch (x) { toast(x.message); }
  };

  // search
  $("search-input").oninput = renderSearch;
  $("search-tbody").onclick = e => {
    const b = e.target.closest("[data-edit]");
    if (b) startEdit(all.find(p => p.id === b.dataset.edit));
  };

  // queue
  $("refresh").onclick = safeRefresh;
  $("next").onclick = async () => {
    try { const p = await api("/api/queue/next", "POST"); toast(`Calling ${p.name} (${p.id}).`); flashNext = true; }
    catch (x) { toast(x.message); }
    safeRefresh();
  };

  // density toggle
  document.querySelectorAll("[data-density]").forEach(b => b.onclick = () => setDensity(b.dataset.density));
  let savedDensity = "comfortable";
  try { savedDensity = localStorage.getItem(DKEY) || "comfortable"; } catch (e) {}
  setDensity(savedDensity === "compact" ? "compact" : "comfortable");

  // edit dialog (profile)
  $("e-cancel").onclick = () => $("editdlg").close();
  $("editform").onsubmit = async e => {
    e.preventDefault();
    try {
      const p = await saveWithDupCheck(`/api/patients/${cur.id}`, "PUT", readFields("e"), "Save anyway");
      if (!p) return;
      $("editdlg").close();
      toast("Changes saved.");
      loadProfile();
    } catch (x) { toast(x.message); }
  };

  // clock
  (function clock() {
    const c = $("live-clock");
    const tick = () => c.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    tick();
    setInterval(tick, 1000);
  })();

  /* ---------------- boot ---------------- */
  if (isProfile) {
    document.querySelectorAll("[data-nav]").forEach(a => { a.classList.remove("on"); a.removeAttribute("aria-current"); });
    loadProfile();
  } else {
    addEventListener("hashchange", showTab);
    showTab();
    setInterval(() => { if (!document.hidden && !$("queue").hidden) safeRefresh(); }, 30000);
  }
})();

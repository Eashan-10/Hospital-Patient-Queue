const P = "f";   // id prefix of the shared form fields
const TABS = {
  manage: ["Manage Patients", "Register new arrivals and update existing records."],
  search: ["Search Patient", "Find a patient by ID or name."],
  queue:  ["Current Queue", "Most urgent first; ties go to the earlier arrival."]
};
let all = [];   // latest queue snapshot from the server (already in rank order)

const emptyRow = (text, cols = 6) => `<tr><td colspan="${cols}" class="muted center">${esc(text)}</td></tr>`;

async function refresh() {
  all = await api("/api/queue");
  renderStats(); renderQueue(); renderSearch();
}
const safeRefresh = () => refresh().catch(x => toast(x.message));

/* ---------- tabs ---------- */
function showTab() {
  const t = TABS[location.hash.slice(1)] ? location.hash.slice(1) : "manage";
  document.querySelectorAll(".panel").forEach(s => s.hidden = s.id !== t);
  document.querySelectorAll("[data-nav]").forEach(a => {
    const on = a.dataset.nav === t;
    a.classList.toggle("on", on); a.setAttribute("aria-current", on ? "page" : "false");
  });
  $("view-title").textContent = TABS[t][0]; $("view-subtitle").textContent = TABS[t][1];
  document.title = `${TABS[t][0]} · Ward Queue`;
  safeRefresh();
}
addEventListener("hashchange", showTab);

/* ---------- manage ---------- */
function resetForm() {
  resetFields(P); $("pid").value = "";
  $("form-title").textContent = "Register a patient"; $("save").textContent = "Register patient"; $("cancel").hidden = true;
}
$("cancel").onclick = resetForm;

$("form").onsubmit = async e => {
  e.preventDefault();
  const id = $("pid").value;
  try {
    const p = await saveWithDupCheck(id ? `/api/patients/${id}` : "/api/patients", id ? "PUT" : "POST",
      readFields(P), id ? "Save anyway" : "Register anyway");
    if (!p) return;
    toast(id ? `Saved changes for ${p.name}.` : `Registered ${p.name} as ${p.id}.`);
    $("saved").innerHTML = `<p class="notice">${id ? "Saved changes for" : "Registered"} <strong>${esc(p.name)}</strong>${id ? "" : ` as <strong>${p.id}</strong>`}. <a href="/patient/${p.id}">Open profile</a></p>`;
    resetForm(); safeRefresh();
  } catch (x) { toast(x.message); }
};

function startEdit(p) {
  fillFields(P, p); $("pid").value = p.id;
  $("form-title").textContent = `Edit ${p.id}`; $("save").textContent = "Save changes";
  $("cancel").hidden = false; $("saved").innerHTML = "";
  location.hash = "manage"; showTab(); $(P + "-name").focus();
}

function renderStats() {
  $("stat-total").textContent = all.length;
  $("stat-critical").textContent = all.filter(p => p.urgency === 5).length;
  $("stat-wait").textContent = all.length ? fmtWait(all.reduce((a, b) => (a.arrived_at <= b.arrived_at ? a : b)).arrived_at) : "–";
  const recent = [...all].sort((a, b) => b.arrived_at.localeCompare(a.arrived_at) || b.id.localeCompare(a.id)).slice(0, 5);
  $("recent").innerHTML = recent.length
    ? recent.map(p => `<a class="mini u${p.urgency}" href="/patient/${p.id}"><span><strong>${esc(p.name)}</strong> <span class="muted">${p.id}</span></span>${badge(p)}</a>`).join("")
    : '<p class="muted">No one is waiting yet.</p>';
}

/* ---------- search ---------- */
function renderSearch() {
  const q = $("search-input").value.trim().toLowerCase();
  const body = $("search-tbody");
  if (!q) { body.innerHTML = emptyRow("Type a name or patient ID to begin."); return; }
  const hits = all.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  body.innerHTML = hits.length ? hits.map(p => `<tr class="u${p.urgency}">
    <td><a href="/patient/${p.id}">${p.id}</a></td><td>${esc(p.name)}</td><td>${p.age}, ${p.gender}</td><td>${badge(p)}</td><td>${p.rank} of ${p.queue_size}</td>
    <td class="actions"><a class="btn sm" href="/patient/${p.id}">Profile</a><button class="sm" data-edit="${p.id}">Edit</button></td></tr>`).join("")
    : emptyRow(`No patient matches "${$("search-input").value.trim()}".`);
}
$("search-input").oninput = renderSearch;
$("search-tbody").onclick = e => {
  const b = e.target.closest("[data-edit]");
  if (b) startEdit(all.find(p => p.id === b.dataset.edit));
};

/* ---------- queue ---------- */
function renderQueue() {
  $("count").textContent = `(${all.length})`;
  $("empty").hidden = all.length > 0;
  $("rows").innerHTML = all.map(p => `<tr class="u${p.urgency}${p.rank === 1 ? " next" : ""}"><td class="rank">${p.rank}</td>
    <td><a href="/patient/${p.id}">${esc(p.name)}</a>${p.rank === 1 ? '<span class="tag">Next</span>' : ""}</td>
    <td>${p.id}</td><td>${p.age}</td><td>${p.gender}</td><td>${badge(p)}</td></tr>`).join("");
}
$("refresh").onclick = safeRefresh;
$("next").onclick = async () => {
  try { const p = await api("/api/queue/next", "POST"); toast(`Calling ${p.name} (${p.id}).`); } catch (x) { toast(x.message); }
  safeRefresh();
};

showTab();
setInterval(() => { if (!document.hidden && !$("queue").hidden) safeRefresh(); }, 30000);
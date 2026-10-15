const pid = $("profile").dataset.id;
let cur = null, timer = null;

async function load() {
  try { cur = await api(`/api/patients/${encodeURIComponent(pid)}`); render(); }
  catch (x) {
    $("profile").innerHTML = `<div class="card"><h2>Patient not found</h2>
    <p class="muted">No patient has the ID ${esc(pid)}. They may already have been called or removed.</p><a class="btn" href="/#manage">Search again</a></div>`;
  }
}
function render() {
  const p = cur;
  $("profile").innerHTML = `
  <header class="ph u${p.urgency}"><div><p class="pid">${p.id}</p><h1>${esc(p.name)}</h1></div>${badge(p)}</header>
  <div class="stats">
    <div class="stat"><span>Queue position</span><strong>${p.rank} of ${p.queue_size}</strong></div>
    <div class="stat"><span>Age</span><strong>${p.age}</strong></div>
    <div class="stat"><span>Gender</span><strong>${p.gender}</strong></div>
    <div class="stat"><span>Arrived</span><strong>${fmtTime(p.arrived_at)}</strong></div>
    <div class="stat"><span>Waiting</span><strong id="wait">${fmtWait(p.arrived_at)}</strong></div>
  </div>
  <div class="cols">
    <section class="card"><h2>Notes</h2>${p.notes ? `<p>${esc(p.notes)}</p>` : '<p class="muted">No notes recorded.</p>'}</section>
    <section class="card"><h2>Activity</h2><ol class="log">${[...p.history].reverse().map(h => `<li><time>${fmtTime(h.t)}</time>${esc(h.text)}</li>`).join("")}</ol></section>
  </div>
  <div class="actions" style="margin-top:16px"><button id="edit" class="primary">Edit patient</button><button id="del" class="danger">Remove from queue</button></div>`;
  $("edit").onclick = () => { fillFields("e", p); $("editdlg").showModal(); };
  $("del").onclick = async () => {
    if (!confirm(`Remove ${p.name} from the queue?`)) return;
    try { await api(`/api/patients/${p.id}`, "DELETE"); location.href = "/#queue"; } catch (x) { toast(x.message); }
  };
  clearInterval(timer); timer = setInterval(() => $("wait") && ($("wait").textContent = fmtWait(p.arrived_at)), 30000);
}
$("e-cancel").onclick = () => $("editdlg").close();
$("editform").onsubmit = async e => {
  e.preventDefault();
  try {
    const p = await saveWithDupCheck(`/api/patients/${cur.id}`, "PUT", readFields("e"), "Save anyway");
    if (!p) return;
    $("editdlg").close(); toast("Changes saved."); load();
  } catch (x) { toast(x.message); }
};
load();

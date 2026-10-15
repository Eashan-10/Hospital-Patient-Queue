const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2800); }
async function api(url, method = "GET", body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d.error || "Something went wrong."); e.status = r.status; e.data = d; throw e; }
  return d;
}
const badge = p => `<span class="badge u${p.urgency}">${p.urgency} · ${p.urgency_label}</span>`;
const fmtTime = iso => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function fmtWait(iso) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
const radio = (p, v) => document.querySelector(`input[name="${p}-urg"][value="${v}"]`);
const readFields = p => ({ name: $(p + "-name").value, age: $(p + "-age").value, gender: $(p + "-gender").value,
  urgency: document.querySelector(`input[name="${p}-urg"]:checked`).value, notes: $(p + "-notes").value });
function fillFields(p, o) {
  $(p + "-name").value = o.name; $(p + "-age").value = o.age; $(p + "-gender").value = o.gender;
  $(p + "-notes").value = o.notes || ""; radio(p, o.urgency).checked = true;
}
const resetFields = p => fillFields(p, { name: "", age: "", gender: "Female", urgency: 3, notes: "" });

function confirmDuplicate(d, verb) {
  return new Promise(resolve => {
    const dlg = $("dupdlg");
    $("dup-text").innerHTML = `<strong>${esc(d.name)}</strong> (${d.age}, ${d.gender}) is already registered as <strong>${d.id}</strong> with urgency ${d.urgency_label.toLowerCase()}. Check the profile before continuing.`;
    $("dup-link").href = `/patient/${d.id}`; $("dup-go").textContent = verb;
    dlg.returnValue = ""; dlg.onclose = () => resolve(dlg.returnValue === "force"); dlg.showModal();
  });
}
// Saves; if the server reports a duplicate, asks first and retries with force. Returns null if cancelled.
async function saveWithDupCheck(url, method, body, verb) {
  try { return await api(url, method, body); }
  catch (e) {
    if (e.status === 409 && e.data.duplicate) {
      return (await confirmDuplicate(e.data.duplicate, verb)) ? api(url, method, { ...body, force: true }) : null;
    }
    throw e;
  }
}

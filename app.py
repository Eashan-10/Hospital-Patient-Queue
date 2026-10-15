from datetime import datetime, timezone
from flask import Flask, jsonify, request, render_template
from heap import PatientHeap

app = Flask(__name__)

# ---- Patient records (kept separate from the heap) ----
records = {}      # patient_id -> record
by_key = {}       # (normalised name, age, gender) -> set of patient_ids  (O(1) duplicate check)
heap = PatientHeap()
_counter = 0
_seq = 0

URGENCY = {1: "Minor", 2: "Low", 3: "Moderate", 4: "High", 5: "Critical"}

def now(): return datetime.now(timezone.utc).isoformat(timespec="seconds")
def dup_key(r): return (" ".join(r["name"].lower().split()), r["age"], r["gender"])

def new_id():
    global _counter
    _counter += 1
    return f"PT-{datetime.now().year}-{_counter:04d}"

def resolve(raw):
    """Accepts 'PT-2026-0003', 'pt-2026-0003' or just '3'."""
    raw = raw.strip().upper()
    if raw.isdigit():
        raw = f"PT-{datetime.now().year}-{int(raw):04d}"
    return raw if raw in records else None

def err(msg, code=400, **extra): return jsonify({"error": msg, **extra}), code

def clean(data, partial=False):
    out = {}
    if "name" in data or not partial:
        name = " ".join(str(data.get("name", "")).split())
        if not name: raise ValueError("Name is required.")
        if len(name) > 80: raise ValueError("Name must be 80 characters or fewer.")
        out["name"] = name
    if "age" in data or not partial:
        try: age = int(data.get("age"))
        except (TypeError, ValueError): raise ValueError("Age must be a number.")
        if not 0 <= age <= 130: raise ValueError("Age must be between 0 and 130.")
        out["age"] = age
    if "gender" in data or not partial:
        g = str(data.get("gender", "")).strip()
        if g not in ("Female", "Male", "Other"): raise ValueError("Choose a gender.")
        out["gender"] = g
    if "urgency" in data or not partial:
        try: u = int(data.get("urgency"))
        except (TypeError, ValueError): raise ValueError("Urgency must be 1-5.")
        if u not in URGENCY: raise ValueError("Urgency must be 1-5.")
        out["urgency"] = u
    if "notes" in data:
        out["notes"] = str(data.get("notes", "")).strip()[:500]
    return out

def label(u): return f"{u} · {URGENCY[u]}"

def view(pid, rank=None):
    r = records[pid]
    if rank is None:
        rank = heap.ranked_ids().index(pid) + 1
    return {"id": pid, "name": r["name"], "age": r["age"], "gender": r["gender"],
            "urgency": r["urgency"], "urgency_label": URGENCY[r["urgency"]],
            "notes": r.get("notes", ""), "arrived_at": r["arrived_at"],
            "history": r["history"], "rank": rank, "queue_size": len(heap)}

def others(key, me=None):
    """Another patient sharing this key, if any."""
    return next((p for p in by_key.get(key, ()) if p != me), None)

def conflict(pid):
    return err("A patient with the same name, age and gender is already registered.",
               409, duplicate=view(pid))

# ---- Pages ----
@app.get("/")
def index(): return render_template("index.html")

@app.get("/patient/<pid>")
def profile(pid): return render_template("profile.html", pid=pid)

# ---- API ----
@app.post("/api/patients")
def add_patient():
    global _seq
    data = request.get_json(force=True, silent=True) or {}
    try: d = clean(data)
    except ValueError as e: return err(str(e))
    dup = others(dup_key(d))
    if dup and not data.get("force"):
        return conflict(dup)
    pid, _seq = new_id(), _seq + 1
    d.setdefault("notes", "")
    t = now()
    records[pid] = {**d, "seq": _seq, "arrived_at": t,
                    "history": [{"t": t, "text": f"Registered with urgency {label(d['urgency'])}"}]}
    by_key.setdefault(dup_key(d), set()).add(pid)
    heap.push(pid, d["urgency"], _seq)
    return jsonify(view(pid)), 201

@app.get("/api/patients/<pid>")
def get_patient(pid):
    pid = resolve(pid)
    if not pid: return err("No patient with that ID.", 404)
    return jsonify(view(pid))

@app.put("/api/patients/<pid>")
def update_patient(pid):
    pid = resolve(pid)
    if not pid: return err("No patient with that ID.", 404)
    data = request.get_json(force=True, silent=True) or {}
    try: d = clean(data, partial=True)
    except ValueError as e: return err(str(e))
    cur = records[pid]
    new_key = dup_key({**cur, **d})
    dup = others(new_key, pid) if new_key != dup_key(cur) else None
    if dup and not data.get("force"):
        return conflict(dup)
    t = now()
    if "urgency" in d and d["urgency"] != cur["urgency"]:
        cur["history"].append({"t": t, "text": f"Urgency changed from {label(cur['urgency'])} to {label(d['urgency'])}"})
        heap.update_urgency(pid, d["urgency"])
    changed = [k for k in ("name", "age", "gender", "notes") if k in d and d[k] != cur.get(k)]
    if changed:
        cur["history"].append({"t": t, "text": "Updated " + ", ".join(changed)})
    old_key = dup_key(cur)
    cur.update(d)
    unindex(old_key, pid)
    by_key.setdefault(dup_key(cur), set()).add(pid)
    return jsonify(view(pid))

@app.delete("/api/patients/<pid>")
def remove_patient(pid):
    pid = resolve(pid)
    if not pid: return err("No patient with that ID.", 404)
    drop(pid)
    return jsonify({"removed": pid})

def unindex(key, pid):
    by_key[key].discard(pid)
    if not by_key[key]: del by_key[key]

def drop(pid):
    unindex(dup_key(records[pid]), pid)
    heap.remove(pid)
    del records[pid]

@app.get("/api/queue")
def queue():
    return jsonify([view(pid, i + 1) for i, pid in enumerate(heap.ranked_ids())])

@app.post("/api/queue/next")
def call_next():
    if not len(heap): return err("The queue is empty.", 404)
    pid = heap.peek()
    p = view(pid, 1)
    drop(pid)
    return jsonify(p)

if __name__ == "__main__":
    app.run(debug=True)
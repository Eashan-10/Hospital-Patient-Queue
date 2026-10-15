"""Indexed max-heap: O(log n) insert / extract-max / update / remove, O(1) lookup."""

class PatientHeap:
    def __init__(self):
        self.a = []      # list of (urgency, arrival_seq, patient_id)
        self.pos = {}    # patient_id -> index in self.a (hash map)

    # higher urgency wins; on ties the smaller arrival_seq (earlier) wins
    @staticmethod
    def _better(x, y):
        return x[0] > y[0] or (x[0] == y[0] and x[1] < y[1])

    def _swap(self, i, j):
        a = self.a
        a[i], a[j] = a[j], a[i]
        self.pos[a[i][2]] = i
        self.pos[a[j][2]] = j

    def _sift_up(self, i):
        while i > 0:
            p = (i - 1) // 2
            if self._better(self.a[i], self.a[p]):
                self._swap(i, p)
                i = p
            else:
                break

    def _sift_down(self, i):
        n = len(self.a)
        while True:
            best, l, r = i, 2 * i + 1, 2 * i + 2
            if l < n and self._better(self.a[l], self.a[best]): best = l
            if r < n and self._better(self.a[r], self.a[best]): best = r
            if best == i:
                return
            self._swap(i, best)
            i = best

    def __len__(self): return len(self.a)
    def __contains__(self, pid): return pid in self.pos

    def push(self, pid, urgency, seq):
        self.a.append((urgency, seq, pid))
        self.pos[pid] = len(self.a) - 1
        self._sift_up(len(self.a) - 1)

    def peek(self):
        return self.a[0][2] if self.a else None

    def extract_max(self):
        return self.remove(self.a[0][2]) if self.a else None

    def remove(self, pid):
        i = self.pos[pid]
        last = len(self.a) - 1
        if i != last:
            self._swap(i, last)
        item = self.a.pop()
        del self.pos[pid]
        if i < len(self.a):
            self._sift_up(i)
            self._sift_down(i)
        return item[2]

    def update_urgency(self, pid, urgency):
        i = self.pos[pid]
        _, seq, _ = self.a[i]
        self.a[i] = (urgency, seq, pid)
        self._sift_up(i)
        self._sift_down(self.pos[pid])

    def ranked_ids(self):
        """Full queue order without mutating the heap (sorts a copy)."""
        return [x[2] for x in sorted(self.a, key=lambda t: (-t[0], t[1]))]

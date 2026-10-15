# Ward Queue
pip install -r requirements.txt && python app.py  → open http://127.0.0.1:5000

- heap.py   : indexed max-heap (sift-up/down, extract-max, remove, update) + hash map
- app.py    : patient records (dict) + Flask API
- templates/ + static/ : frontend
Ranking: higher urgency first; ties go to the earlier arrival.

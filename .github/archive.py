import json, urllib.request
TOPIC = "cbc-elder-retreat-2026-a4f7f5368db0"
with open("archive.json") as f:
    arc = json.load(f)
seen = {m["id"] for m in arc}
req = urllib.request.Request(f"https://ntfy.sh/{TOPIC}/json?poll=1&since=all", headers={"User-Agent": "cbc-vote-archiver"})
new = 0
for line in urllib.request.urlopen(req, timeout=30).read().decode().splitlines():
    if not line.strip():
        continue
    m = json.loads(line)
    if m.get("event") == "message" and m["id"] not in seen:
        arc.append({"id": m["id"], "time": m["time"], "message": m["message"]})
        seen.add(m["id"]); new += 1
arc.sort(key=lambda m: m["time"])
with open("archive.json", "w") as f:
    json.dump(arc, f, indent=0)
print("new messages:", new, "total:", len(arc))

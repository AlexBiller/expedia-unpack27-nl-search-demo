#!/usr/bin/env python3
"""Bundle the static app + seeded data into one self-contained file: standalone.html.

Used for hosts that serve a single HTML page (e.g. htmlpreview.github.io). Run after seed.py.
"""
import json
from pathlib import Path

root = Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "styles.css").read_text()
data = {"listings": json.loads((root / "data/listings.json").read_text()),
        "evalSet": json.loads((root / "data/eval_set.json").read_text())}
safe = lambda s: s.replace("</script", "<\\/script")
inline_js = ("<script>window.SEED_DATA = " + safe(json.dumps(data, separators=(",", ":"))) + ";</script>\n"
             "<script>" + safe((root / "engine.js").read_text()) + "</script>\n"
             "<script>" + safe((root / "app.js").read_text()) + "</script>")
html = html.replace('<link rel="stylesheet" href="styles.css" />', "<style>" + css + "</style>")
html = html.replace('<script src="engine.js"></script>\n  <script src="app.js"></script>', inline_js)
assert "SEED_DATA" in html and "<style>" in html
(root / "standalone.html").write_text(html)
print("wrote standalone.html", len(html) // 1024, "KB")

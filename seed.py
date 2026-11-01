#!/usr/bin/env python3
"""Seed script for the unofficial demo (synthetic data only).

Generates fictional vacation-rental listings (with reviews) and a labeled
evaluation set. Every record is invented; no real properties, hosts, guests or
customer data are used. Output is deterministic for a given --seed.

Usage:
    python3 seed.py            # writes data/listings.json and data/eval_set.json
    python3 seed.py --seed 7   # different (still deterministic) dataset
"""
import argparse
import json
import math
import random
from pathlib import Path

DESTINATIONS = [
    # name, state, scenes, base nightly price
    ("Lake Tahoe", "CA", ["lake", "mountain", "ski"], 260),
    ("Outer Banks", "NC", ["beach"], 210),
    ("Gulf Shores", "AL", ["beach"], 150),
    ("Gatlinburg", "TN", ["mountain"], 150),
    ("Scottsdale", "AZ", ["desert"], 190),
    ("Breckenridge", "CO", ["mountain", "ski"], 280),
    ("Cape Cod", "MA", ["beach"], 240),
    ("Fredericksburg", "TX", ["countryside"], 150),
    ("Kissimmee", "FL", ["theme parks"], 140),
    ("Door County", "WI", ["lake"], 160),
    ("Joshua Tree", "CA", ["desert"], 150),
    ("Hilton Head", "SC", ["beach"], 220),
]
LISTINGS_PER_DESTINATION = 12

TYPES_BY_SCENE = {
    "beach": ["beach house", "condo", "cottage"],
    "mountain": ["cabin", "chalet", "lodge"],
    "ski": ["condo", "chalet", "cabin"],
    "lake": ["cabin", "cottage", "lake house"],
    "desert": ["casita", "villa", "modern home"],
    "theme parks": ["villa", "townhome", "condo"],
    "countryside": ["farmhouse", "cottage", "guesthouse"],
}

TITLE_ADJ = ["Driftwood", "Saltwind", "Juniper", "Cedar", "Aspen", "Bluebird", "Copper", "Sandpiper",
             "Willow", "Granite", "Starlight", "Harbor", "Pinecone", "Sagebrush", "Lantern", "Marigold",
             "Foxglove", "Heron", "Tamarack", "Mesquite", "Bramble", "Larkspur", "Ember", "Seaglass"]
TITLE_NOUN = ["Cove", "Ridge", "Hollow", "Point", "Retreat", "Hideaway", "Landing", "Haven", "Lookout",
              "Nest", "Bend", "Grove", "Hearth", "Perch"]

FIRST_NAMES = ["Avery", "Jordan", "Priya", "Mateo", "Hannah", "Kenji", "Lucia", "Omar", "Grace", "Theo",
               "Nadia", "Ellis", "Sofia", "Marcus", "Ingrid", "Ravi", "Chloe", "Dmitri", "Amara", "Felix"]

VIBES = ["quiet", "kid-friendly", "romantic"]
VIBE_REVIEWS = {
    "quiet": ["So peaceful and quiet at night - we could hear the wind in the trees.",
              "Secluded and private; we barely saw another car all weekend.",
              "A tranquil, quiet escape from city life."],
    "kid-friendly": ["Our kids loved it - plenty of space for them to play.",
                     "Great for families with little ones; the host left board games.",
                     "The children had a blast and never wanted to leave."],
    "romantic": ["Perfect for a romantic getaway - we celebrated our anniversary here.",
                 "Cozy and romantic; ideal for a couple's escape.",
                 "We spent our honeymoon here and it was magical."],
}
GENERIC_REVIEWS = ["Spotless and exactly as pictured.",
                   "Check-in was easy and the host was responsive.",
                   "Beds were comfortable and the kitchen had everything we needed.",
                   "Great location for exploring the area.",
                   "Would happily book again.",
                   "The photos don't do the view justice.",
                   "A few dated fixtures but overall a great stay.",
                   "Plenty of parking and easy access."]
AMENITY_REVIEWS = {"hot tub": "The hot tub was the highlight of the trip.",
                   "pool": "We spent every afternoon in the pool.",
                   "fireplace": "Evenings by the fireplace were the best part.",
                   "game room": "The game room kept everyone entertained.",
                   "workspace": "The desk setup made working remotely easy."}
NOISE_REVIEW = "Lively area - expect some street noise on weekends."

TAG_SENTENCES = {"beachfront": "Beachfront - walk straight from the deck onto the sand.",
                 "ocean view": "Wake up to ocean views from the main bedroom.",
                 "lakefront": "Lakefront lot with its own stretch of shoreline.",
                 "ski-in/ski-out": "Ski-in/ski-out access to the nearest lift.",
                 "mountain view": "Big windows frame the mountain views.",
                 "walkable": "Walkable to shops and restaurants in town."}

# Evaluation queries: natural-language text + ground-truth spec. Relevant ids are
# computed from the hidden ground truth below (including "vibes", which never
# appear as structured fields - only implicitly via review text).
EVAL = [
    ("Pet-friendly cabin in Gatlinburg with a hot tub",
     dict(destination="Gatlinburg", types=["cabin"], pets=True, amenities=["hot tub"]), ["multi-constraint"]),
    ("Beach house in the Outer Banks that sleeps 10 with a pool",
     dict(destination="Outer Banks", types=["beach house"], min_sleeps=10, amenities=["pool"]), ["numeric", "multi-constraint"]),
    ("Somewhere in Tahoe for 8 people under $500 a night",
     dict(destination="Lake Tahoe", min_sleeps=8, max_price=500), ["numeric"]),
    ("Dog friendly place on Cape Cod",
     dict(destination="Cape Cod", pets=True), ["paraphrase"]),
    ("Ski-in ski-out condo in Breckenridge with a jacuzzi",
     dict(destination="Breckenridge", types=["condo"], tags=["ski-in/ski-out"], amenities=["hot tub"]), ["paraphrase", "multi-constraint"]),
    ("Quiet desert getaway in Joshua Tree",
     dict(destination="Joshua Tree", vibes=["quiet"]), ["review-vibe"]),
    ("Family of 6 near the theme parks with a pool and game room",
     dict(destination="Kissimmee", min_sleeps=6, amenities=["pool", "game room"]), ["paraphrase", "numeric"]),
    ("Lakefront cottage in Door County with kayaks",
     dict(destination="Door County", types=["cottage"], tags=["lakefront"], amenities=["kayaks"]), ["multi-constraint"]),
    ("Romantic cabin with a fireplace in the Smokies",
     dict(destination="Gatlinburg", types=["cabin"], amenities=["fireplace"], vibes=["romantic"]), ["paraphrase", "review-vibe"]),
    ("3 bedroom beachfront in Gulf Shores under $400",
     dict(destination="Gulf Shores", min_bedrooms=3, tags=["beachfront"], max_price=400), ["numeric"]),
    ("Remote work friendly rental in Scottsdale with a pool",
     dict(destination="Scottsdale", amenities=["workspace", "pool"]), ["paraphrase"]),
    ("Oceanfront condo in Hilton Head that allows dogs",
     dict(destination="Hilton Head", types=["condo"], tags=["beachfront"], pets=True), ["paraphrase", "multi-constraint"]),
    ("Fredericksburg farmhouse for a group of 12",
     dict(destination="Fredericksburg", types=["farmhouse"], min_sleeps=12), ["paraphrase", "numeric"]),
    ("Kid-friendly Tahoe cabin with a hot tub",
     dict(destination="Lake Tahoe", types=["cabin"], amenities=["hot tub"], vibes=["kid-friendly"]), ["review-vibe"]),
    ("Cheap beach stay in Gulf Shores for 4",
     dict(destination="Gulf Shores", min_sleeps=4, max_price=200), ["paraphrase", "numeric"]),
    ("EV charging and a fireplace in Breckenridge",
     dict(destination="Breckenridge", amenities=["ev charger", "fireplace"]), ["paraphrase"]),
    ("Lake house in Lake Tahoe with a dock that sleeps 12",
     dict(destination="Lake Tahoe", types=["lake house"], amenities=["dock"], min_sleeps=12), ["numeric", "multi-constraint"]),
    ("Walkable Cape Cod cottage with a washer",
     dict(destination="Cape Cod", types=["cottage"], tags=["walkable"], amenities=["washer"]), ["multi-constraint"]),
    ("Two couples in Scottsdale, want a hot tub and pool",
     dict(destination="Scottsdale", min_sleeps=4, amenities=["hot tub", "pool"]), ["paraphrase", "numeric"]),
    ("OBX pet friendly with ocean view under $350",
     dict(destination="Outer Banks", pets=True, tags=["ocean view"], max_price=350), ["paraphrase", "numeric"]),
    ("Secluded mountain cabin in Gatlinburg for a peaceful weekend",
     dict(destination="Gatlinburg", types=["cabin"], vibes=["quiet"]), ["review-vibe", "paraphrase"]),
    ("5-bedroom place in Kissimmee with a pool, budget $350 per night",
     dict(destination="Kissimmee", min_bedrooms=5, amenities=["pool"], max_price=350), ["numeric", "paraphrase"]),
    ("Door County cabin with a sauna and fireplace",
     dict(destination="Door County", types=["cabin"], amenities=["sauna", "fireplace"]), ["multi-constraint"]),
    ("Joshua Tree casita for a romantic anniversary with a hot tub",
     dict(destination="Joshua Tree", types=["casita"], amenities=["hot tub"], vibes=["romantic"]), ["review-vibe"]),
    # Known-hard cases the prototype parser does not handle (negation, open-ended numeric phrasing).
    ("A cabin anywhere except Gatlinburg with a hot tub and fireplace",
     dict(not_destination="Gatlinburg", types=["cabin"], amenities=["hot tub", "fireplace"]), ["negation", "known-hard"]),
    ("Sleeps at least 10, no more than $400 a night, any destination",
     dict(min_sleeps=10, max_price=400), ["numeric", "known-hard"]),
]


def round5(x):
    return int(5 * round(x / 5))


def amenity_probs(scenes):
    p = {"wifi": .95, "kitchen": .95, "washer": .7, "grill": .55, "pool": .12, "hot tub": .25,
         "fireplace": .2, "ev charger": .18, "workspace": .35, "game room": .25, "sauna": .06,
         "dock": 0.0, "kayaks": 0.0}
    if "beach" in scenes:
        p.update({"pool": .4, "kayaks": .12})
    if "desert" in scenes or "theme parks" in scenes:
        p.update({"pool": .75, "hot tub": .45, "fireplace": .1})
    if "theme parks" in scenes:
        p.update({"game room": .55})
    if "mountain" in scenes or "ski" in scenes:
        p.update({"hot tub": .6, "fireplace": .7, "sauna": .12})
    if "lake" in scenes:
        p.update({"dock": .45, "kayaks": .35, "fireplace": max(p["fireplace"], .5)})
    return p


def tag_probs(scenes):
    p = {"walkable": .1 if "theme parks" in scenes else .25}
    if "beach" in scenes:
        p.update({"beachfront": .35, "ocean view": .5})
    if "lake" in scenes:
        p["lakefront"] = .45
    if "ski" in scenes:
        p["ski-in/ski-out"] = .35
    if "mountain" in scenes:
        p["mountain view"] = .6
    if "desert" in scenes:
        p["mountain view"] = .3
    return p


def compute_price(rng, base, L):
    price = base * (0.6 + 0.28 * L["bedrooms"])
    price += 45 * ("pool" in L["amenities"]) + 35 * ("hot tub" in L["amenities"])
    price += 60 * any(t in L["tags"] for t in ("beachfront", "lakefront", "ski-in/ski-out"))
    return max(85, round5(price * rng.uniform(0.85, 1.15)))


def satisfies(spec, L):
    if "destination" in spec and L["destination"] != spec["destination"]:
        return False
    if "not_destination" in spec and L["destination"] == spec["not_destination"]:
        return False
    if "types" in spec and L["type"] not in spec["types"]:
        return False
    if spec.get("pets") and not L["pet_friendly"]:
        return False
    if L["sleeps"] < spec.get("min_sleeps", 0) or L["bedrooms"] < spec.get("min_bedrooms", 0):
        return False
    if L["nightly_price"] > spec.get("max_price", math.inf):
        return False
    if not all(a in L["amenities"] for a in spec.get("amenities", [])):
        return False
    if not all(t in L["tags"] for t in spec.get("tags", [])):
        return False
    return all(v in L["_vibes"] for v in spec.get("vibes", []))


def plant(rng, spec, L, base):
    """Edit a listing so it satisfies `spec` (guarantees every eval query has answers)."""
    if "types" in spec:
        L["type"] = spec["types"][0]
    if spec.get("pets"):
        L["pet_friendly"] = True
    beds = max(L["bedrooms"], spec.get("min_bedrooms", 0), math.ceil(spec.get("min_sleeps", 0) / 2))
    L["bedrooms"] = beds
    L["sleeps"] = max(L["sleeps"], beds * 2, spec.get("min_sleeps", 0))
    L["bathrooms"] = max(L["bathrooms"], math.ceil(beds / 2))
    for a in spec.get("amenities", []):
        if a not in L["amenities"]:
            L["amenities"].append(a)
    for t in spec.get("tags", []):
        if t not in L["tags"]:
            L["tags"].append(t)
    for v in spec.get("vibes", []):
        if v not in L["_vibes"]:
            L["_vibes"].append(v)
    if "quiet" in L["_vibes"] and "walkable" in L["tags"]:
        L["tags"].remove("walkable")
    L["nightly_price"] = compute_price(rng, base, L)
    if L["nightly_price"] > spec.get("max_price", math.inf):
        L["nightly_price"] = round5(spec["max_price"] - rng.uniform(10, 60))


def render_text(rng, L):
    article = "An" if L["type"][0] in "aeiou" else "A"
    parts = [f"{article} {L['bedrooms']}-bedroom {L['type']} in {L['destination']}, {L['state']} that sleeps {L['sleeps']}."]
    parts += [TAG_SENTENCES[t] for t in L["tags"]]
    parts.append(rng.choice(["Recently refreshed interiors throughout.", "Thoughtfully furnished with local art.",
                             "Open-plan living area with plenty of natural light.", "Comfortable, well-kept and easy to settle into."]))
    extras = [a for a in L["amenities"] if a not in ("wifi", "kitchen")]
    if extras:
        parts.append("Amenities: " + ", ".join(extras) + ", plus wifi and a full kitchen.")
    parts.append("Pets welcome (fee applies)." if L["pet_friendly"] else "Sorry, no pets.")
    L["description"] = " ".join(parts)

    texts = [rng.choice(VIBE_REVIEWS[v]) for v in L["_vibes"]]
    highlight = [a for a in L["amenities"] if a in AMENITY_REVIEWS]
    if highlight and len(texts) < 3:
        texts.append(AMENITY_REVIEWS[rng.choice(highlight)])
    if "walkable" in L["tags"] and "quiet" not in L["_vibes"] and len(texts) < 3 and rng.random() < .5:
        texts.append(NOISE_REVIEW)
    pool = [g for g in GENERIC_REVIEWS]
    rng.shuffle(pool)
    while len(texts) < 3:
        texts.append(pool.pop())
    rng.shuffle(texts)
    L["reviews"] = [{
        "id": f"{L['id']}-R{i + 1}",
        "author": f"{rng.choice(FIRST_NAMES)} {chr(65 + rng.randrange(26))}.",
        "date": f"2026-{rng.randint(1, 9):02d}-{rng.randint(1, 28):02d}",
        "rating": rng.choice([4, 5, 5, 5]) if L["rating"] >= 4.5 else rng.choice([3, 4, 4, 5]),
        "text": t,
    } for i, t in enumerate(texts)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=2027)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data"))
    args = ap.parse_args()
    rng = random.Random(args.seed)

    listings, used_titles, base_of = [], set(), {}
    n = 1001
    for dest, state, scenes, base in DESTINATIONS:
        types = sorted({t for s in scenes for t in TYPES_BY_SCENE[s]})
        ap_, tp = amenity_probs(scenes), tag_probs(scenes)
        for _ in range(LISTINGS_PER_DESTINATION):
            beds = rng.choices(range(1, 9), weights=[10, 20, 25, 20, 12, 8, 3, 2])[0]
            L = {
                "id": f"VR-{n}", "title": "", "destination": dest, "state": state, "scenes": scenes,
                "type": rng.choice(types), "bedrooms": beds, "bathrooms": max(1, beds - rng.choice([0, 1, 1])),
                "sleeps": beds * 2 + rng.choice([0, 0, 1, 2]), "nightly_price": 0,
                "pet_friendly": rng.random() < .35,
                "amenities": [a for a, p in ap_.items() if rng.random() < p],
                "tags": [t for t, p in tp.items() if rng.random() < p],
                "rating": round(rng.uniform(3.9, 5.0), 1), "review_count": rng.randint(5, 240),
            }
            walk = "walkable" in L["tags"]
            vib = {"quiet": .1 if walk else (.45 if {"desert", "mountain"} & set(scenes) else .3),
                   "kid-friendly": .25 + .2 * bool({"pool", "game room"} & set(L["amenities"])) + .1 * (beds >= 3),
                   "romantic": .3 if beds <= 2 else .05}
            L["_vibes"] = [v for v in VIBES if rng.random() < vib[v]]
            L["nightly_price"] = compute_price(rng, base, L)
            base_of[L["id"]] = base
            listings.append(L)
            n += 1

    # Guarantee at least two answers per (answerable) eval query by planting attributes.
    locked = set()
    for _, spec, _ in EVAL:
        rel = [L for L in listings if satisfies(spec, L)]
        cands = [L for L in listings if L["id"] not in locked and L["destination"] != spec.get("not_destination")
                 and ("destination" not in spec or L["destination"] == spec["destination"])]
        rng.shuffle(cands)
        while len(rel) < 2 and cands:
            L = cands.pop()
            plant(rng, spec, L, base_of[L["id"]])
            locked.add(L["id"])
            rel = [x for x in listings if satisfies(spec, x)]
        locked.update(x["id"] for x in rel)

    for L in listings:
        L["amenities"].sort()
        L["tags"].sort()
        adj, noun = rng.choice(TITLE_ADJ), rng.choice(TITLE_NOUN)
        while (adj, noun) in used_titles:
            adj, noun = rng.choice(TITLE_ADJ), rng.choice(TITLE_NOUN)
        used_titles.add((adj, noun))
        L["title"] = f"{adj} {noun} {L['type'].title()}"
        render_text(rng, L)

    queries = []
    for i, (text, spec, tags) in enumerate(EVAL, 1):
        rel = sorted(L["id"] for L in listings if satisfies(spec, L))
        assert rel, f"eval query has no relevant listings: {text}"
        queries.append({"id": f"Q{i:02d}", "query": text, "tags": tags, "gold": spec, "relevant_ids": rel})

    public = [{k: v for k, v in L.items() if not k.startswith("_")} for L in listings]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = {"seed": args.seed, "synthetic": True,
            "notice": "Unofficial demo built with Devin - synthetic data. All records are fictional."}
    (out / "listings.json").write_text(json.dumps({**meta, "listings": public}, indent=1) + "\n")
    (out / "eval_set.json").write_text(json.dumps({**meta, "queries": queries}, indent=1) + "\n")
    print(f"wrote {len(public)} listings and {len(queries)} eval queries to {out}/")
    for q in queries:
        print(f"  {q['id']} rel={len(q['relevant_ids']):3d}  {q['query']}")


if __name__ == "__main__":
    main()

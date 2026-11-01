/* Search + evaluation engine for the unofficial demo (synthetic data only).
 * Runs fully client-side and deterministically: a rule-based natural-language
 * parser stands in for an LLM query-understanding step so every decision is
 * inspectable and the demo needs no paid services. */
(function (root) {
  "use strict";

  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, fourteen: 14, sixteen: 16 };
  const NUM = "(\\d+|" + Object.keys(NUM_WORDS).join("|") + ")";
  const toNum = (s) => (/^\d+$/.test(s) ? parseInt(s, 10) : NUM_WORDS[s.toLowerCase()]);
  const rx = (src) => new RegExp(src, "i");

  const PRESETS = {
    baseline: { id: "baseline", label: "A · Keyword baseline", short: "A", parser: false, synonyms: false, reviewEvidence: false,
      blurb: "TF-IDF keyword match over listing text. No query understanding." },
    "nl-strict": { id: "nl-strict", label: "B · NL parser, canonical terms", short: "B", parser: true, synonyms: false, reviewEvidence: false,
      blurb: "Parses the query into hard filters + soft preferences, but only recognizes canonical vocabulary." },
    "nl-full": { id: "nl-full", label: "C · NL parser + synonyms + review evidence", short: "C", parser: true, synonyms: true, reviewEvidence: true,
      blurb: "Adds paraphrase/synonym understanding and grounds 'vibe' requests (quiet, romantic, kid-friendly) in guest reviews." },
  };

  // Lexicon: canonical surface forms are always understood; synonyms only when cfg.synonyms is on.
  const DESTINATIONS = [
    ["Lake Tahoe", ["lake tahoe", "tahoe"], ["south lake"]],
    ["Outer Banks", ["outer banks"], ["obx"]],
    ["Gulf Shores", ["gulf shores"], ["alabama gulf coast"]],
    ["Gatlinburg", ["gatlinburg"], ["smokies", "smoky mountains"]],
    ["Scottsdale", ["scottsdale"], ["phoenix area"]],
    ["Breckenridge", ["breckenridge"], ["breck"]],
    ["Cape Cod", ["cape cod"], ["the cape"]],
    ["Fredericksburg", ["fredericksburg"], ["hill country"]],
    ["Kissimmee", ["kissimmee"], ["theme parks", "orlando", "disney"]],
    ["Door County", ["door county"], []],
    ["Joshua Tree", ["joshua tree"], ["high desert"]],
    ["Hilton Head", ["hilton head"], ["lowcountry"]],
  ];
  const SCENES = [["beach", ["beach"], ["coast", "seaside", "ocean"]], ["mountain", ["mountain", "mountains"], ["the hills"]],
    ["lake", ["lake"], []], ["desert", ["desert"], []], ["ski", ["ski"], ["slopes"]]];
  const TYPES = [["cabin", ["cabin"], ["log home"]], ["chalet", ["chalet"], []], ["lodge", ["lodge"], []],
    ["condo", ["condo"], ["apartment", "flat"]], ["beach house", ["beach house"], []], ["cottage", ["cottage"], []],
    ["lake house", ["lake house"], []], ["casita", ["casita"], []], ["villa", ["villa"], []], ["modern home", ["modern home"], []],
    ["townhome", ["townhome"], ["townhouse"]], ["farmhouse", ["farmhouse"], ["ranch house"]], ["guesthouse", ["guesthouse"], ["guest house"]]];
  const AMENITIES = [["pool", [/\bpools?\b(?!\s*table)/i], ["swimming"]], ["hot tub", ["hot tub"], ["jacuzzi", "spa tub", "hottub"]],
    ["fireplace", ["fireplace"], ["wood stove", "fire pit"]], ["ev charger", ["ev charger"], ["ev charging", "charging station", "electric car", "tesla"]],
    ["workspace", ["workspace"], ["remote work", "work from", "home office", "desk"]], ["game room", ["game room"], ["arcade", "rec room"]],
    ["washer", ["washer"], ["laundry", "washing machine"]], ["grill", ["grill"], ["bbq", "barbecue"]], ["dock", ["dock"], ["boat slip", "pier"]],
    ["kayaks", ["kayak"], ["paddleboard", "canoe"]], ["sauna", ["sauna"], ["steam room"]], ["wifi", ["wifi"], ["wi-fi", "internet"]],
    ["kitchen", ["kitchen"], []]];
  const TAGS = [["beachfront", ["beachfront"], ["oceanfront", "on the beach", "beach access", "steps to the sand"]],
    ["ocean view", ["ocean view"], ["sea view", "views of the ocean"]], ["lakefront", ["lakefront"], ["on the lake", "lakeside", "waterfront"]],
    ["ski-in/ski-out", [/\bski[\s-]*in(?:[\s/-]*ski[\s-]*out)?\b/i], ["slopeside", "on the slopes"]],
    ["mountain view", ["mountain view"], ["views of the mountains"]], ["walkable", ["walkable"], ["walk to town", "walking distance", "downtown"]]];
  const VIBES = [["quiet", ["quiet"], ["secluded", "peaceful", "tranquil", "private"]],
    ["kid-friendly", ["kid-friendly", "kid friendly"], ["kids", "family", "families", "children"]],
    ["romantic", ["romantic"], ["anniversary", "honeymoon", "couples getaway", "couple's"]]];
  const VIBE_EVIDENCE = { quiet: /\b(quiet|peaceful|secluded|tranquil|private)\b/i,
    "kid-friendly": /\b(kids?|families|family|little ones|children)\b/i, romantic: /\b(romantic|anniversary|honeymoon|couple's)\b/i };

  const WEIGHTS = { type: 1.5, amenity: 3, tag: 2.5, vibe: 2.5 };
  const KIND_LABEL = { destination: "Destination", scene: "Setting", guests: "Guests", bedrooms: "Bedrooms", price: "Max price",
    pets: "Pets", type: "Property type", amenity: "Amenity", tag: "Feature", vibe: "Vibe (from reviews)" };

  function phraseRe(p) {
    if (p instanceof RegExp) return new RegExp(p.source, "i");
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
    return new RegExp("\\b" + esc + "(?:s|es)?\\b", "i");
  }
  function findPhrase(q, patterns) {
    for (const p of patterns) {
      const m = phraseRe(p).exec(q);
      if (m) return { start: m.index, end: m.index + m[0].length, text: m[0] };
    }
    return null;
  }

  // ---------- Query understanding ----------
  function parse(query, cfg) {
    const q = query;
    const constraints = [];
    const seen = new Set();
    const add = (c) => {
      const key = c.kind + ":" + c.value;
      if (seen.has(key)) return;
      seen.add(key);
      constraints.push(c);
    };
    const lex = (entries, kind, hard) => {
      for (const [value, canon, syn] of entries) {
        let span = findPhrase(q, canon), via = "canonical";
        if (!span && cfg.synonyms && syn.length) { span = findPhrase(q, syn); via = "synonym"; }
        if (span) add({ kind, value, hard, weight: WEIGHTS[kind] || 0, span, via });
      }
    };
    const firstMatch = (patterns) => {
      for (const [re, fn] of patterns) {
        const m = rx(re).exec(q);
        if (m) return { value: fn(m), span: { start: m.index, end: m.index + m[0].length, text: m[0] } };
      }
      return null;
    };

    lex(DESTINATIONS, "destination", true);
    if (!constraints.some((c) => c.kind === "destination")) lex(SCENES, "scene", true);

    const guestCanon = [["\\bsleeps\\s+" + NUM + "\\b", (m) => toNum(m[1])],
      ["\\b" + NUM + "\\s+(?:people|guests|adults|persons|travelers)\\b", (m) => toNum(m[1])],
      ["\\bfor\\s+" + NUM + "\\b(?!\\s*(?:\\$|dollars|bucks|/|per|a night|nights?))", (m) => toNum(m[1])]];
    const guestSyn = [["\\b(?:family|group|party|crew) of\\s+" + NUM + "\\b", (m) => toNum(m[1])],
      ["\\b" + NUM + "\\s+couples\\b", (m) => 2 * toNum(m[1])], ["\\bfor a couple\\b", () => 2]];
    let g = firstMatch(guestCanon), gVia = "canonical";
    if (!g && cfg.synonyms) { g = firstMatch(guestSyn); gVia = "synonym"; }
    if (g) add({ kind: "guests", value: g.value, hard: true, span: g.span, via: gVia });

    let b = firstMatch([["\\b" + NUM + "[\\s-]*bedrooms?\\b", (m) => toNum(m[1])]]), bVia = "canonical";
    if (!b && cfg.synonyms) { b = firstMatch([["\\b" + NUM + "[\\s-]*(?:br|bdrm|bed)s?\\b", (m) => toNum(m[1])]]); bVia = "synonym"; }
    if (b) add({ kind: "bedrooms", value: b.value, hard: true, span: b.span, via: bVia });

    let p = firstMatch([["\\b(?:under|below|less than|max(?:imum)?|up to|at most)\\s*\\$?\\s*(\\d+)", (m) => +m[1]]]), pVia = "canonical";
    if (!p && cfg.synonyms) {
      p = firstMatch([["\\bbudget(?:\\s+of|\\s+is|:)?\\s*\\$?\\s*(\\d+)", (m) => +m[1]],
        ["\\$\\s*(\\d+)\\s*(?:/|per|a)\\s*night", (m) => +m[1]], ["\\b(?:cheap|affordable|inexpensive)\\b", () => 200]]);
      pVia = "synonym";
    }
    if (p) add({ kind: "price", value: p.value, hard: true, span: p.span, via: pVia });

    let pet = firstMatch([["\\bpet[\\s-]*friendly\\b", () => true], ["(?<!no\\s)\\bpets?\\b", () => true]]), petVia = "canonical";
    if (!pet && cfg.synonyms) { pet = firstMatch([["\\b(?:dogs?|pup(?:py|pies|s)?|cats?)\\b", () => true]]); petVia = "synonym"; }
    if (pet) add({ kind: "pets", value: true, hard: true, span: pet.span, via: petVia });

    lex(TYPES, "type", false);
    lex(AMENITIES, "amenity", false);
    lex(TAGS, "tag", false);
    const before = constraints.length;
    lex(VIBES, "vibe", false);
    for (const c of constraints.slice(before)) {
      if (!cfg.reviewEvidence) { c.ignored = true; c.ignoredReason = "review evidence disabled in this configuration"; }
    }

    // Words the parser did not account for (shown for transparency).
    const covered = new Array(q.length).fill(false);
    for (const c of constraints) for (let i = c.span.start; i < c.span.end; i++) covered[i] = true;
    const unrecognized = [];
    const wordRe = /[A-Za-z$][A-Za-z0-9$'-]*|\d+/g;
    let m;
    while ((m = wordRe.exec(q))) {
      if (!covered[m.index] && !STOP.has(m[0].toLowerCase())) unrecognized.push(m[0]);
    }
    return { constraints, unrecognized };
  }

  function check(c, L) {
    const ev = (field, value, ok) => [{ field, value, ok }];
    switch (c.kind) {
      case "destination": return { ok: L.destination === c.value, evidence: ev("destination", L.destination) };
      case "scene": return { ok: L.scenes.includes(c.value), evidence: ev("scenes", L.scenes.join(", ")) };
      case "guests": return { ok: L.sleeps >= c.value, evidence: ev("sleeps", L.sleeps) };
      case "bedrooms": return { ok: L.bedrooms >= c.value, evidence: ev("bedrooms", L.bedrooms) };
      case "price": return { ok: L.nightly_price <= c.value, evidence: ev("nightly_price", "$" + L.nightly_price) };
      case "pets": return { ok: L.pet_friendly === true, evidence: ev("pet_friendly", String(L.pet_friendly)) };
      case "type": return { ok: L.type === c.value, evidence: ev("type", L.type) };
      case "amenity": return { ok: L.amenities.includes(c.value), evidence: ev("amenities", L.amenities.includes(c.value) ? c.value : "(not listed)") };
      case "tag": return { ok: L.tags.includes(c.value), evidence: ev("tags", L.tags.includes(c.value) ? c.value : "(not listed)") };
      case "vibe": {
        const re = VIBE_EVIDENCE[c.value];
        const hits = L.reviews.filter((r) => re.test(r.text));
        return { ok: hits.length > 0, evidence: hits.length ? hits.map((r) => ({ field: "reviews." + r.id, value: "\u201c" + r.text + "\u201d" }))
          : [{ field: "reviews", value: "(no review mentions this)" }] };
      }
    }
    return { ok: false, evidence: [] };
  }

  function nlSearch(query, cfg, listings) {
    const parsed = parse(query, cfg);
    const active = parsed.constraints.filter((c) => !c.ignored);
    const hardKinds = [...new Set(active.filter((c) => c.hard).map((c) => c.kind))];
    const scored = [];
    for (const L of listings) {
      const checks = active.map((c) => ({ constraint: c, ...check(c, L) }));
      // Hard constraints of the same kind are OR-ed (e.g. two destinations), different kinds AND-ed.
      const hardOk = hardKinds.every((k) => checks.some((x) => x.constraint.kind === k && x.ok));
      if (!hardOk) continue;
      let score = 0;
      for (const x of checks) if (!x.constraint.hard && x.ok) score += x.constraint.weight;
      score += 0.5 * (L.rating - 4);
      scored.push({ listing: L, score, checks });
    }
    scored.sort((a, b) => b.score - a.score || b.listing.rating - a.listing.rating || a.listing.id.localeCompare(b.listing.id));
    return { parsed, totalMatches: scored.length, results: scored.slice(0, 10) };
  }

  // ---------- Keyword baseline ----------
  const STOP = new Set("a an the and or of in on at to for with that this is are be near want need some somewhere place stay rental rentals home house any anywhere our we i me my us it its from by as".split(" "));
  const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9$]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));
  const indexCache = new WeakMap();
  function buildIndex(listings) {
    if (indexCache.has(listings)) return indexCache.get(listings);
    const docs = listings.map((L) => {
      const fields = { title: L.title, destination: L.destination + " " + L.state, type: L.type, description: L.description,
        amenities: L.amenities.join(" "), tags: L.tags.join(" ") };
      for (const r of L.reviews) fields["reviews." + r.id] = r.text;
      const tf = new Map(), where = new Map();
      for (const [f, text] of Object.entries(fields)) {
        for (const t of tokenize(text)) {
          tf.set(t, (tf.get(t) || 0) + 1);
          if (!where.has(t)) where.set(t, new Set());
          where.get(t).add(f);
        }
      }
      return { L, tf, where };
    });
    const df = new Map();
    for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    const idx = { docs, df, N: docs.length };
    indexCache.set(listings, idx);
    return idx;
  }
  function keywordSearch(query, listings) {
    const idx = buildIndex(listings);
    const qt = [...new Set(tokenize(query))];
    const scored = [];
    for (const d of idx.docs) {
      let score = 0;
      const hits = [];
      for (const t of qt) {
        const tf = d.tf.get(t);
        if (!tf) continue;
        const idf = Math.log(1 + idx.N / idx.df.get(t));
        score += idf * (1 + Math.log(tf));
        hits.push({ token: t, fields: [...d.where.get(t)] });
      }
      if (score > 0) scored.push({ listing: d.L, score, tokenHits: hits });
    }
    scored.sort((a, b) => b.score - a.score || b.listing.rating - a.listing.rating || a.listing.id.localeCompare(b.listing.id));
    return { parsed: { constraints: [], unrecognized: [], tokens: qt }, totalMatches: scored.length, results: scored.slice(0, 10) };
  }

  // ---------- Grounded answer (every claim carries a citation to a record field) ----------
  function buildAnswer(res, cfg) {
    const seg = [];
    const t = (s) => seg.push({ text: s });
    const cite = (id, field, label) => seg.push({ cite: { id, field, label } });
    if (!res.results.length) {
      t("No listings satisfy every hard requirement in this query. Try relaxing a filter.");
      return seg;
    }
    if (!cfg.parser) {
      t(`Top keyword matches (${res.totalMatches} listings share at least one word with the query): `);
      res.results.slice(0, 3).forEach((r, i) => {
        if (i) t(i === 2 ? "; and " : "; ");
        t(r.listing.title + " ");
        cite(r.listing.id, r.tokenHits[0] ? r.tokenHits[0].fields[0] : "title", r.listing.id);
        t(" matched \u201c" + r.tokenHits.map((h) => h.token).join("\u201d, \u201c") + "\u201d");
      });
      t(". The baseline does not check guests, price or pet rules, so results may violate them.");
      return seg;
    }
    const top = res.results[0], L = top.listing;
    t(`${res.totalMatches} listing${res.totalMatches === 1 ? "" : "s"} pass all hard filters. Best match: `);
    t(L.title + " ");
    cite(L.id, "title", L.id);
    t(` in ${L.destination}, ${L.state}`);
    const okChecks = top.checks.filter((x) => x.ok);
    if (okChecks.length) {
      t(" \u2014 ");
      okChecks.forEach((x, i) => {
        if (i) t(", ");
        t(describe(x));
        cite(L.id, x.evidence[0].field, x.evidence[0].field.replace(/^reviews\./, ""));
      });
    }
    const missing = top.checks.filter((x) => !x.ok);
    if (missing.length) t(". Missing: " + missing.map((x) => labelOf(x.constraint)).join(", "));
    t(".");
    const alts = res.results.slice(1, 3);
    if (alts.length) {
      t(" Also consider ");
      alts.forEach((r, i) => {
        if (i) t(" or ");
        t(r.listing.title + " ");
        cite(r.listing.id, "title", r.listing.id);
        const miss = r.checks.filter((x) => !x.ok);
        t(miss.length ? ` (lacks ${miss.map((x) => labelOf(x.constraint)).join(", ")})` : " (meets every request)");
      });
      t(".");
    }
    return seg;
  }
  function labelOf(c) {
    switch (c.kind) {
      case "guests": return "sleeps " + c.value + "+";
      case "bedrooms": return c.value + "+ bedrooms";
      case "price": return "\u2264 $" + c.value + "/night";
      case "pets": return "pet-friendly";
      default: return String(c.value);
    }
  }
  function describe(x) {
    const c = x.constraint, v = x.evidence[0].value;
    switch (c.kind) {
      case "destination": case "scene": return "location matches";
      case "guests": return "sleeps " + v;
      case "bedrooms": return v + " bedrooms";
      case "price": return v + "/night";
      case "pets": return "pets allowed";
      case "type": return "a " + v;
      case "vibe": return "guests describe it as " + c.value;
      default: return "has " + c.value;
    }
  }

  function search(query, cfg, listings) {
    const res = cfg.parser ? nlSearch(query, cfg, listings) : keywordSearch(query, listings);
    res.config = cfg;
    res.answer = buildAnswer(res, cfg);
    return res;
  }

  // ---------- Evaluation ----------
  function violatesGoldHard(gold, L) {
    if (gold.destination && L.destination !== gold.destination) return true;
    if (gold.not_destination && L.destination === gold.not_destination) return true;
    if (gold.min_sleeps && L.sleeps < gold.min_sleeps) return true;
    if (gold.min_bedrooms && L.bedrooms < gold.min_bedrooms) return true;
    if (gold.max_price && L.nightly_price > gold.max_price) return true;
    if (gold.pets && !L.pet_friendly) return true;
    return false;
  }
  function evaluate(evalSet, cfg, listings) {
    const rows = evalSet.queries.map((q) => {
      const res = search(q.query, cfg, listings);
      const ids = res.results.map((r) => r.listing.id);
      const rel = new Set(q.relevant_ids);
      const top5 = res.results.slice(0, 5);
      const hits5 = top5.filter((r) => rel.has(r.listing.id)).length;
      return {
        q, res, ids, hit1: rel.has(ids[0]),
        p5: hits5 / Math.min(5, rel.size),
        r10: ids.filter((id) => rel.has(id)).length / rel.size,
        violation: top5.length ? top5.filter((r) => violatesGoldHard(q.gold, r.listing)).length / top5.length : null,
        zero: ids.length === 0,
      };
    });
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const withRes = rows.filter((r) => r.violation !== null);
    const byTag = {};
    for (const r of rows) for (const tag of r.q.tags) (byTag[tag] = byTag[tag] || []).push(r.hit1 ? 1 : 0);
    return {
      config: cfg, rows,
      summary: {
        accuracy: mean(rows.map((r) => (r.hit1 ? 1 : 0))), p5: mean(rows.map((r) => r.p5)), r10: mean(rows.map((r) => r.r10)),
        violation: mean(withRes.map((r) => r.violation)), zero: rows.filter((r) => r.zero).length, n: rows.length,
      },
      byTag: Object.fromEntries(Object.entries(byTag).map(([k, v]) => [k, { acc: mean(v), n: v.length }])),
    };
  }

  root.Engine = { PRESETS, KIND_LABEL, parse, search, evaluate, labelOf };
  if (typeof module !== "undefined") module.exports = root.Engine;
})(typeof window !== "undefined" ? window : globalThis);

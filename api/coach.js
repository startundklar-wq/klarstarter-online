const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const DEFAULT_MODELS = {
  openai: "gpt-5.2",
  gemini: "gemini-3.5-flash-lite"
};

const RED_ALERT_TERMS = [
  "suizid", "selbstmord", "ich will nicht mehr leben", "mich umbringen",
  "selbstverletzung", "ritzen", "fremdgefaehrdung", "ich halte das nicht mehr aus"
];

const SYSTEM_PROMPT = `
Du bist die Analyse-KI der Coaching-App Klarstarter.
Regeln:
1) Keine Eignungsdiagnostik ("du solltest ...").
2) Formuliere nur offen und anbietend.
3) Nutze nur Inhalte aus dem Input, nichts erfinden.
4) Wenn psychische Krise / suizidale Hinweise auftreten: red_alert=true setzen.
5) Gib nur JSON zurueck, kein Markdown.
6) Arbeite bedeutungsorientiert: Erkenne Sinnzusammenhaenge, Motive, Spannungen, Werte, Metaphern und Sprichwoerter. Uebersetze Sprichwoerter vorsichtig in moegliche Ressourcen oder Beduerfnisse.
7) Die Klarstarter-Saetze sollen mehrere vollwertige, gehaltvolle Varianten sein. Keine extrem kurzen Slogans. Jede Variante soll Koennen, Lebendigkeit, Beduerfnisse und Beitrag verbinden.
8) Erstelle genau 10 Sinnzusammenhaenge. Das sind kurze, gehaltvolle Aussagezeilen, keine Einzelwoerter. Jede Zeile verbindet mindestens zwei Aspekte aus dem Gesagten, z.B. Staerke + Wirkung, Interesse + Beduerfnis oder Bildsprache + moeglicher Beitrag.
9) Uebersetze Redewendungen sinngemaess. Beispiel: "um die Ecke denken" kann bedeuten: kreative Problemloesung, Perspektivenwechsel, Komplexitaet neu rahmen. Schreibe daraus eine Aussage wie: "Kreative Problemloesung wird zur Staerke, wenn unklare Situationen neu gerahmt werden."

JSON-Format:
{
  "clusters": {
    "koennen": ["..."],
    "lebendigkeit": ["..."],
    "resonanz_beduerfnisse": ["..."],
    "beitrag_wirksamkeit": ["..."]
  },
  "leuchtfeuer": "...",
  "meaning_summary": "Eine kurze, vorsichtige Sinnverdichtung in 4-6 Saetzen. Nahe am Gesagten bleiben.",
  "sinn_hypothesen": ["Eine moegliche Deutung koennte sein ...", "..."],
  "sinnzusammenhaenge_10": ["10 kurze Sinnzusammenhaenge als Aussagezeilen, keine Einzelwoerter"],
  "luecken_analyse": "...",
  "empfohlene_vertiefungsfrage": "...",
  "klarstarter_satz_entwuerfe": ["mehrsatzige Variante 1", "mehrsatzige Variante 2", "mehrsatzige Variante 3"],
  "red_alert": false
}
`;

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (error) { return {}; }
  }
  return req.body;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function containsRedAlert(text) {
  const normalized = normalizeText(text);
  return RED_ALERT_TERMS.some((term) => normalized.includes(normalizeText(term)));
}

function extractOpenAiText(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const fragments = [];
  if (Array.isArray(data.output)) {
    data.output.forEach((item) => {
      if (!item) return;
      if (Array.isArray(item.content)) {
        item.content.forEach((part) => {
          if (typeof part?.text === "string") fragments.push(part.text);
        });
      }
      if (typeof item?.text === "string") fragments.push(item.text);
    });
  }
  return fragments.join("\n").trim();
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseJsonFromModel(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (error) {}

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1]); } catch (error) {}
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const chunk = text.slice(start, end + 1);
    try { return JSON.parse(chunk); } catch (error) {}
  }
  return null;
}

function uniqueArray(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((item) => {
    const value = String(item || "").trim();
    if (!value) return;
    const key = normalizeText(value);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

const LOW_VALUE_CORE_TERMS = new Set([
  "kann", "gut", "denken", "ecke", "ecken", "sagen", "machen", "gehen", "kommen",
  "einfach", "dinge", "sachen", "irgendwie", "halt", "beispiel", "thema", "antwort",
  "menschen", "andere", "feststecken", "moechte", "wirksam", "indem", "staerke",
  "schwierige", "lebendig", "finde", "finden", "gebe", "geben", "gibt", "kreative",
  "vereinfache", "meiner", "meine", "meinem", "meinen", "deiner", "deine", "deinem",
  "deinen", "seiner", "seine", "seinem", "seinen", "sehe", "sehen", "arbeit", "soll"
]);

function qualityCoreTerm(term) {
  const key = normalizeText(term).replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  if (!key) return false;
  const parts = key.split(" ").filter(Boolean);
  if (parts.length === 1 && LOW_VALUE_CORE_TERMS.has(parts[0])) return false;
  if (parts.every((part) => LOW_VALUE_CORE_TERMS.has(part))) return false;
  if (parts.length === 1 && parts[0].length < 4 && !["mut", "ruhe", "sinn"].includes(parts[0])) return false;
  return true;
}

function fallbackCoreKeywords(text, tokens) {
  const normalized = normalizeText(text);
  const semantic = [];
  if (
    normalized.includes("um die ecke denken") ||
    normalized.includes("um den ecken denken") ||
    normalized.includes("quer denken") ||
    normalized.includes("querdenken") ||
    normalized.includes("anders denken")
  ) {
    semantic.push("kreative Problemloesung", "Perspektivenwechsel", "loesungsorientiert");
  }
  if (normalized.includes("zusammenhaenge") || normalized.includes("muster erkennen") || normalized.includes("verknuepfen")) {
    semantic.push("vernetztes Denken", "Zusammenhaenge erkennen");
  }
  if (normalized.includes("zuhoeren") || normalized.includes("zwischen den zeilen")) semantic.push("zuhoeren", "Empathie");
  if (normalized.includes("struktur") || normalized.includes("ordnung") || normalized.includes("ueberblick")) semantic.push("strukturieren", "Klarheit");
  if (normalized.includes("helfen") || normalized.includes("ermutigen") || normalized.includes("begleiten")) semantic.push("Menschen staerken", "begleiten");
  return uniqueArray([...semantic, ...tokens])
    .filter(qualityCoreTerm)
    .slice(0, 10);
}

function fallbackSenseConnections(input, coreTerms) {
  const selected = (value, fallback) => String(value || "").trim().split(/[.!?\n]+/g).map((item) => item.trim()).filter(Boolean)[0] || fallback;
  const strengthHint = selected(input?.answers?.S, "erste Ressourcen");
  const lifeHint = selected(input?.answers?.T, "erste Interessen");
  const needHint = selected(input?.answers?.A, "tragende Bedingungen");
  const impactHint = selected(input?.answers?.R, "eine moegliche Wirkungsrichtung");
  const terms = uniqueArray(coreTerms).slice(0, 6);
  return uniqueArray([
    `Die genannte Staerke zeigt sich darin, dass ${strengthHint} als Ressource sichtbar wird.`,
    `Lebendigkeit entsteht dort, wo ${lifeHint} mit den eigenen Staerken verbunden wird.`,
    `Die Spur bleibt tragfaehig, wenn ${needHint} als Bedingung ernst genommen wird.`,
    `Nach aussen zeigt sich ein Beitrag in Richtung ${impactHint}.`,
    terms[0] ? `${terms[0]} wirkt wie ein wiederkehrendes Motiv im Gesagten.` : "",
    terms[1] ? `${terms[1]} koennte ein Hinweis darauf sein, wie die Person denkt oder handelt.` : "",
    terms[2] ? `${terms[2]} verbindet sich mit der Frage, wo Energie und Wirkung zusammenkommen.` : "",
    terms[3] ? `${terms[3]} sollte in einem naechsten kleinen Praxistest beobachtet werden.` : "",
    "Ein sinnvoller naechster Schritt prueft nicht nur ein Interesse, sondern auch die passenden Bedingungen.",
    "Die Deutung bleibt ein Angebot und sollte im Gespraech mit der Person geprueft werden."
  ].filter(Boolean)).slice(0, 10);
}

function fallbackFromInput(input) {
  const all = [input?.answers?.S, input?.answers?.T, input?.answers?.A, input?.answers?.R]
    .map((entry) => String(entry || ""))
    .join("\n");

  const tokens = normalizeText(all)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 3)
    .slice(0, 24);
  const kernstichworte = fallbackCoreKeywords(all, tokens);
  const sinnzusammenhaenge = fallbackSenseConnections(input, kernstichworte);

  const pick = (start) => uniqueArray(tokens.slice(start, start + 6));
  const selected = (value, fallback) => String(value || "").trim().split(/[.!?\n]+/g).map((item) => item.trim()).filter(Boolean)[0] || fallback;
  const strengthHint = selected(input?.answers?.S, "erste Ressourcen");
  const lifeHint = selected(input?.answers?.T, "erste Interessen");
  const needHint = selected(input?.answers?.A, "tragende Bedingungen");
  const impactHint = selected(input?.answers?.R, "eine moegliche Wirkungsrichtung");
  const meaningSummary = [
    `Eine vorsichtige Lesart ist: ${strengthHint} verbindet sich mit ${lifeHint}.`,
    `Damit diese Spur tragfaehig wird, scheinen ${needHint} wichtig zu sein.`,
    `Nach aussen zeigt sich eine Richtung in ${impactHint}.`,
    "Diese lokale Verdichtung ersetzt keine KI-Deutung; sie markiert nur erste Sinnlinien fuer das Coachinggespraech."
  ].join(" ");
  return {
    clusters: {
      koennen: pick(0),
      lebendigkeit: pick(6),
      resonanz_beduerfnisse: pick(12),
      beitrag_wirksamkeit: pick(18)
    },
    leuchtfeuer: tokens[0] || "erste Spur",
    meaning_summary: meaningSummary,
    sinn_hypothesen: [
      "Eine moegliche Deutung koennte sein, dass die genannten Staerken dort lebendig werden, wo Interesse und Beitrag zusammenkommen.",
      "Es lohnt sich zu pruefen, welche Bedingung unbedingt stimmen muss, damit diese Spur nicht nur sinnvoll, sondern auch tragfaehig bleibt.",
      "Der naechste Schritt sollte die Aussage testen, die beim Kunden am meisten Resonanz ausloest."
    ],
    sinnzusammenhaenge_10: sinnzusammenhaenge,
    kernstichworte_10: kernstichworte,
    luecken_analyse: "Automatische Fallback-Analyse: Bitte Ergebnisse im Coachinggespraech pruefen.",
    empfohlene_vertiefungsfrage: "Welche Aussage fuehlt sich fuer dich am wichtigsten und stimmigsten an?",
    klarstarter_satz_entwuerfe: [
      `${meaningSummary} Eine moegliche Spur koennte sein, diese Verbindung in einem kleinen realen Schritt zu pruefen.`,
      `Es faellt auf, dass Ressourcen, Interessen und Beitrag bereits sichtbar sind. Wichtig bleibt zu klaeren, welche Bedingungen diesen Weg wirklich tragfaehig machen.`,
      `Eine erste Richtung entsteht dort, wo das Genannte nicht nur spannend klingt, sondern Energie gibt, zu den eigenen Beduerfnissen passt und fuer andere einen kleinen Unterschied machen kann.`
    ],
    red_alert: containsRedAlert(all)
  };
}

function normalizeAnalysis(parsed, fallback) {
  const fb = fallbackFromInput(fallback);
  const safe = parsed && typeof parsed === "object" ? parsed : {};
  const clusters = safe.clusters && typeof safe.clusters === "object" ? safe.clusters : {};

  const analysis = {
    clusters: {
      koennen: uniqueArray(clusters.koennen || fb.clusters.koennen).slice(0, 10),
      lebendigkeit: uniqueArray(clusters.lebendigkeit || fb.clusters.lebendigkeit).slice(0, 10),
      resonanz_beduerfnisse: uniqueArray(clusters.resonanz_beduerfnisse || fb.clusters.resonanz_beduerfnisse).slice(0, 10),
      beitrag_wirksamkeit: uniqueArray(clusters.beitrag_wirksamkeit || fb.clusters.beitrag_wirksamkeit).slice(0, 10)
    },
    leuchtfeuer: String(safe.leuchtfeuer || fb.leuchtfeuer || "").trim(),
    meaning_summary: String(safe.meaning_summary || fb.meaning_summary || "").trim(),
    sinn_hypothesen: uniqueArray(safe.sinn_hypothesen || fb.sinn_hypothesen).slice(0, 4),
    sinnzusammenhaenge_10: uniqueArray(safe.sinnzusammenhaenge_10 || safe.kernstichworte_10 || fb.sinnzusammenhaenge_10).slice(0, 10),
    kernstichworte_10: uniqueArray(safe.kernstichworte_10 || fb.kernstichworte_10).filter(qualityCoreTerm).slice(0, 10),
    luecken_analyse: String(safe.luecken_analyse || fb.luecken_analyse || "").trim(),
    empfohlene_vertiefungsfrage: String(safe.empfohlene_vertiefungsfrage || fb.empfohlene_vertiefungsfrage || "").trim(),
    klarstarter_satz_entwuerfe: uniqueArray(safe.klarstarter_satz_entwuerfe || fb.klarstarter_satz_entwuerfe).slice(0, 4),
    red_alert: Boolean(safe.red_alert) || fb.red_alert
  };

  if (analysis.klarstarter_satz_entwuerfe.length === 0) {
    analysis.klarstarter_satz_entwuerfe = fb.klarstarter_satz_entwuerfe;
  }
  return analysis;
}

function buildUserPrompt(input) {
  return [
    "Coaching-Kontext:",
    JSON.stringify({
      session_id: input.sessionId,
      provider: input.provider,
      model: input.model,
      age_category: input.ageCategory,
      flow_variant: input.flowVariant,
      aliases: input.aliases,
      consent: input.consent
    }, null, 2),
    "",
    "STAR-Antworten:",
    JSON.stringify(input.answers, null, 2),
    "",
    "Aufgabe:",
    "Ordne die Aussagen in die vier Cluster.",
    "Verdichte zusaetzlich den Sinn des Gesagten: Motive, Werte, Spannungen, wiederkehrende Bilder, Sprichwoerter und innere Logik.",
    "Nenne Leuchtfeuer, meaning_summary, sinn_hypothesen, genau 10 Sinnzusammenhaenge, Lueckenanalyse, Vertiefungsfrage und 3-4 Klarstarter-Satzentwuerfe.",
    "Wichtig: Sinnzusammenhaenge sind kurze Aussagezeilen, keine Einzelwoerter. Redewendungen nicht wortwoertlich zerlegen, sondern als Bedeutung erklaeren.",
    "Antwort nur als JSON gemaess Schema."
  ].join("\n");
}

async function callOpenAi(model, userPrompt) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY fehlt auf dem Server.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      input: [
        { role: "developer", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      store: false
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI API Fehler.");
  }
  return extractOpenAiText(data);
}

async function callGemini(model, userPrompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY fehlt auf dem Server.");
  }

  const modelName = model || DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [{
        role: "user",
        parts: [{ text: userPrompt }]
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini API Fehler.");
  }
  return extractGeminiText(data);
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const input = parseBody(req);
    const provider = String(input?.provider || "openai").toLowerCase();
    const userPrompt = buildUserPrompt(input);
    const rawCombinedInput = JSON.stringify(input?.answers || {});
    const preRedAlert = containsRedAlert(rawCombinedInput);

    let modelText = "";
    if (provider === "gemini") {
      modelText = await callGemini(input?.model, userPrompt);
    } else {
      modelText = await callOpenAi(input?.model, userPrompt);
    }

    const parsed = parseJsonFromModel(modelText);
    const analysis = normalizeAnalysis(parsed, input);
    analysis.red_alert = Boolean(analysis.red_alert || preRedAlert);

    res.status(200).json({
      ok: true,
      analysis
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unbekannter Serverfehler"
    });
  }
};

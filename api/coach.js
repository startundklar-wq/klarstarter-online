const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const DEFAULT_MODELS = {
  openai: "gpt-5.2",
  gemini: "gemini-2.0-flash"
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

JSON-Format:
{
  "clusters": {
    "koennen": ["..."],
    "lebendigkeit": ["..."],
    "resonanz_beduerfnisse": ["..."],
    "beitrag_wirksamkeit": ["..."]
  },
  "leuchtfeuer": "...",
  "luecken_analyse": "...",
  "empfohlene_vertiefungsfrage": "...",
  "klarstarter_satz_entwuerfe": ["...", "...", "..."],
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

function fallbackFromInput(input) {
  const all = [input?.answers?.S, input?.answers?.T, input?.answers?.A, input?.answers?.R]
    .map((entry) => String(entry || ""))
    .join("\n");

  const tokens = normalizeText(all)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 3)
    .slice(0, 24);

  const pick = (start) => uniqueArray(tokens.slice(start, start + 6));
  return {
    clusters: {
      koennen: pick(0),
      lebendigkeit: pick(6),
      resonanz_beduerfnisse: pick(12),
      beitrag_wirksamkeit: pick(18)
    },
    leuchtfeuer: tokens[0] || "erste Spur",
    luecken_analyse: "Automatische Fallback-Analyse: Bitte Ergebnisse im Coachinggespraech pruefen.",
    empfohlene_vertiefungsfrage: "Welche Aussage fuehlt sich fuer dich am wichtigsten und stimmigsten an?",
    klarstarter_satz_entwuerfe: [
      "Eine moegliche Spur koennte sein, dass du deine Staerken in einem stimmigen Umfeld fuer andere wirksam einsetzt.",
      "Es faellt auf, dass Ressourcen, Interessen und Beitrag bereits sichtbar sind; der naechste kleine Schritt kann diese Spur pruefen.",
      "Eine erste Richtung entsteht dort, wo deine Lebendigkeit und tragfaehigen Bedingungen zusammenkommen."
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
    "Nenne Leuchtfeuer, Lueckenanalyse, Vertiefungsfrage und 3-4 Klarstarter-Satzentwuerfe.",
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
      }],
      generationConfig: {
        temperature: 0.2
      }
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

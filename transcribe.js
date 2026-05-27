const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

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

function parseDataUrl(input) {
  const raw = String(input || "");
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mimeType: match[1], base64: match[2] };
  }
  return { mimeType: "", base64: raw };
}

function extensionForMime(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("webm")) return "webm";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("m4a")) return "m4a";
  return "webm";
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
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ ok: false, error: "OPENAI_API_KEY fehlt auf dem Server." });
      return;
    }

    const input = parseBody(req);
    const parsed = parseDataUrl(input.audioBase64);
    const mimeType = String(input.mimeType || parsed.mimeType || "audio/webm");
    const base64 = parsed.base64 || "";
    if (!base64) {
      res.status(400).json({ ok: false, error: "audioBase64 fehlt." });
      return;
    }

    const buffer = Buffer.from(base64, "base64");
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
    const fileExt = extensionForMime(mimeType);

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), `recording.${fileExt}`);
    form.append("model", model);
    if (input.language) form.append("language", String(input.language));
    form.append("prompt", "Transkribiere sorgfaeltig auf Deutsch (Schweizerdeutsch oder Hochdeutsch).");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: form
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = data?.error?.message || "Transkription fehlgeschlagen.";
      res.status(500).json({ ok: false, error: msg });
      return;
    }

    const text = typeof data?.text === "string" ? data.text.trim() : "";
    res.status(200).json({ ok: true, text });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unbekannter Fehler"
    });
  }
};


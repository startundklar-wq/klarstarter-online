# Klarstarter Online KI

Die Online-Version nutzt denselben STAR-Ablauf wie die lokale Haupt-App und kann zusaetzlich eine Cloud-KI anbinden:
- ChatGPT (OpenAI API)
- Gemini (Google API)

## Aufbau

- `index.html`: Vollstaendige App (UI + Ablauf + lokale Fallback-Analyse)
- `api/coach.js`: Server-Endpoint fuer KI-Auswertung
- `vercel.json`: Vercel-Funktionsrouting
- `.env.example`: benoetigte Umgebungsvariablen

## Verhalten

- Wenn `/api/coach` erreichbar ist und API-Key gesetzt ist, wird die Zusammenfassung ueber ChatGPT oder Gemini erzeugt.
- Wenn der Dienst nicht erreichbar ist, faellt die App automatisch auf lokale Analyse zurueck.
- Die Anzeige `Analysequelle` zeigt transparent, welche Quelle verwendet wurde.

## Deployment (Vercel)

1. Projektordner `klarstarter-online/` als eigenes Vercel-Projekt verbinden.
2. In Vercel unter **Settings -> Environment Variables** setzen:
   - `OPENAI_API_KEY` (fuer ChatGPT)
   - `GEMINI_API_KEY` (fuer Gemini)
3. Neu deployen.
4. Webseite oeffnen und im Setup den KI-Anbieter waehlen.

## Hinweise

- API-Keys bleiben serverseitig, niemals im Browser speichern.
- Unter 13 Jahren ist Audio in der UI deaktiviert.
- Die KI dient nur zur Strukturierung (keine automatische Einzelfallentscheidung).
- Bei RED-ALERT-Inhalten: menschliche Weiterleitung an geeignete Fachstellen.

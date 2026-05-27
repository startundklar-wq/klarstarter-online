(function () {
  const state = {
    sessionId: makeSessionId(),
    micByPhase: {},
    lastAnalysis: null
  };

  const modelDefaults = {
    openai: "gpt-5.2",
    gemini: "gemini-2.0-flash"
  };

  const phaseIds = ["S", "T", "A", "R"];

  function makeSessionId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function collectConsent() {
    return {
      voluntary: byId("consentVoluntary").checked,
      noTherapy: byId("consentNoTherapy").checked,
      audio: byId("consentAudio").checked,
      ai: byId("consentAi").checked,
      privacy: byId("consentPrivacy").checked,
      ethics: byId("consentEthics").checked
    };
  }

  function collectAnswers() {
    return {
      S: byId("inputS").value.trim(),
      T: byId("inputT").value.trim(),
      A: byId("inputA").value.trim(),
      R: byId("inputR").value.trim()
    };
  }

  function isUnder13() {
    return byId("ageCategorySelect").value === "under_13";
  }

  function updateAgeRules() {
    const under13 = isUnder13();
    const audioBox = byId("consentAudio");
    const ageHint = byId("ageHint");
    const micButtons = Array.from(document.querySelectorAll(".mic-btn"));

    if (under13) {
      audioBox.checked = false;
      audioBox.disabled = true;
      ageHint.textContent = "Unter 13 Jahre: Audio deaktiviert. Bitte nur Texteingabe.";
    } else {
      audioBox.disabled = false;
      ageHint.textContent = "Audio ist ab 13+ mit aktivem Opt-in moeglich.";
    }

    const micEnabled = !under13 && audioBox.checked;
    micButtons.forEach((button) => {
      button.disabled = !micEnabled;
      if (!micEnabled) button.textContent = "Mikrofon";
    });
  }

  function validateSetup() {
    const errorNode = byId("setupError");
    errorNode.textContent = "";

    const alias = byId("clientAliasInput").value.trim();
    if (!alias) {
      errorNode.textContent = "Bitte Kunde Alias eintragen.";
      return false;
    }
    if (/\s/.test(alias)) {
      errorNode.textContent = "Bitte Alias ohne Leerzeichen verwenden.";
      return false;
    }

    const consent = collectConsent();
    if (!consent.voluntary || !consent.noTherapy || !consent.ai || !consent.privacy || !consent.ethics) {
      errorNode.textContent = "Bitte alle Pflicht-Einwilligungen aktivieren.";
      return false;
    }

    if (!isUnder13() && !consent.audio) {
      errorNode.textContent = "Bitte Audio-Einwilligung aktivieren oder Alterskategorie unter 13 waehlen.";
      return false;
    }

    return true;
  }

  function hasSpeechApi() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function toggleMic(phaseId, button) {
    const speechApi = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!speechApi) {
      byId("analyzeStatus").textContent = "SpeechRecognition wird in diesem Browser nicht unterstuetzt.";
      return;
    }

    const active = state.micByPhase[phaseId];
    if (active) {
      try { active.stop(); } catch (error) {}
      state.micByPhase[phaseId] = null;
      button.textContent = "Mikrofon";
      return;
    }

    const rec = new speechApi();
    rec.lang = "de-CH";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal && text) finalText += `${text}\n`;
      }
      if (finalText) {
        const area = byId(`input${phaseId}`);
        area.value = `${area.value}\n${finalText}`.trim();
      }
    };
    rec.onend = () => {
      state.micByPhase[phaseId] = null;
      button.textContent = "Mikrofon";
    };
    rec.onerror = () => {
      byId("analyzeStatus").textContent = "Mikrofonfehler. Bitte erneut starten oder manuell schreiben.";
    };

    state.micByPhase[phaseId] = rec;
    button.textContent = "Mikrofon stoppen";
    rec.start();
  }

  function renderChips(containerId, items) {
    const node = byId(containerId);
    node.innerHTML = "";
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      node.innerHTML = "<span class='chip'>-</span>";
      return;
    }
    list.forEach((term) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = term;
      node.appendChild(chip);
    });
  }

  function renderSentenceOptions(options) {
    const wrap = byId("sentenceOptions");
    wrap.innerHTML = "";
    const list = Array.isArray(options) ? options : [];
    if (list.length === 0) {
      wrap.innerHTML = "<div class='result-box'>Keine Satzvarianten erhalten.</div>";
      return;
    }
    list.forEach((text, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sentence-option ${index === 0 ? "active" : ""}`;
      button.textContent = text;
      button.addEventListener("click", () => {
        Array.from(wrap.querySelectorAll(".sentence-option")).forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");
        byId("finalSentence").value = text;
      });
      wrap.appendChild(button);
    });
    byId("finalSentence").value = list[0];
  }

  function renderAnalysis(analysis) {
    const clusters = (analysis && analysis.clusters) || {};
    renderChips("koennenChips", clusters.koennen);
    renderChips("lebendigkeitChips", clusters.lebendigkeit);
    renderChips("resonanzChips", clusters.resonanz_beduerfnisse);
    renderChips("beitragChips", clusters.beitrag_wirksamkeit);

    byId("leuchtfeuerText").textContent = analysis.leuchtfeuer || "-";
    byId("gapText").textContent = analysis.luecken_analyse || "-";
    byId("followupText").textContent = analysis.empfohlene_vertiefungsfrage || "-";
    renderSentenceOptions(analysis.klarstarter_satz_entwuerfe || []);
  }

  async function runAnalysis() {
    const status = byId("analyzeStatus");
    status.textContent = "";
    if (!validateSetup()) return;

    const answers = collectAnswers();
    if (!answers.S || !answers.T || !answers.A || !answers.R) {
      status.textContent = "Bitte alle vier STAR-Felder ausfuellen.";
      return;
    }

    const payload = {
      sessionId: state.sessionId,
      provider: byId("providerSelect").value,
      model: byId("modelInput").value.trim(),
      ageCategory: byId("ageCategorySelect").value,
      flowVariant: byId("flowVariantSelect").value,
      aliases: {
        client: byId("clientAliasInput").value.trim(),
        coach: byId("coachAliasInput").value.trim()
      },
      consent: collectConsent(),
      answers
    };

    const analyzeBtn = byId("analyzeBtn");
    analyzeBtn.disabled = true;
    status.textContent = "KI analysiert...";

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        status.textContent = result.error || "Analyse fehlgeschlagen.";
        return;
      }
      state.lastAnalysis = result.analysis;
      renderAnalysis(result.analysis);
      status.textContent = "Analyse abgeschlossen.";
    } catch (error) {
      status.textContent = "Server nicht erreichbar. Ist die Website korrekt deployed?";
    } finally {
      analyzeBtn.disabled = false;
    }
  }

  function resetAll() {
    phaseIds.forEach((id) => {
      byId(`input${id}`).value = "";
    });
    byId("finalSentence").value = "";
    byId("setupError").textContent = "";
    byId("analyzeStatus").textContent = "";
    byId("copyStatus").textContent = "";
    byId("leuchtfeuerText").textContent = "-";
    byId("gapText").textContent = "-";
    byId("followupText").textContent = "-";
    byId("sentenceOptions").innerHTML = "";
    renderChips("koennenChips", []);
    renderChips("lebendigkeitChips", []);
    renderChips("resonanzChips", []);
    renderChips("beitragChips", []);
    state.sessionId = makeSessionId();
    state.lastAnalysis = null;
  }

  async function copySentence() {
    const text = byId("finalSentence").value.trim();
    if (!text) {
      byId("copyStatus").textContent = "Kein Satz zum Kopieren.";
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      byId("copyStatus").textContent = "Satz kopiert.";
    } catch (error) {
      byId("copyStatus").textContent = "Kopieren nicht moeglich. Bitte manuell markieren.";
    }
  }

  function bindEvents() {
    byId("providerSelect").addEventListener("change", (event) => {
      const provider = event.target.value;
      const current = byId("modelInput").value.trim();
      if (!current || current === modelDefaults.openai || current === modelDefaults.gemini) {
        byId("modelInput").value = modelDefaults[provider];
      }
    });
    byId("ageCategorySelect").addEventListener("change", updateAgeRules);
    byId("consentAudio").addEventListener("change", updateAgeRules);
    byId("analyzeBtn").addEventListener("click", runAnalysis);
    byId("copyBtn").addEventListener("click", copySentence);
    byId("emergencyDeleteBtn").addEventListener("click", () => {
      Object.keys(state.micByPhase).forEach((phaseId) => {
        try { state.micByPhase[phaseId].stop(); } catch (error) {}
      });
      resetAll();
      byId("analyzeStatus").textContent = "Sitzung geloescht.";
    });

    Array.from(document.querySelectorAll(".mic-btn")).forEach((button) => {
      button.addEventListener("click", () => {
        if (isUnder13() || !byId("consentAudio").checked) {
          byId("analyzeStatus").textContent = "Audio nicht freigegeben.";
          return;
        }
        if (!hasSpeechApi()) {
          byId("analyzeStatus").textContent = "SpeechRecognition wird nicht unterstuetzt.";
          return;
        }
        toggleMic(button.dataset.phase, button);
      });
    });
  }

  bindEvents();
  updateAgeRules();
  resetAll();
})();

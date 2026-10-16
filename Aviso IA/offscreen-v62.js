(() => {
  'use strict';
  const queue = [];
  let running = false;
  let audioContext = null;
  let audioBuffer = null;
  const liveSources = new Set();
  let cancelGeneration = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function ensureAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      try { await audioContext.resume(); } catch (_) {}
    }
    if (!audioBuffer) {
      try {
        const r = await fetch(chrome.runtime.getURL('sounds/finished.wav'));
        const ab = await r.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(ab.slice(0));
      } catch (_) {}
    }
  }

  function volume01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0.8;
    return Math.max(0, Math.min(100, n)) / 100;
  }

  async function playSound(volume) {
    const level = volume01(volume);
    if (level <= 0) return;
    await ensureAudio();
    if (!audioContext) return;

    if (audioBuffer) {
      // Ganancia directa 0–100 %. Sin compresor: el porcentaje cambia el volumen de forma real y perceptible.
      for (let i = 0; i < 3; i++) {
        const src = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        src.buffer = audioBuffer;
        liveSources.add(src);
        gain.gain.value = level;
        src.connect(gain).connect(audioContext.destination);
        src.onended = () => liveSources.delete(src);
        src.start();
        await new Promise(resolve => {
          let done = false;
          const finish = () => { if (done) return; done = true; liveSources.delete(src); resolve(); };
          src.addEventListener('ended', finish, { once:true });
          setTimeout(finish, 1400);
        });
        if (i < 2) await sleep(70);
      }
      return;
    }

    // Respaldo sintético si el WAV no pudiera cargarse.
    for (let i = 0; i < 3; i++) {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      liveSources.add(osc);
      osc.type = 'square';
      osc.frequency.value = i === 1 ? 1040 : 880;
      gain.gain.setValueAtTime(Math.max(0.0001, level * 0.55), audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
      osc.connect(gain).connect(audioContext.destination);
      osc.addEventListener('ended', () => liveSources.delete(osc), { once:true });
      osc.start(); osc.stop(audioContext.currentTime + 0.19);
      await sleep(220);
    }
  }

  function bestSpanishVoice() {
    const voices = speechSynthesis.getVoices();
    return voices.find(v => /^es-ES$/i.test(v.lang)) || voices.find(v => /^es/i.test(v.lang)) || null;
  }

  async function speak(text, volume = 80) {
    const phrase = String(text || '').trim();
    if (!phrase || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch (_) {}

    await new Promise(resolve => {
      let settled = false;
      const done = () => { if (settled) return; settled = true; resolve(); };
      const u = new SpeechSynthesisUtterance(phrase);
      u.lang = 'es-ES';
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = volume01(volume);
      const voice = bestSpanishVoice();
      if (voice) u.voice = voice;
      u.onend = done;
      u.onerror = done;
      try { speechSynthesis.speak(u); } catch (_) { done(); }
      // Respaldo: si el motor TTS no dispara onend, no deja la notificación eterna.
      setTimeout(done, Math.max(3500, Math.min(15000, phrase.length * 95)));
    });
  }

  async function closeAfterSpeech(job) {
    await sleep(3000);
    try {
      await chrome.runtime.sendMessage({
        type: 'V62_ALERT_CLOSE_NOW', target: 'background',
        notificationId: job.notificationId,
        requestId: job.requestId,
        tabId: job.tabId
      });
    } catch (_) {}
  }

  async function runQueue() {
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      const generation = cancelGeneration;
      try {
        if (job.sound) await playSound(job.volume);
        if (generation !== cancelGeneration) continue;
        if (job.speak) await speak(job.speechText, job.volume);
      } catch (_) {}
      if (generation !== cancelGeneration) continue;
      // El siguiente aviso puede empezar ya; este se cerrará 3 s después de terminar de hablar.
      closeAfterSpeech(job);
    }
    running = false;
  }

  function cancelAlerts() {
    cancelGeneration += 1;
    queue.length = 0;
    try { speechSynthesis.cancel(); } catch (_) {}
    for (const src of [...liveSources]) {
      try { src.stop(); } catch (_) {}
      liveSources.delete(src);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== 'offscreen') return;
    if (msg?.type === 'V62_CANCEL_ALERTS') {
      cancelAlerts();
      sendResponse({ ok:true });
      return false;
    }
    if (msg?.type !== 'V62_PLAY_ALERT') return;
    queue.push({
      notificationId: String(msg.notificationId || ''),
      requestId: String(msg.requestId || ''),
      tabId: Number(msg.tabId),
      sound: msg.sound !== false,
      speak: msg.speak !== false,
      volume: Number.isFinite(Number(msg.volume)) ? Math.max(0, Math.min(100, Number(msg.volume))) : 80,
      speechText: String(msg.speechText || '')
    });
    runQueue();
    sendResponse({ ok: true, queued: queue.length });
    return false;
  });
})();

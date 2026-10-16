(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    continueText: 'sigue',
    completionPhrase: 'HE ACABADO',
    finishDelaySeconds: 3,
    watchdogEnabled: true,
    watchdogMinutes: 20,
    maxContinuesPerChat: 12
  };

  const END_PHRASE = 'HE ACABADO';
  const LOOP_MS = 700;
  const SEND_CONFIRM_MS = 18000;
  const SEND_RETRY_COOLDOWN_MS = 3500;
  const VERSION = '2.8.0';
  const WORKFLOW_PREFIX = 'AUTOSIGUE_V15';
  const TERMINAL_DELAY_MS = 2500;

  let settings = { ...DEFAULTS };
  let chatKey = getChatKey();
  let enabledChats = {};
  let stopped = false;
  let continueCount = 0;
  let handledTurnId = '';
  let lastAssistantFingerprint = '';
  let lastAssistantChangeAt = Date.now();
  let stableSamples = 0;
  let answeringSince = null;
  let sendBusy = false;
  let watchdogBusy = false;
  let watchdogAttempted = false;
  let nextRetryAt = 0;
  let lastError = '';
  let lastAction = 'Iniciando';
  let lastSendMethod = '';
  let sendStage = '';
  let ambiguousSend = false;
  let scanBusy = false;
  let workflow = null;
  let workflowBusy = false;
  let moveBusy = false;
  let sendingLockToken = null;
  let handoffOptions = { auto: true, inheritMode: true, closeOldTab: false, deleteOldChat: false };
  const handoffDefaults = { auto: true, inheritMode: true, closeOldTab: false, deleteOldChat: false };
  const readHandoffOptions = data => ({ ...handoffDefaults, ...(data || {}), auto:true, closeOldTab:false, deleteOldChat:false });
  let handoffStatus = null;
  let handoffBusy = false;
  let handoffReceiveBusy = false;
  let receivedHandoffId = '';
  let failedTurnAttempts = new Map();
  let lastObservedTurn = '';
  let requestHandoffFromLimit = false;
  let lastHandoffPageAttempt = 0;
  let clickedProjectNewChat = false;
  let limitBannerSeen = false;
  let limitButtonSeen = false;
  let nativeLimitClickAttempted = false;
  let limitHandoffAttempted = false;
  let limitLastAttemptAt = 0;
  let limitAttemptCount = 0;
  let limitDetectionReason = '';
  let handoffTrigger = '';
  const HANDOFF_ERROR_RE = /has alcanzado la longitud m[aá]xima para esta conversaci[oó]n|has alcanzado (?:el )?l[ií]mite (?:de longitud|de contexto) de esta conversaci[oó]n|longitud m[aá]xima (?:para|de) (?:esta|la) conversaci[oó]n|(?:you(?:'ve| have) reached|reached) the maximum (?:length|limit) for this conversation|conversation (?:has reached|reached|is too long|too long|length limit)|maximum (?:conversation|context) length|context window (?:is )?full|reached (?:the )?(?:maximum )?(?:chat|conversation) limit|esta conversaci[oó]n (?:ha llegado|ha alcanzado|es demasiado larga)|l[ií]mite de (?:longitud|contexto) (?:de la )?conversaci[oó]n/i;
  // Se reitera en continuaciones y relevos: los archivos locales de un chat NO son
  // automáticamente accesibles desde otro, por lo que se pide un ZIP exportable.
  const ZIP_CONTINUITY_RULE = 'Si trabajas sobre archivos/proyectos, conserva avances en un ZIP completo con README e historial. Si dispones de conexión y permiso para usar Google Drive, sube el ZIP allí como archivo privado, SIN cambiar los permisos ni hacerlo público, y devuelve en la respuesta una línea DRIVE_ZIP_URL: https://drive.google.com/file/d/ID/view con la URL REAL. Reutiliza/actualiza la referencia en cada avance importante; no dupliques innecesariamente. Si no dispones de herramienta, acceso, permiso o subida confirmada, indícalo como NO SUBIDO, escribe DRIVE_ZIP_URL: NO_SUBIDO, entrega el ZIP local si puedes y NO inventes una URL de Drive. El chat siguiente utilizará el enlace con su propia conexión autorizada; no afirmes que el ZIP está disponible sin comprobarlo.';
  const LIMIT_BUTTON_RE = /^(?:iniciar (?:un )?nuevo chat|empezar (?:un )?nuevo chat|crear (?:un )?nuevo chat|start (?:a )?new chat|start new conversation|new chat)$/i;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function cleanText(value) {
    return String(value || '')
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function endComparable(value) {
    return cleanText(value)
      .replace(/[.!¡!¿?…]+$/g, '')
      .trim()
      .toUpperCase();
  }

  function isEndPhrase(value) {
    const marker = endComparable(settings.completionPhrase || END_PHRASE);
    const text = endComparable(value);
    return Boolean(marker && text && (text === marker || text.endsWith(' ' + marker)));
  }

  function buildContinuationMessage() {
    const base = cleanText(settings.continueText || 'sigue') || 'sigue';
    const marker = cleanText(settings.completionPhrase || END_PHRASE) || END_PHRASE;
    return `${base} Cuando hayas terminado completamente la tarea, escribe exactamente «${marker}» al final de la respuesta. No lo escribas antes de terminar.`;
  }

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function getChatKey() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    if (match) return `c:${match[1]}`;
    return `url:${location.pathname}${location.search}`;
  }

  function selectedForThisChat() {
    return chatKey.startsWith('c:') && Boolean(enabledChats[chatKey]);
  }

  function allowedToSend() {
    return settings.enabled && selectedForThisChat() && getChatKey() === chatKey && !stopped;
  }

  function workflowEnabled() {
    return Boolean(workflow?.enabled);
  }

  function workflowReady() {
    return workflowEnabled() && workflow.state === 'running';
  }

  function activeUiError() {
    const alerts = Array.from(document.querySelectorAll('[role="alert"], [data-testid*="error"], .toast-error'));
    for (const node of alerts) {
      if (!isVisible(node)) continue;
      const content = cleanText(node.innerText || node.textContent || '');
      if (/something went wrong|error generating|network error|rate limit|try again later|algo ha salido mal|error al generar|límite de uso|límite de mensajes|no se ha podido|ha ocurrido un error/i.test(content)) return content.slice(0, 250);
    }
    return '';
  }

  function nativeLimitButton() {
    // Solo controles visibles cuyo nombre coincide exactamente con la acción de ChatGPT.
    const candidates = [...document.querySelectorAll('button, [role="button"], a[href]')];
    return candidates.find(button => {
      if (!isVisible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const labels = [button.innerText, button.textContent, button.getAttribute('aria-label'), button.getAttribute('title')]
        .map(cleanText).filter(Boolean);
      return labels.some(label => LIMIT_BUTTON_RE.test(label));
    }) || null;
  }

  function findLimitSignal() {
    // Primero detectar el botón de la captura, acompañado de su propio aviso rojo.
    const button = nativeLimitButton();
    if (button) {
      let parent = button.parentElement;
      for (let level = 0; parent && level < 9; level++, parent = parent.parentElement) {
        const text = cleanText(parent.innerText || parent.textContent || '');
        if (text.length > 2600) break;
        if (HANDOFF_ERROR_RE.test(text)) return { seen: true, button, reason: 'aviso + boton' };
      }
    }
    // Segundo: avisos de error propios de ChatGPT. No se rastrea texto largo de los mensajes.
    const candidates = document.querySelectorAll(
      'main [role="alert"], main [role="status"], main [data-testid*="limit"], ' +
      'main [class*="text-red"], main [class*="text-orange"], main [class*="border-red"], ' +
      'main [class*="border-orange"], [role="alert"]'
    );
    for (const node of candidates) {
      if (!isVisible(node)) continue;
      const text = cleanText(node.innerText || node.textContent || '');
      if (text.length <= 1200 && HANDOFF_ERROR_RE.test(text)) {
        return { seen: true, button, reason: 'aviso de longitud maxima' };
      }
    }
    // Último recurso: localizar texto corto junto al control exacto, incluso sin roles.
    if (button) {
      const candidates = [...document.querySelectorAll('main div, main p, main span')];
      const notices = candidates.filter(node => {
        if (!isVisible(node)) return false;
        const text = cleanText(node.innerText || node.textContent || '');
        return text.length >= 35 && text.length <= 550 && HANDOFF_ERROR_RE.test(text);
      });
      if (notices.some(node => {
        const ancestor = node.parentElement?.parentElement?.parentElement;
        return ancestor && ancestor.contains(button);
      })) return { seen: true, button, reason: 'texto y boton cercanos' };
    }
    return { seen: false, button: null, reason: '' };
  }

  function visibleContextLimit() { return findLimitSignal().seen; }

  function workflowMarker(kind, index = workflow?.nextIndex || 0, flow = workflow) {
    return `[[${WORKFLOW_PREFIX}_${kind}:${flow.runId}:${index + 1}]]`;
  }

  function makeStepPrompt(flow, index) {
    const goal = flow.steps[index];
    const header = `PASO ${index + 1} DE ${flow.steps.length}. Ejecuta solamente este paso:\n\n${goal}`;
    return `${header}\n\n[CONTINUIDAD DE ARCHIVOS] ${ZIP_CONTINUITY_RULE}\n\n[CONTROL DE PASOS AUTO-SIGUE]\nAntes de responder, revisa errores y comprueba el resultado del paso con evidencias cuando sea posible. NO inicies pasos siguientes. Si has podido comprobar el resultado, termina tu respuesta con esta línea exacta: ${workflowMarker('OK', index, flow)}. Si hay un error, termina con: ${workflowMarker('ERROR', index, flow)}. Si no puedes comprobar realmente el resultado, termina con: ${workflowMarker('NO_COMPROBABLE', index, flow)}. Nunca marques OK basándote solo en una suposición, ni escribas los tres marcadores a la vez. Si necesitas una intervención humana, usa ERROR. Mantén el marcador en la ÚLTIMA línea de la respuesta.`;
  }

  function makeCheckPrompt(flow, index) {
    return `Comprueba exclusivamente el resultado del PASO ${index + 1}/${flow.steps.length} que acabas de realizar. Revisa errores y verifica con evidencias reales. No empieces ningún otro paso. Finaliza con UNA única línea exacta: ${workflowMarker('OK', index, flow)} si has podido verificar que está terminado; ${workflowMarker('ERROR', index, flow)} si ha fallado; ${workflowMarker('NO_COMPROBABLE', index, flow)} si no puedes verificarlo. No inventes pruebas ni confirmaciones.`;
  }

  function markerAtEnd(text, tag) {
    return String(text || '').trim().endsWith(tag);
  }

  async function saveWorkflow(patch) {
    if (!chatKey.startsWith('c:')) return;
    const targetKey = chatKey;
    if (getChatKey() !== targetKey) throw new Error('Se ha cambiado de conversación durante la operación.');
    const old = workflow || {};
    const next = { ...old, ...patch, updatedAt: Date.now() };
    const data = await chrome.storage.local.get({ workflowByChat: {} });
    const nextAll = { ...data.workflowByChat, [targetKey]: next };
    workflow = next;
    await chrome.storage.local.set({ workflowByChat: nextAll });
  }

  function workflowErrorText(err) {
    return cleanText(err?.message || err || 'Error no especificado').slice(0, 250);
  }


  function chatTitle() {
    const title = cleanText(document.title).replace(/\s*[-|–]\s*ChatGPT\s*$/i, '');
    return title && title.toLowerCase() !== 'chatgpt' ? title.slice(0, 120) : 'Chat seleccionado';
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryVisible(selectors, root = document) {
    for (const selector of selectors) {
      const nodes = Array.from(root.querySelectorAll(selector));
      const found = nodes.find(isVisible);
      if (found) return found;
    }
    return null;
  }

  function getComposer() {
    return queryVisible([
      '#prompt-textarea[contenteditable="true"]',
      '[data-testid="composer-input"][contenteditable="true"]',
      'main [role="textbox"][contenteditable="true"]',
      '[data-testid="composer-input"] [contenteditable="true"]',
      '[data-testid="composer-input"][contenteditable="true"]',
      'main form [contenteditable="true"].ProseMirror',
      'main form [contenteditable="true"][role="textbox"]',
      'div#prompt-textarea[contenteditable="true"]',
      'form[data-chatgpt-composer] .ProseMirror[contenteditable="true"]',
      'form .ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"][aria-label*="Chat" i]',
      'div[contenteditable="true"][role="textbox"][aria-label*="Ask" i]',
      'div[contenteditable="true"][role="textbox"][aria-label*="mensaje" i]',
      'textarea[name="prompt-textarea"]',
      'textarea[data-id="root"]',
      'main [contenteditable="true"].ProseMirror'
    ]);
  }

  function getSendButton() {
    const editor = getComposer();
    if (!editor) return null;
    // Algunas versiones de ChatGPT renderizan el botón Enviar fuera del <form>.
    // Buscar primero en el formulario y después en la página, pero aceptar sólo
    // controles de envío reconocibles: nunca pulsar botones genéricos.
    const scope = editor.closest('form') || editor.closest('[data-testid="composer"]');
    const selectors = [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="send-message-button"]',
      'button[data-testid="chat-input-send"]',
      'button[data-testid="composer-send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      '#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Enviar mensaje"]',
      'button[aria-label="Enviar"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Enviar mensaje a ChatGPT"]',
      'button[title="Send message"]',
      'button[title="Enviar mensaje"]'
    ];
    const scopes = [...new Set([scope, document].filter(Boolean))];
    for (const root of scopes) {
      for (const selector of selectors) {
        for (const btn of root.querySelectorAll(selector)) {
          if (!isVisible(btn) || btn.tagName !== 'BUTTON') continue;
          const label = cleanText([btn.getAttribute('aria-label'), btn.getAttribute('title'), btn.innerText, btn.getAttribute('data-testid')].join(' '));
          if (/(?:^|\W)(?:stop|detener|parar|record|grabar|micr[oó]fono|microphone|dictate|voice|voz)(?:\W|$)/i.test(label)) continue;
          // Si hay varios compositores en pantalla, no elegir otro distinto.
          const otherForm = btn.closest('form');
          if (scope && root === document && otherForm && editor.closest('form') && otherForm !== editor.closest('form')) continue;
          return btn;
        }
      }
    }
    // Sólo dentro del formulario del editor aceptar un submit sin etiqueta.
    return (editor.closest('form') && queryVisible(['button[type="submit"]'], editor.closest('form'))) || null;
  }

  function getStopButton() {
    return queryVisible([
      'button[data-testid="stop-button"]',
      '#composer-submit-button[aria-label*="Stop" i]',
      '#composer-submit-button[aria-label*="Detener" i]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
      'button[aria-label*="Parar" i]'
    ]);
  }

  function isAnswering() {
    if (getStopButton()) return true;
    const streaming = document.querySelector('.result-streaming, [data-is-streaming="true"]');
    return Boolean(streaming && (isVisible(streaming) || streaming.closest('[data-message-author-role="assistant"]')));
  }

  function assistantNodes() {
    const legacy = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    if (legacy.length) return legacy;

    const rollout = Array.from(document.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"]'));
    if (rollout.length) return rollout;

    const styled = Array.from(document.querySelectorAll('[data-markdown-text-style="assistant-message"]'));
    return styled.map(el => el.closest('article') || el);
  }

  function userNodes() {
    const legacy = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
    if (legacy.length) return legacy;
    return Array.from(document.querySelectorAll('[data-chatgpt-search-unit-key$=":user"]'));
  }

  function assistantText(node) {
    if (!node) return '';
    const body = node.querySelector?.('.markdown, [data-markdown-text-style="assistant-message"]');
    return cleanText((body || node).innerText || (body || node).textContent || '');
  }

  function latestAssistant() {
    const nodes = assistantNodes();
    const node = nodes[nodes.length - 1] || null;
    const text = assistantText(node);
    return { node, text, count: nodes.length };
  }

  function turnId(info) {
    if (!info.node) return '';
    const explicit = info.node.getAttribute?.('data-message-id') ||
      info.node.closest?.('[data-message-id]')?.getAttribute('data-message-id') ||
      info.node.getAttribute?.('data-chatgpt-search-unit-key') ||
      info.node.closest?.('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid');
    if (explicit) return explicit;
    return `${info.count}:${hashText(info.text.slice(0, 1200))}:${info.text.length}`;
  }

  function assistantFingerprint(info) {
    return `${info.count}|${info.text.length}|${hashText(info.text)}`;
  }

  function editorText(editor) {
    if (!editor) return '';
    if ('value' in editor && typeof editor.value === 'string') return cleanText(editor.value);
    return cleanText(editor.innerText || editor.textContent || '');
  }

  function dispatchInput(editor, text) {
    try {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function clearEditor(editor) {
    editor.focus();
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(editor, '');
      else editor.value = '';
      dispatchInput(editor, '');
      return;
    }

    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false);
      sel.removeAllRanges();
    } catch (_) {
      editor.replaceChildren();
      dispatchInput(editor, '');
    }
  }

  async function putText(editor, text) {
    clearEditor(editor);
    await sleep(80);

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(editor, text);
      else editor.value = text;
      dispatchInput(editor, text);
      await sleep(120);
      if (editorText(editor) === cleanText(text)) return 'native-value';
    } else {
      try {
        // Tras clearEditor puede no quedar una selección válida en Chromium.
        // ProseMirror necesita el cursor colocado DENTRO del editor para
        // registrar correctamente insertText (el focus por sí solo no basta).
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        const ok = document.execCommand('insertText', false, text);
        await sleep(150);
        if (ok && editorText(editor) === cleanText(text)) return 'execCommand';
      } catch (_) {}

      try {
        clearEditor(editor);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        editor.dispatchEvent(paste);
        await sleep(120);
        if (editorText(editor) === cleanText(text)) return 'paste-event';
      } catch (_) {}

      // Modificar solo textContent deja ProseMirror visualmente lleno, pero React
      // no registra la edición ni habilita Enviar: no se acepta como envío válido.
      // Se probará sólo la inserción por eventos de edición reales.

    }

    return '';
  }

  async function waitForEnabledSend(timeoutMs = 3500) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const button = getSendButton();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') return button;
      await sleep(100);
    }
    return null;
  }

  function pressEnterFallback(editor) {
    editor.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      editor.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true, composed: true
      }));
    }
  }

  async function confirmSent(snapshot, editor) {
    const until = Date.now() + SEND_CONFIRM_MS;
    while (Date.now() < until) {
      const users = userNodes().length;
      const assistants = assistantNodes().length;
      const currentEditor = getComposer() || editor;
      const emptied = currentEditor ? editorText(currentEditor) === '' : false;
      const gotConversationId = !snapshot.hadConversationId && /\/c\/[^/?#]+/.test(location.pathname);

      // La URL /c/... puede aparecer antes de que se haya aceptado el mensaje.
      // No considerar el mero cambio de URL una confirmación de envío.
      if (users > snapshot.users ||
          (gotConversationId && emptied && (isAnswering() || assistants > snapshot.assistants))) {
        return true;
      }
      await sleep(120);
    }
    return false;
  }

  async function markStopped() {
    stopped = true;
    const data = await chrome.storage.local.get({ stoppedChats: {} });
    const stoppedChats = { ...(data.stoppedChats || {}), [chatKey]: true };
    await chrome.storage.local.set({ stoppedChats });
    lastAction = 'HE ACABADO detectado: chat detenido';
    lastError = '';
    if (false && !workflowEnabled() && workflow?.autoMove && workflow?.projectTarget) {
      await saveWorkflow({ state: 'done', finishedAt: Date.now(), projectStatus: 'pending' });
      /* Cambio automático de chat/proyecto deshabilitado. */
    }
    await publishStatus();
    // No abrir otro chat al terminar.
  }

  async function clearStoppedForChat() {
    const data = await chrome.storage.local.get({ stoppedChats: {} });
    const stoppedChats = { ...(data.stoppedChats || {}) };
    delete stoppedChats[chatKey];
    await chrome.storage.local.set({ stoppedChats });
    stopped = false;
    handledTurnId = '';
    nextRetryAt = 0;
    lastAction = 'Chat reactivado';
    lastError = '';
    await publishStatus();
  }

  function maxReached() {
    const configured = Number(settings.maxContinuesPerChat);
    // 0 significa ilimitado; no imponer límites heredados ni valores predeterminados ocultos.
    return Number.isFinite(configured) && configured > 0 && continueCount >= configured;
  }

  async function sendContinue(reason, { force = false, textOverride = null, isStep = false } = {}) {
    if (sendBusy || ambiguousSend) { if(ambiguousSend)lastError='Último envío sin confirmar. Revisa el chat y reinicia el estado antes de reintentar.'; return false; }
    if (!allowedToSend()) return false;
    if (maxReached() && !force && !isStep) return false;
    if (!force && isAnswering()) return false;

    sendBusy = true;
    sendStage = 'escribiendo';
    lastError = '';
    try {
      const latest = latestAssistant();
      if (!force && !isStep && latest.text && isEndPhrase(latest.text)) {
        await markStopped();
        return false;
      }

      const editor = getComposer();
      if (!editor) {
        lastError = 'No encuentro #prompt-textarea / editor de ChatGPT';
        lastAction = reason;
        return false;
      }

      if (editorText(editor)) {
        lastError = 'El editor contiene un borrador: no se ha sobrescrito.';
        lastAction = reason;
        return false;
      }
      const text = textOverride === null ? buildContinuationMessage() : textOverride;
      const snapshot = {
        users: userNodes().length,
        assistants: assistantNodes().length,
        hadConversationId: /\/c\/[^/?#]+/.test(location.pathname),
        editorWasPopulated: true
      };

      if (!allowedToSend()) return false;
      const method = await putText(editor, text);
      if (!method || editorText(editor) !== cleanText(text)) {
        lastError = 'El texto no quedó escrito correctamente en el editor';
        lastAction = reason;
        return false;
      }
      lastSendMethod = method;
      if (!allowedToSend()) {
        if (editorText(editor) === cleanText(text)) clearEditor(editor);
        return false;
      }

      let submitted = false;
      let button = await waitForEnabledSend(3500);
      if (!allowedToSend()) {
        if (editorText(editor) === cleanText(text)) clearEditor(editor);
        return false;
      }
      if (button && allowedToSend()) {
        sendStage = 'enviando';
        ambiguousSend = true;
        button.click();
        submitted = true;
      }

      if (!submitted && allowedToSend()) {
        const form = editor.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try {
            form.requestSubmit();
            submitted = true;
            ambiguousSend = true;
            lastSendMethod += '+requestSubmit';
          } catch (_) {}
        }
      }

      // Un KeyboardEvent sintético no representa una pulsación real en React.
      // No simular éxito si ChatGPT no ofrece un botón o un form real.

      if (!submitted || !(await confirmSent(snapshot, editor))) {
        sendStage = 'error';
        lastError = submitted
          ? 'Envío NO COMPROBABLE: se intentó una vez y no apareció un mensaje nuevo del usuario. Revisa el chat; no se repite para evitar duplicados.'
          : 'No hay botón de envío utilizable para este editor. No se ha enviado el mensaje.';
        lastAction = reason;
        return false;
      }

      sendStage = 'confirmado';
      ambiguousSend = false;
      if (!isStep) continueCount += 1;
      lastAction = isStep ? reason : `${reason}: enviado “${text}”`;
      lastError = '';
      answeringSince = Date.now();
      return true;
    } catch (err) {
      sendStage = 'error';
      lastError = String(err?.message || err || 'Error desconocido');
      lastAction = reason;
      return false;
    } finally {
      if (lastError && sendStage !== 'confirmado') sendStage = 'error';
      sendBusy = false;
      await publishStatus();
    }
  }

  async function syncChatState() {
    const key = getChatKey();
    if (key === chatKey) return;
    chatKey = key;
    continueCount = 0;
    failedTurnAttempts.clear();
    workflow = null;
    handledTurnId = '';
    lastAssistantFingerprint = '';
    lastAssistantChangeAt = Date.now();
    stableSamples = 0;
    answeringSince = null;
    watchdogAttempted = false;
    nextRetryAt = 0;
    lastError = '';
    lastAction = 'Chat cambiado';
    limitBannerSeen = false;
    limitButtonSeen = false;
    nativeLimitClickAttempted = false;
    limitHandoffAttempted = false;
    limitLastAttemptAt = 0;
    limitAttemptCount = 0;
    const data = await chrome.storage.local.get({ stoppedChats: {}, workflowByChat: {}, handoffOptionsByChat: {}, handoffStatusByChat: {} });
    stopped = Boolean(data.stoppedChats?.[chatKey]);
    workflow = data.workflowByChat?.[chatKey] || null;
    handoffOptions = readHandoffOptions(data.handoffOptionsByChat?.[chatKey]);
    handoffStatus = data.handoffStatusByChat?.[chatKey] || null;
  }

  async function watchdog() {
    if (!allowedToSend() || !settings.watchdogEnabled || watchdogBusy || maxReached() || ambiguousSend) return;
    if (!isAnswering()) {
      answeringSince = null;
      watchdogAttempted = false;
      return;
    }
    if (!answeringSince) answeringSince = Date.now();

    const minutes = Math.max(1, Number(settings.watchdogMinutes) || 20);
    if (watchdogAttempted || Date.now() - answeringSince < minutes * 60 * 1000) return;

    watchdogAttempted = true; // Una sola intervención por respuesta; no repetir Detener en bucle.
    watchdogBusy = true;
    try {
      if (workflowEnabled()) {
        if (['awaiting','running','sending'].includes(workflow.state)) {
          await saveWorkflow({ state: 'error', error: `Respuesta bloqueada más de ${minutes} min. Revisión manual necesaria.` });
          lastError = workflow.error;
          lastAction = 'Secuencia pausada por bloqueo';
        }
        return;
      }
      const stop = getStopButton();
      if (!stop) {
        lastError = `Watchdog: no encuentro el botón Detener tras ${minutes} min`;
        lastAction = 'Watchdog';
        return;
      }

      if (!allowedToSend()) return;
      stop.click();
      lastAction = `Tiempo máximo: generación detenida tras ${minutes} min`;
      const until = Date.now() + 12000;
      while (Date.now() < until && isAnswering()) await sleep(200);
      if (isAnswering()) {
        lastError = 'Watchdog: ChatGPT no se detuvo';
        return;
      }

      answeringSince = null;
      await sleep(600);
      const ok = await sendContinue('Envío por tiempo', { force: false });
      if (!ok && !lastError) lastError = 'Watchdog: no se pudo enviar “sigue”';
    } finally {
      watchdogBusy = false;
      await publishStatus();
    }
  }


  function finishedResponseForWorkflow() {
    // A completed answer must have no live stop/streaming indicators and a stable assistant turn.
    const info = latestAssistant();
    const delayMs = Math.max(TERMINAL_DELAY_MS, (Number(settings.finishDelaySeconds) || 3) * 1000);
    return info.text && !isAnswering() && !activeUiError() &&
      Date.now() - lastAssistantChangeAt >= delayMs && stableSamples >= 3;
  }

  async function sendWorkflowStep(index, verification = false) {
    if (!workflowReady() || !allowedToSend() || sendBusy || workflowBusy) return false;
    if (isAnswering()) return false;
    workflowBusy = true;
    const token = `${Date.now()}-${Math.random()}`;
    try {
      const claim = await chrome.runtime.sendMessage({ type: 'WORKFLOW_CLAIM', chatKey, token });
      if (!claim?.ok) return false;
      sendingLockToken = token;
      if (!workflowReady()) return false;
      const flow = workflow;
      if (!flow?.steps?.[index]) return false;
      const baseline = latestAssistant();
      const next = { state: 'sending', nextIndex: index, checkAttempts: verification ? 1 : 0,
        waitForTurnId: turnId(baseline), waitForTurnCount: baseline.count,
        error: '', lastStepSentAt: Date.now() };
      await saveWorkflow(next);
      const prompt = verification ? makeCheckPrompt(flow, index) : makeStepPrompt(flow, index);
      const ok = await sendContinue(verification ? `Verificación paso ${index + 1}` : `Paso ${index + 1}/${flow.steps.length}`,
        { textOverride: prompt, isStep: true });
      if (!ok) {
        await saveWorkflow({ state: 'error', error: lastError || 'Envío no confirmado. No se reintentará automáticamente.' });
        return false;
      }
        await saveWorkflow({ state: 'awaiting', pendingTurnId: '', lastStepSentAt: Date.now() });
      return true;
    } finally {
      if (sendingLockToken === token) {
        sendingLockToken = null;
        try { await chrome.runtime.sendMessage({ type: 'WORKFLOW_RELEASE', chatKey, token }); } catch (_) {}
      }
      workflowBusy = false;
    }
  }

  async function advanceWorkflow() {
    if (!workflowReady() || !allowedToSend() || workflowBusy || sendBusy) return;
    if (workflow.state === 'running') {
      await sendWorkflowStep(workflow.nextIndex || 0);
      return;
    }
  }

  async function handleWorkflowAnswer() {
    if (!workflowEnabled() || !allowedToSend() || workflowBusy || sendBusy) return;
    const flow = workflow;
    if (flow.state === 'running') {
      if (Date.now() < (flow.lastStepSentAt || 0) + 1400) return;
      // If the user manually started a workflow while the model was idle, send the first step.
      await advanceWorkflow();
      return;
    }
    if (flow.state !== 'awaiting' || !finishedResponseForWorkflow()) return;
    const info = latestAssistant();
    const index = flow.nextIndex || 0;
    if (Date.now() - (flow.lastStepSentAt || 0) < 1800) return;
    if (info.count < (flow.waitForTurnCount || 0) || turnId(info) === flow.waitForTurnId) return;
    const observed = ['OK', 'ERROR', 'NO_COMPROBABLE'].find(tag => markerAtEnd(info.text, workflowMarker(tag, index, flow)));
    if (!observed) {
      if ((flow.checkAttempts || 0) >= 1) {
        await saveWorkflow({ state: 'error', error: `PASO ${index + 1}: no hay marcador verificable tras una comprobación. Revisión manual.` });
        return;
      }
      await saveWorkflow({ state: 'running' });
      await sendWorkflowStep(index, true);
      return;
    }
    if (observed !== 'OK') {
      await saveWorkflow({ state: 'error', error: `PASO ${index + 1}: respuesta ${observed}. Revisa el chat y decide si reintentar.` });
      lastAction = `Secuencia detenida en paso ${index + 1}`;
      return;
    }
    const completed = index + 1;
    if (completed >= flow.steps.length) {
      await saveWorkflow({ state: 'done', nextIndex: completed, finishedAt: Date.now(), projectStatus: flow.autoMove && flow.projectTarget ? 'pending' : 'not_requested', error: '' });
      lastAction = 'Secuencia completada según las comprobaciones de la IA';
      /* Cambio automático de chat/proyecto deshabilitado. */
      // Se conserva la conversación.
      return;
    }
    await saveWorkflow({ state: 'running', nextIndex: completed, checkAttempts: 0, error: '' });
    lastAction = `Paso ${completed} completado. Siguiente: ${completed + 1}`;
    await sendWorkflowStep(completed);
  }

  // ChatGPT cambia los menús y el diseño según cuenta, idioma y ancho de ventana.
  // Solo se pulsa un control si se ha localizado de forma unívoca y en el chat correcto.
  function projectIdInPath(path) {
    return (String(path || '').match(/\/g\/(g-p-[^/?#]+)(?:\/|$)/i) || [])[1] || '';
  }

  function currentProjectFromUrl() {
    return projectIdInPath(location.pathname);
  }

  function chatIdInPath(path) {
    return (String(path || '').match(/\/c\/([^/?#]+)(?:\/|$)/) || [])[1] || '';
  }

  function elementLabel(el) {
    return cleanText(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '');
  }

  function matchingProjectLinks(name) {
    const target = cleanText(name).toLocaleLowerCase('es');
    return Array.from(document.querySelectorAll('a[href]')).filter(el => {
      if (!isVisible(el) || !projectIdInPath(new URL(el.href, location.href).pathname)) return false;
      if (chatIdInPath(new URL(el.href, location.href).pathname)) return false;
      return elementLabel(el).toLocaleLowerCase('es') === target ||
        cleanText(el.getAttribute('title')).toLocaleLowerCase('es') === target;
    });
  }

  function destinationProjectId(targetName) {
    const ids = [...new Set(matchingProjectLinks(targetName).map(a => projectIdInPath(new URL(a.href, location.href).pathname)))];
    return ids.length === 1 ? ids[0] : '';
  }

  function isCorrectProject(targetName, expectedId) {
    if (!chatIdInPath(location.pathname) || chatIdInPath(location.pathname) !== chatKey.slice(2)) return false;
    const actual = currentProjectFromUrl();
    if (!actual) return false;
    if (expectedId) return actual === expectedId;
    return destinationProjectId(targetName) === actual;
  }

  function isMenuTrigger(el) {
    const txt = cleanText(`${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`);
    return /(?:options?|more|opciones|más|menu|menú|ellipsis|conversation-header)/i.test(txt) &&
      !/(?:share|compartir|settings|ajustes|account|cuenta|project options|proyecto)/i.test(txt);
  }

  function currentChatSidebarTrigger() {
    const id = chatKey.slice(2);
    const links = Array.from(document.querySelectorAll('nav a[href], aside a[href], [data-testid*="sidebar"] a[href]'))
      .filter(el => { try { return chatIdInPath(new URL(el.href, location.href).pathname) === id; } catch (_) { return false; } });
    if (links.length !== 1) return null;
    const link = links[0];
    // Evitar buscar en toda la barra lateral; limitarse al elemento del chat.
    const row = link.closest('[data-testid^="history-item"], [data-testid*="conversation-item"], [data-testid*="chat-item"], li, [role="listitem"]') || link.parentElement;
    if (!row || row.querySelectorAll('a[href*="/c/"]').length !== 1) return null;
    const buttons = Array.from(row.querySelectorAll('button')).filter(el => isVisible(el));
    const named = buttons.filter(isMenuTrigger);
    if (named.length === 1) return named[0];
    if (!named.length) {
      // En algunos diseños el único botón del elemento es el menú ··· sin nombre.
      const iconOnly = buttons.filter(b => !elementLabel(b) && !b.disabled);
      if (iconOnly.length === 1) return iconOnly[0];
    }
    return null;
  }

  function headerChatMenuTrigger() {
    // Menú del chat abierto: alternativa cuando la conversación no aparece en el lateral.
    const roots = Array.from(document.querySelectorAll('header, [data-testid="conversation-header"], [data-testid*="chat-header"]'))
      .filter(el => isVisible(el) && !el.closest('nav,aside,[role="dialog"]'));
    const nodes = [...new Set(roots.flatMap(root => Array.from(root.querySelectorAll('button'))))]
      .filter(el => isVisible(el) && !el.disabled && isMenuTrigger(el));
    // El nombre debe referirse al menú de la conversación, no al menú de cuenta.
    const specific = nodes.filter(el => /(?:conversation|chat|conversaci[oó]n|history|historial)/i.test(
      `${el.getAttribute('data-testid') || ''} ${el.getAttribute('aria-label') || ''}`));
    if (specific.length === 1) return specific[0];
    if (specific.length > 1) return null;
    return nodes.length === 1 ? nodes[0] : null;
  }

  function visibleMenuChoices() {
    const roots = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [cmdk-root], [data-radix-menu-content]'))
      .filter(isVisible);
    const found = roots.flatMap(root => Array.from(root.querySelectorAll('[role="menuitem"], [role="option"], [cmdk-item], button')));
    // Algunos desplegables son portales que colocan role=menuitem sin role=menu.
    found.push(...document.querySelectorAll('[role="menuitem"], [role="option"], [cmdk-item]'));
    return [...new Set(found)].filter(el => isVisible(el) && el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
  }

  async function waitForMenuChoice(matcher, timeout = 5000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const unique = [...new Set(visibleMenuChoices().filter(el => matcher(elementLabel(el))))];
      // Nunca elegir un destino cuando hay varias coincidencias (p.ej. proyectos homónimos).
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) return null;
      await sleep(130);
    }
    return null;
  }

  function moveMenuText(label) {
    const s = cleanText(label).replace(/[›»→]+$/, '').trim();
    return /^(?:mover\s+(?:(?:a|al)\s+)?(?:un\s+)?proyecto|move\s+to\s+(?:a\s+)?project)s?$/i.test(s);
  }

  async function confirmProjectMove(targetName, expectedId, timeout = 11000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (isCorrectProject(targetName, expectedId)) return true;
      // ChatGPT puede mantener /c/ en la URL y actualizar solamente la barra lateral.
      // La prueba exige que se reconozca el proyecto exacto de destino en el enlace del chat.
      const id = chatKey.slice(2);
      if (expectedId) {
        const links = Array.from(document.querySelectorAll('nav a[href], aside a[href], [data-testid*="sidebar"] a[href]'));
        if (links.some(a => {
          try {
            const path = new URL(a.href, location.href).pathname;
            return chatIdInPath(path) === id && projectIdInPath(path) === expectedId;
          } catch (_) { return false; }
        })) return true;
      }
      await sleep(200);
    }
    return false;
  }

  async function handleProjectMove() {
    return;
    if (!workflow || workflow.state !== 'done' || !workflow.autoMove || !workflow.projectTarget || moveBusy) return;
    if (!['pending'].includes(workflow.projectStatus)) return;
    if (getChatKey() !== chatKey || !chatKey.startsWith('c:')) return;
    moveBusy = true;
    try {
      const target = cleanText(workflow.projectTarget);
      const expectedId = destinationProjectId(target);
      const sourceProject = currentProjectFromUrl();
      if (sourceProject) {
        if (isCorrectProject(target, expectedId)) {
          await saveWorkflow({ projectStatus: 'already_in_project', projectError: `Este chat ya está en «${target}»; no hace falta moverlo.` });
        } else {
          await saveWorkflow({ projectStatus: 'manual', projectError: 'El chat ya está en otro proyecto o no puede comprobarse cuál es. No se moverá automáticamente.' });
        }
        return;
      }
      // No hay una API pública de migración de chats. Se usa el menú real; nunca hay clic a ciegas.
      const trigger = currentChatSidebarTrigger() || headerChatMenuTrigger();
      if (!trigger) {
        await saveWorkflow({ projectStatus: 'manual', projectError: 'No se encuentra el menú del chat abierto (ni en su fila del lateral ni en su cabecera).' });
        return;
      }
      trigger.click();
      const move = await waitForMenuChoice(moveMenuText);
      if (!move) {
        await saveWorkflow({ projectStatus: 'manual', projectError: 'No aparece una opción única «Mover a proyecto»; puede que este chat no admita migración.' });
        return;
      }
      move.click();
      const dest = await waitForMenuChoice(text => cleanText(text).toLocaleLowerCase('es') === target.toLocaleLowerCase('es'));
      if (!dest) {
        await saveWorkflow({ projectStatus: 'manual', projectError: `No se encuentra un destino único llamado «${target}». Comprueba su nombre o abre el panel de proyectos.` });
        return;
      }
      // Marcar EN CURSO antes del clic: una navegación de página no debe perder el estado.
      await saveWorkflow({ projectStatus: 'moving', projectStartedAt: Date.now(), projectExpectedId: expectedId, projectError: '' });
      dest.click();
      if (await confirmProjectMove(target, expectedId)) {
        await saveWorkflow({ projectStatus: 'moved', projectError: '', projectMovedAt: Date.now() });
      } else if (expectedId && currentProjectFromUrl() && currentProjectFromUrl() !== expectedId) {
        await saveWorkflow({ projectStatus: 'wrong_destination', projectError: `FAIL: la conversación figura en un proyecto distinto de «${target}». No se intentará mover otra vez automáticamente.` });
      } else {
        await saveWorkflow({ projectStatus: 'unverified', projectError: 'Se eligió el proyecto, pero ChatGPT no ha mostrado una prueba inequívoca de que el chat se haya movido. Verifícalo antes de reintentar.' });
      }
    } catch (err) {
      try { await saveWorkflow({ projectStatus: 'manual', projectError: `Migración detenida: ${workflowErrorText(err)}` }); } catch (_) {}
    } finally {
      moveBusy = false;
    }
  }

  // RELEVO ENTRE CHATS: no modifica ni elimina la conversación anterior.
  // El destino se obtiene de un proyecto real visible o de la URL del propio chat.
  function projectHomeForHandoff() {
    // La URL del chat dentro de un proyecto es la fuente de verdad. La barra
    // lateral puede estar plegada y no debe impedir iniciar un chat nuevo.
    const inProject = currentProjectFromUrl();
    if (inProject) {
      return { url: `${location.origin}/g/${encodeURIComponent(inProject)}/project`, projectId: inProject };
    }
    // Solo usar un proyecto externo si existe una selección explícita de destino.
    const target = cleanText(workflow?.projectTarget);
    if (target) {
      const id = destinationProjectId(target);
      if (!id) return { error: `No se puede identificar el proyecto destino «${target}». No se enviará a uno equivocado.` };
      return { url: `${location.origin}/g/${encodeURIComponent(id)}/project`, projectId: id };
    }
    return { url: `${location.origin}/`, projectId: '' };
  }

  function visibleTranscript() {
    const blocks = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
    const ordered = blocks.length ? blocks : [...document.querySelectorAll('[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"]')];
    const messages = ordered.map(node => {
      const role = node.getAttribute('data-message-author-role') ||
        (node.getAttribute('data-chatgpt-search-unit-key') || '').split(':').pop();
      const body = node.querySelector('.markdown, [data-markdown-text-style="assistant-message"]') || node;
      const txt = cleanText(body.innerText || body.textContent || '');
      return { role, text: txt.slice(0, 3500) };
    }).filter(item => item.text && ['user','assistant'].includes(item.role));
    const firstUser = messages.find(item => item.role === 'user');
    const tail = messages.slice(-18);
    if (firstUser && !tail.includes(firstUser)) tail.unshift({ role: 'user', text: `OBJETIVO ORIGINAL: ${firstUser.text.slice(0,1800)}` });
    // Presupuesto total: evitar un mensaje inmanejable para el chat nuevo.
    let remaining = 5200;
    const kept = [];
    for (let i = tail.length - 1; i >= 0; i--) {
      if (remaining < 200) break;
      const item = tail[i];
      const text = item.text.slice(-Math.min(item.text.length, remaining, 2200));
      kept.unshift({ role: item.role, text });
      remaining -= text.length + 30;
    }
    return kept;
  }

  function generatedFileLinks() {
    // Enlaces realmente incluidos en mensajes del asistente; no confundir
    // el nombre escrito en una respuesta con un archivo descargable.
    const chosen = [];
    const seen = new Set();
    const nodes = assistantNodes();
    const suffix = /\.(?:zip|pdf|docx|xlsx|pptx|txt|md|json|csv|html|py|js|png|jpg|jpeg|webp)(?:$|[?#])/i;
    for (let i=nodes.length-1;i>=0 && chosen.length<40;i--) {
      const anchors = [...nodes[i].querySelectorAll('a[href],a[download]')];
      for (let j=anchors.length-1;j>=0 && chosen.length<40;j--) {
        const a=anchors[j];
        const href=a.getAttribute('href')||'';
        // Enlaces Drive son referencias persistentes, no ZIP descargables
        // temporales que deban transferirse desde el chat anterior.
        if (AutoSigueDrive.normalize(href)) continue;
        const label=cleanText(a.getAttribute('download')||a.getAttribute('title')||a.innerText||a.textContent||'');
        let decoded=href;
        try {decoded=decodeURIComponent(href);}catch(_){}
        let name=(label.match(/([^\/\\<>|:*?"\n\r]{1,140}\.(?:zip|pdf|docx|xlsx|pptx|txt|md|json|csv|html|py|js|png|jpg|jpeg|webp))\b/i)||[])[1] ||
          (decoded.match(/([^\/\\<>|:*?"\n\r?#]{1,140}\.(?:zip|pdf|docx|xlsx|pptx|txt|md|json|csv|html|py|js|png|jpg|jpeg|webp))(?=$|[?#])/i)||[])[1];
        if (!name || !suffix.test(name) || seen.has(href)) continue;
        name=name.trim().split('/').pop();
        seen.add(href);
        chosen.push({name,href,turnIndex:i});
      }
    }
    // Preferir el ZIP actualizado más reciente y como máximo dos complementarios.
    const zip=chosen.find(x=>/\.zip$/i.test(x.name));
    return (zip ? [zip,...chosen.filter(x=>x!==zip)] : chosen).slice(0,3);
  }

  function visibleDriveArtifacts() {
    const found = [], seen = new Set();
    const nodes = assistantNodes();
    // Solo respuestas del asistente. Nunca leer enlaces de mensajes del usuario
    // o de otras páginas. Se prioriza el enlace publicado más recientemente.
    for (let i=nodes.length-1; i>=0 && found.length<3; i--) {
      const node = nodes[i];
      const candidates = [];
      for (const a of node.querySelectorAll('a[href]')) candidates.push(a.href || a.getAttribute('href'));
      candidates.push(...AutoSigueDrive.inText(assistantText(node)).map(e=>e.url));
      for (let j=candidates.length-1; j>=0 && found.length<3; j--) {
        const ref=AutoSigueDrive.normalize(candidates[j]);
        if (!ref || seen.has(ref.id)) continue;
        seen.add(ref.id);
        found.push(ref);
      }
    }
    return found;
  }

  function newestDriveMarker() {
    const nodes = assistantNodes();
    for(let i=nodes.length-1;i>=0;i--){
      const marker=AutoSigueDrive.latestMarker(assistantText(nodes[i]));
      if(marker) return {...marker,turnIndex:i};
    }
    return {state:'missing',ref:null,turnIndex:-1};
  }

  async function rememberDriveArtifacts() {
    if (!chatKey.startsWith('c:') || !selectedForThisChat()) return;
    const fresh = visibleDriveArtifacts();
    if (!fresh.length) return;
    const data = await chrome.storage.local.get({ driveArtifactsByChat:{} });
    const prior = data.driveArtifactsByChat?.[chatKey] || [];
    const seen=new Set(), combined=[];
    for(const ref of [...fresh,...prior]) {
      const parsed=AutoSigueDrive.normalize(ref?.url);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);combined.push(parsed);
      if(combined.length>=3)break;
    }
    if (JSON.stringify(combined)===JSON.stringify(prior)) return;
    await chrome.storage.local.set({driveArtifactsByChat:{...data.driveArtifactsByChat,[chatKey]:combined}});
  }

  async function availableDriveArtifacts() {
    const latest=visibleDriveArtifacts();
    const data=await chrome.storage.local.get({driveArtifactsByChat:{}});
    const previous=data.driveArtifactsByChat?.[chatKey] || [];
    const list=[], seen=new Set();
    for(const ref of [...latest,...previous]) {
      const parsed=AutoSigueDrive.normalize(ref?.url);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);list.push(parsed);
      if(list.length===3)break;
    }
    return list;
  }

  function buildHandoffPrompt(reason, driveArtifacts, drivePending) {
    const transcript = visibleTranscript();
    const remaining = workflow?.enabled && Array.isArray(workflow.steps) ?
      workflow.steps.slice(Math.max(0, workflow.nextIndex || 0)).map((step,i)=> `Pendiente ${i+1}: ${step.slice(0,900)}`).join('\n') : '';
    const tail = transcript.map((item, i) => `[${i+1}] ${item.role === 'user' ? 'USUARIO' : 'ASISTENTE'}: ${item.text}`).join('\n\n');
    return `CONTINUACIÓN AUTOMÁTICA DE CONVERSACIÓN (Auto-Sigue v2.7)\n` +
      `Chat de origen: ${location.href}\nMotivo del relevo: ${reason}\n` +
      `[NORMA DE ENTREGABLES] ${ZIP_CONTINUITY_RULE}\n` +
      (driveArtifacts.length ? `REFERENCIAS DE ARCHIVOS GUARDADAS EN GOOGLE DRIVE (enlaces aportados por el asistente anterior, acceso y contenido NO verificados por la extensión):\n${driveArtifacts.map(f=>f.url).join('\n')}\nAbre estos archivos con tu conector de Google Drive autorizado antes de modificar el proyecto. Verifica que tienes acceso y que el ZIP contiene la versión correcta. Si el conector no está disponible, solicita conexión o acceso; no inventes contenido ni afirmes haber recuperado el ZIP.\n` : '') +
      (drivePending ? `ATENCIÓN: el chat anterior mostró un ZIP, pero NO se detectó un enlace válido de Google Drive. Revisa el chat de origen o solicita que se suba; no afirmes que ya está guardado.\n` : '') +
      `Este es un chat NUEVO del mismo trabajo. El historial siguiente es una COPIA PARCIAL de los mensajes visibles, no una memoria completa ni una prueba de que las acciones se hayan ejecutado.\n\n` +
      `INSTRUCCIONES: Retoma el objetivo y las tareas pendientes sin repetir cambios ni acciones que puedan duplicarse. ` +
      `Lee el contexto, identifica estado, errores y siguiente paso. Antes de dar nada por hecho, compruébalo. ` +
      `Si el trabajo se terminó realmente, informa del resultado y no inventes tareas. No marques hechos no verificados como OK.\n` +
      (remaining ? `\nPASOS TODAVÍA PENDIENTES (no dupliques el paso en curso):\n${remaining}\n` : '') +
      `\nÚLTIMOS MENSAJES VISIBLES DEL CHAT ANTERIOR:\n${tail || '(No se han podido leer mensajes; abre el enlace de origen y revisa antes de continuar.)'}\n\n` +
      `Empieza con un resumen muy breve de estado (OK/FAIL/NO COMPROBABLE) y CONTINÚA con el siguiente trabajo pendiente cuando sea seguro. No repitas automáticamente operaciones irreversibles.`;
  }

  async function handoffRequest(reason, manual = false, useNativeLimitButton = false) {
    return {ok:false,error:'Auto Sigue no abre otro chat.'};
    if (handoffBusy || !selectedForThisChat() || !chatKey.startsWith('c:') || getChatKey() !== chatKey) return { ok: false, error: 'Chat no autorizado o cambio de conversación.' };
    if (!manual && !handoffOptions.auto) return { ok: false, error: 'Relevo automático no activado.' };
    if (isAnswering() || sendBusy || workflowBusy) return { ok: false, error: 'ChatGPT aún responde o está enviando un mensaje.' };
    const target = projectHomeForHandoff();
    if (target.error) return { ok: false, error: target.error };
    const nativeButton = useNativeLimitButton ? nativeLimitButton() : null;
    handoffBusy = true;
    try {
      // La extensión NO descarga ni sube archivos. Solo recoge URLs que ya
      // aparezcan en respuestas del asistente y las envía al chat nuevo.
      const newestZip=generatedFileLinks().find(f=>/\.zip$/i.test(f.name));
      const marker=newestDriveMarker();
      // Un vínculo antiguo o genérico no acredita el último ZIP.
      const currentZipUrl=marker.state==='url' && (!newestZip || marker.turnIndex>=newestZip.turnIndex);
      const drivePending=Boolean(newestZip && !currentZipUrl);
      const driveArtifacts=newestZip
        ? (currentZipUrl ? [marker.ref] : [])
        : (marker.state==='url' ? [marker.ref] : await availableDriveArtifacts());
      if(drivePending){
        lastAction='Último ZIP sin DRIVE_ZIP_URL actual; conservar pestaña de origen';
        lastError=marker.state==='not_uploaded'
          ? 'El asistente indicó NO_SUBIDO para el ZIP más reciente.'
          : 'No hay URL explícita de Drive para el ZIP más reciente.';
      }
      const payload = {
        driveArtifacts,drivePending,sourceKey: chatKey, sourceUrl: location.href, sourceTitle: chatTitle(),
        targetUrl: target.url, projectId: target.projectId, reason,
        prompt: buildHandoffPrompt(reason, driveArtifacts, drivePending),
        flow: workflow?.enabled ? {
          ...workflow, state: 'paused', error: 'Relevo de conversación: comprueba el primer mensaje antes de reintentar pasos.',
          projectStatus: 'not_requested', autoMove: false, handoffParent: chatKey
        } : null
      };
      if (payload.prompt.length > 25000) return { ok: false, error: 'El traspaso es demasiado extenso.' };
      // Abrir con chrome.tabs.create: NO depender del clic nativo, que en
      // ChatGPT puede quedarse en la portada, navegar SPA o no crear pestaña.
      const response = await chrome.runtime.sendMessage({ type: 'HANDOFF_START', payload, manual });
      handoffStatus = response?.status || handoffStatus;
      if (!response?.ok) return { ok: false, error: response?.error || 'No se pudo crear la conversación nueva.' };
      // La pestaña nueva ya se ha creado en background; el aviso nativo sigue
      // siendo útil para diagnóstico, pero NO se pulsa. La pestaña vieja se
      // conserva y el destino recibe el trabajo mediante HANDOFF_LOOKUP.
      lastAction = `Chat nuevo solicitado en pestaña ${response.tabId || '?'}; preparando contexto`;
      handoffTrigger = useNativeLimitButton ? 'LIMITE_VISIBLE' : 'RELEVO_CONFIGURADO';
      lastError = '';
      return { ok: true, status: handoffStatus };
    } finally {
      handoffBusy = false;
      await publishStatus();
    }
  }

  async function maybeAutomaticHandoff(reason, nativeLimit = false) {
    return;
    if (!settings.enabled || !handoffOptions.auto || !selectedForThisChat()) return;
    if (nativeLimit && nativeLimitClickAttempted) return;
    if (handoffStatus && ['opening','opened','sending','sent','confirmed'].includes(handoffStatus.state)) return;
    const result = await handoffRequest(reason, false, nativeLimit);
    if (!result.ok && result.error) {
      lastError = `Relevo: ${result.error}`;
      lastAction = 'Relevo no confirmado';
    }
  }

  async function ensureProjectComposer(job) {
    let editor = getComposer();
    if (editor) return editor;
    if (!job.projectId || currentProjectFromUrl() !== job.projectId) return null;
    // Un proyecto puede abrir su portada, sin caja de redacción. Entrar al
    // NUEVO chat del mismo proyecto; jamás pulsar el botón global de nueva conversación.
    const links = Array.from(document.querySelectorAll('a[href]'));
    const matching = links.filter(a => {
      if (!isVisible(a)) return false;
      try {
        const u = new URL(a.href, location.href);
        return u.origin === location.origin && projectIdInPath(u.pathname) === job.projectId &&
          !chatIdInPath(u.pathname) && /new|chat|nuevo|nueva/i.test(elementLabel(a));
      } catch (_) { return false; }
    });
    const btns = Array.from(document.querySelectorAll('main button')).filter(btn =>
      isVisible(btn) && /^(?:nuevo chat|nueva conversación|new chat|start a chat|iniciar chat)(?:\s+(?:en|in|para|for)\s+.+)?$/i.test(elementLabel(btn)));
    const candidate = matching.length === 1 ? matching[0] : (btns.length === 1 ? btns[0] : null);
    if (!candidate) return null;
    if (candidate.tagName === 'A') {
      const u = new URL(candidate.href,location.href);
      if (projectIdInPath(u.pathname) !== job.projectId) return null;
    }
    if (clickedProjectNewChat) return null;
    clickedProjectNewChat = true;
    candidate.click();
    for (let i=0;i<60;i++) {
      await sleep(250);
      if (currentProjectFromUrl() !== job.projectId) return null;
      editor = getComposer();
      if (editor) return editor;
    }
    return null;
  }

  // La presencia del marcador en cualquier <article> NO demuestra el envío:
  // ChatGPT puede reflejar el borrador en vistas auxiliares del compositor.
  // Aceptar exclusivamente un turno identificado como escrito por el usuario.
  function sentUserTurn(marker) {
    if (!marker) return null;
    const editor = getComposer();
    const nodes = [...new Set(userNodes())];
    return nodes.find(node => {
      if (!node.isConnected || (editor && node.contains(editor))) return false;
      const text = cleanText(node.innerText || node.textContent || '');
      return text.includes(marker);
    }) || null;
  }

  function markerSentInChat(marker) {
    return Boolean(sentUserTurn(marker));
  }

  // Confirmación fuerte: después del turno de usuario debe haber empezado
  // una respuesta del asistente. El texto en un borrador o la URL /c/ no bastan.
  function assistantAcceptedHandoff(marker) {
    const sent = sentUserTurn(marker);
    if (!sent || activeUiError()) return false;
    for (const reply of assistantNodes()) {
      if (!reply.isConnected || reply === sent) continue;
      const position = sent.compareDocumentPosition(reply);
      if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (assistantText(reply).length >= 8) return true;
    }
    return false;
  }

  async function waitForHandoffMessage(marker, timeout = 20000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (markerSentInChat(marker)) return true;
      await sleep(250);
    }
    return false;
  }

  async function waitForAssistantAcceptance(marker, timeout = 60000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (assistantAcceptedHandoff(marker)) return true;
      if (activeUiError()) throw new Error('ChatGPT mostró un error tras enviar; se conserva el chat anterior.');
      await sleep(350);
    }
    return false;
  }

  async function finalizeHandoff(job, attachedNames) {
    const until = Date.now() + 30000;
    while (!chatIdInPath(location.pathname) && Date.now() < until) await sleep(250);
    const newKey = chatIdInPath(location.pathname) ? getChatKey() : '';
    if (!newKey.startsWith('c:') || newKey === job.sourceKey)
      throw new Error('Nuevo chat sin ID distinto al anterior; no se confirma ni se cierra la pestaña original.');
    if (!markerSentInChat(job.marker))
      throw new Error('No hay un mensaje de USUARIO con el marcador. La pestaña original se conserva.');
    if (!assistantAcceptedHandoff(job.marker))
      throw new Error('No se ha iniciado una respuesta de la IA al mensaje de relevo. No se cerrará la pestaña anterior.');
    const finish = await chrome.runtime.sendMessage({ type: 'HANDOFF_COMPLETE', sourceKey: job.sourceKey,
      state: 'confirmed', responseConfirmed: true, filesAttached: attachedNames, newKey, newUrl: location.href });
    if (!finish?.ok) throw new Error('Respuesta iniciada; activación/cierre pendientes: ' + (finish?.error || 'sin confirmación'));
    lastAction = finish.activated ? (finish.sourceClosed ?
      'OK: IA respondiendo, Auto-Sigue activado y pestaña antigua cerrada' :
      'PARCIAL: IA respondiendo y Auto-Sigue activado; pestaña anterior conservada') :
      'PARCIAL: IA respondiendo, activación no confirmada';
    if (finish.error) lastError = finish.error;
    handledTurnId = turnId(latestAssistant());
    await syncChatState();
    return finish;
  }

  async function receiveHandoff() {
    return;
    if (handoffReceiveBusy || receivedHandoffId) return;
    const found = await chrome.runtime.sendMessage({ type: 'HANDOFF_LOOKUP' });
    if (!found?.job || !['opened', 'sending'].includes(found.job.state)) return;
    const job = found.job;
    if (job.projectId && currentProjectFromUrl() !== job.projectId &&
      !(job.state === 'sending' && job.claimedInProject && chatIdInPath(location.pathname))) {
      lastError = 'La pestaña nueva no está en el proyecto esperado; no se enviará a otro proyecto.';
      return;
    }
    // En caso de recarga o navegación SPA, nunca repetir un clic cuyo resultado
    // puede ser ambiguo. Solo terminar el relevo tras comprobar la respuesta.
    if (job.state === 'sending') {
      if (!assistantAcceptedHandoff(job.marker)) {
        lastAction = markerSentInChat(job.marker) ? 'Esperando respuesta de ChatGPT para cerrar el chat anterior' :
          'Envío pendiente de confirmación; pestaña anterior conservada';
        return;
      }
      handoffReceiveBusy = true;
      try {
        await finalizeHandoff(job, []);
        receivedHandoffId = job.sourceKey;
      } catch (e) { lastError = workflowErrorText(e); }
      finally { handoffReceiveBusy = false; await publishStatus(); }
      return;
    }
    if (isAnswering() || userNodes().length || assistantNodes().length) return;
    if (Date.now() - lastHandoffPageAttempt < 3000) return;
    lastHandoffPageAttempt = Date.now();
    let editor = await ensureProjectComposer(job);
    if (!editor) {
      lastAction = 'Esperando editor del chat nuevo';
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'esperando_editor' }).catch(() => {});
      return;
    }
    if (editorText(editor)) {
      lastAction = 'Hay un borrador en el chat nuevo; no se sobrescribe';
      return;
    }
    const claim = await chrome.runtime.sendMessage({ type: 'HANDOFF_CLAIM', sourceKey: job.sourceKey });
    if (!claim?.ok) { lastError = claim?.error || 'No se pudo reservar el envío'; return; }
    handoffReceiveBusy = true;
    let clickWasAttempted = false;
    try {
      const text = job.prompt;
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'escribiendo_mensaje' }).catch(() => {});
      let method = await putText(editor, text);
      if (!method) {
        await sleep(500);
        editor = getComposer() || editor;
        method = await putText(editor, text);
      }
      if (!method || editorText(editor) !== cleanText(text))
        throw new Error('El editor no ha aceptado el contexto; no se enviará un mensaje vacío.');
      const button = await waitForEnabledSend(15000);
      if (!button || isAnswering()) throw new Error('ChatGPT no ha habilitado Enviar.');
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'pulsando_enviar' }).catch(() => {});
      // Guardar primero el intento: así una recarga no repetirá el mensaje.
      const marked = await chrome.runtime.sendMessage({ type: 'HANDOFF_MARK_CLICK' });
      if (!marked?.ok) throw new Error(marked?.error || 'No se ha podido registrar el envío.');
      clickWasAttempted = true;
      button.click();
      // Segunda vía controlada: solo cuando el texto SIGUE en el compositor y
      // NO existe un turno de usuario. Nunca repetir si el clic pudo enviarlo.
      if (!(await waitForHandoffMessage(job.marker, 5000))) {
        const currentEditor = getComposer();
        const form = currentEditor?.closest('form');
        if (form && typeof form.requestSubmit === 'function' &&
            currentEditor && editorText(currentEditor) === cleanText(text) &&
            !markerSentInChat(job.marker) && !isAnswering()) {
          const submit = getSendButton();
          if (submit && submit.form === form && !submit.disabled) {
            await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'segundo_metodo_requestSubmit' }).catch(() => {});
            try { form.requestSubmit(submit); } catch (_) { /* no repetir a ciegas */ }
          }
        }
      }
      if (!(await waitForHandoffMessage(job.marker, 16000)))
        throw new Error('Enviar no produjo un turno de usuario confirmado. No se cerrará la pestaña antigua.');
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'esperando_respuesta_ia' }).catch(() => {});
      if (!(await waitForAssistantAcceptance(job.marker, 70000)))
        throw new Error('El mensaje está visible, pero la IA aún no ha respondido. Se conserva la pestaña anterior.');
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS', stage: 'activando_y_cerrando' }).catch(() => {});
      await finalizeHandoff(job, []);
      receivedHandoffId = job.sourceKey;
    } catch (e) {
      lastError = workflowErrorText(e);
      lastAction = clickWasAttempted ?
        'NO COMPROBABLE: envío sin respuesta confirmada, original conservado' :
        'FAIL: no se ha enviado; se volverá a intentar si es seguro';
      await chrome.runtime.sendMessage({ type: 'HANDOFF_PROGRESS',
        stage: clickWasAttempted ? 'envio_sin_respuesta_confirmada' : 'fallo_antes_de_enviar', error: lastError }).catch(() => {});
      if (!clickWasAttempted) await chrome.runtime.sendMessage({ type: 'HANDOFF_RELEASE_PRECLICK', error: lastError }).catch(() => {});
    } finally { handoffReceiveBusy = false; await publishStatus(); }
  }

  async function workflowControl(msg) {
    if (!chatKey.startsWith('c:') || !selectedForThisChat()) return { ok: false, error: 'Autoriza este chat antes de iniciar una secuencia.' };
    if (msg.type === 'WORKFLOW_CONFIGURE') {
      if (['awaiting', 'sending', 'running'].includes(workflow?.state)) return { ok: false, error: 'Pausa o termina el flujo antes de editar los pasos.' };
      const steps = (Array.isArray(msg.steps) ? msg.steps : []).map(s => String(s).trim()).filter(Boolean);
      if (steps.length > 50 || steps.some(s => s.length > 12000)) return { ok: false, error: 'Máximo 50 pasos, 12.000 caracteres por paso.' };
      await saveWorkflow({ enabled: Boolean(msg.enabled), steps, state: 'idle', nextIndex: 0, runId: '', checkAttempts: 0,
        autoMove: Boolean(msg.autoMove), projectTarget: cleanText(msg.projectTarget).slice(0, 120), projectStatus: 'not_requested', projectError: '', error: '' });
      return { ok: true };
    }
    if (msg.type === 'WORKFLOW_START') {
      if (!settings.enabled || !allowedToSend()) return { ok: false, error: 'Auto-Sigue está desactivado.' };
      if (workflowBusy || sendBusy || isAnswering()) return { ok: false, error: 'ChatGPT está respondiendo o hay otro envío en curso.' };
      if (!workflow?.enabled || !workflow.steps?.length) return { ok: false, error: 'Configura primero los pasos.' };
      if (editorText(getComposer())) return { ok: false, error: 'Hay un borrador en el editor. No se sobrescribirá.' };
      await saveWorkflow({ state: 'running', runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2,9)}`, nextIndex: 0,
        checkAttempts: 0, error: '', projectStatus: 'not_requested', projectError: '', finishedAt: null });
      const ok = await sendWorkflowStep(0);
      return { ok, error: ok ? '' : (workflow?.error || lastError) };
    }
    if (msg.type === 'WORKFLOW_PAUSE') {
      if (workflow && ['awaiting', 'running', 'sending'].includes(workflow.state)) {
        await saveWorkflow({ state: 'paused', error: 'Pausado manualmente.' });
        return { ok: true };
      }
      return { ok: false, error: 'No hay una secuencia en marcha que pueda pausarse.' };
    }
    if (msg.type === 'WORKFLOW_RESUME') {
      if (!workflow?.enabled || !['paused', 'error'].includes(workflow.state)) return { ok: false, error: 'No hay un flujo pausado.' };
      // A manual resume never sends immediately: requires explicit retry to prevent duplicating work.
      return { ok: false, error: 'Para evitar duplicar acciones, pulsa «Reintentar paso» si has revisado el error.' };
    }
    if (msg.type === 'WORKFLOW_RETRY') {
      if (!workflow?.enabled || !['paused', 'error'].includes(workflow.state)) return { ok: false, error: 'La secuencia no está pausada.' };
      if (!allowedToSend() || isAnswering() || editorText(getComposer())) return { ok: false, error: 'Chat desactivado, IA respondiendo o editor ocupado.' };
      await saveWorkflow({ state: 'running', checkAttempts: 0, error: '' });
      const ok = await sendWorkflowStep(workflow.nextIndex || 0);
      return { ok, error: ok ? '' : (workflow?.error || lastError) };
    }
    if (false && msg.type === 'WORKFLOW_MOVE_RETRY') {
      if (!workflow?.autoMove || workflow?.state !== 'done') return { ok: false, error: 'No hay migración pendiente.' };
      await saveWorkflow({ projectStatus: 'pending' });
      /* Cambio automático de chat/proyecto deshabilitado. */
      return { ok: ['moved', 'already_in_project'].includes(workflow?.projectStatus), status: workflow?.projectStatus, error: workflow?.projectError };
    }
    return { ok: false, error: 'Orden desconocida.' };
  }

  async function scan() {
    await syncChatState();
    if (!chatKey.startsWith('c:') || !selectedForThisChat()) {
      // Recepción de otros chats deshabilitada.
    }

    const info = latestAssistant();
    if (info.text && !isAnswering()) await rememberDriveArtifacts();
    const fp = assistantFingerprint(info);
    if (fp !== lastAssistantFingerprint) {
      lastAssistantFingerprint = fp;
      lastAssistantChangeAt = Date.now();
      stableSamples = 0;
    } else if (info.text) {
      stableSamples += 1;
    }

    // Prioridad absoluta: el aviso real de longitud máxima invalida todo envío
    // adicional en el chat viejo, incluso si se alcanzó HE ACABADO o un paso falló.
    const limitSignal = findLimitSignal();
    const limitNow = limitSignal.seen;
    limitBannerSeen = Boolean(limitNow);
    limitButtonSeen = limitNow && Boolean(limitSignal.button);
    limitDetectionReason = limitSignal.reason;
    if (limitNow) {
      if (handoffStatus?.state === 'confirmed' && handoffStatus?.newKey) {
        limitHandoffAttempted = true;
        lastAction = 'Relevo confirmado anteriormente: ' + handoffStatus.newKey;
      }
      // La detección NO depende de haber recibido una respuesta recientemente,
      // del contador de continuaciones ni de si el editor admite más texto.
      if (false && settings.enabled && selectedForThisChat() && handoffOptions.auto && !isAnswering() &&
          !limitHandoffAttempted && limitAttemptCount < 3 &&
          Date.now() - limitLastAttemptAt >= (limitAttemptCount >= 2 ? 50000 : 3500)) {
        limitAttemptCount++;
        limitLastAttemptAt = Date.now();
        const result = await handoffRequest('Límite real de longitud máxima de ChatGPT', false, true);
        if (result.ok) {
          limitHandoffAttempted = true;
          lastAction = 'Chat nuevo abierto por aviso de longitud maxima';
        } else {
          lastError = `Relevo del límite: ${result.error}`;
          lastAction = 'FAIL: no se ha creado un chat nuevo';
        }
      } else if (!selectedForThisChat()) {
        lastAction = 'Aviso detectado, pero Auto-Sigue NO está activado en este chat';
      } else if (!handoffOptions.auto) {
        lastAction = 'Aviso detectado, pero el relevo automático está desactivado';
      } else if (!settings.enabled) {
        lastAction = 'Aviso detectado, pero Auto-Sigue está pausado globalmente';
      }
      await publishStatus();
      return;
    }
    if (selectedForThisChat() && !workflowEnabled() && info.text && isEndPhrase(info.text) && !isAnswering()) {
      if (!stopped) await markStopped();
      return;
    }
    const answering = isAnswering();
    if (answering) {
      if (!answeringSince) answeringSince = Date.now();
    } else if (!watchdogBusy) {
      answeringSince = null;
    }

    // Recuperar migraciones interrumpidas por navegación; comprobar antes de reintentar.
    if (workflow?.projectStatus === 'moving' && !moveBusy && workflow.projectStartedAt &&
        Date.now() - workflow.projectStartedAt > 12500) {
      if (isCorrectProject(workflow.projectTarget, workflow.projectExpectedId)) {
        await saveWorkflow({ projectStatus: 'moved', projectError: '', projectMovedAt: Date.now() });
      } else {
        await saveWorkflow({ projectStatus: 'unverified', projectError: 'La página cambió durante la migración y no se ha podido comprobar el destino. Revisa el proyecto antes de reintentar.' });
      }
    }

    if (workflowEnabled()) {
      const uiError = activeUiError();
      if (workflow?.state === 'sending' && Date.now() - (workflow.lastStepSentAt || 0) > 45000) {
        await saveWorkflow({ state: 'error', error: 'Envío interrumpido. Revisa si se envió antes de reintentar.' });
      } else if (uiError && ['awaiting', 'running'].includes(workflow?.state)) {
        await saveWorkflow({ state: 'error', error: `Error de interfaz: ${uiError}` });
      } else if (workflowReady() || workflow?.state === 'awaiting') {
        await handleWorkflowAnswer();
      }
      await publishStatus();
      return;
    }

    if (allowedToSend() && maxReached() && !answering && info.text) {
      const delay = Math.max(2500, (Number(settings.finishDelaySeconds) || 3) * 1000);
      if (Date.now() - lastAssistantChangeAt > delay) lastAction = 'Máximo de continuaciones alcanzado; no se cambia de chat';
    }
    if (!allowedToSend() || sendBusy || maxReached() || answering || !info.text) {
      await publishStatus();
      return;
    }

    const id = turnId(info);
    const delayMs = Math.max(1200, (Number(settings.finishDelaySeconds) || 3) * 1000);
    const stableLongEnough = Date.now() - lastAssistantChangeAt >= delayMs && stableSamples >= 3;

    if (stableLongEnough && id && id !== handledTurnId && Date.now() >= nextRetryAt) {
      const attempts = failedTurnAttempts.get(id) || 0;
      if (attempts === 0) {
        const ok = await sendContinue('Respuesta terminada');
        if (ok) handledTurnId = id;
        else if (!stopped) {
          failedTurnAttempts.set(id, 1);
          lastAction = 'Auto-Sigue detenido en este turno: pulsa Enviar «sigue» para reintentar manualmente';
          nextRetryAt = Date.now() + SEND_RETRY_COOLDOWN_MS;
        }
      }
    }

    await watchdog();
    await publishStatus();
  }

  function getStatus() {
    const info = latestAssistant();
    const send = getSendButton();
    const composer = getComposer();
    const status = {
      version: VERSION,
      sendStage, sending: sendBusy, lastAction, lastError,
      workflow: workflow ? { ...workflow } : null,
      handoffOptions: { ...handoffOptions },
      handoffStatus: handoffStatus ? { ...handoffStatus } : null,
      uiError: activeUiError(),
      chatKey,
      enabled: settings.enabled,
      selected: selectedForThisChat(),
      chatTitle: chatTitle(),
      stopped,
      continueCount,
      answering: isAnswering(),
      composerFound: Boolean(composer),
      sendButtonFound: Boolean(send),
      sendButtonEnabled: Boolean(send && !send.disabled && send.getAttribute('aria-disabled') !== 'true'),
      latestAssistantPreview: info.text.slice(0, 160),
      latestAssistantLength: info.text.length,
      stableForMs: Date.now() - lastAssistantChangeAt,
      stableSamples,
      lastAction,
      lastError,
      lastSendMethod,
      failedAttemptsForTurn: failedTurnAttempts.get(turnId(info)) || 0,
      maxReached: maxReached(),
      limitBannerSeen,
      limitButtonSeen,
      nativeLimitClickAttempted,
      limitHandoffAttempted,
      limitAttemptCount,
      limitDetectionReason,
      handoffTrigger,
      nextHandoffEnabled: Boolean(handoffOptions.auto),
      url: location.href
    };
    return status;
  }

  async function publishStatus() {
    try { await chrome.storage.local.set({ runtimeStatus: getStatus() }); } catch (_) {}
  }

  async function load() {
    const data = await chrome.storage.local.get({ ...DEFAULTS, stoppedChats: {}, enabledChats: {}, workflowByChat: {}, handoffOptionsByChat: {}, handoffStatusByChat: {} });
    settings = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) settings[key] = data[key];
    stopped = Boolean(data.stoppedChats?.[chatKey]);
    enabledChats = data.enabledChats || {};
    workflow = data.workflowByChat?.[chatKey] || null;
    handoffOptions = readHandoffOptions(data.handoffOptionsByChat?.[chatKey]);
    handoffStatus = data.handoffStatusByChat?.[chatKey] || null;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    if (changes.handoffOptionsByChat) {
      const next = readHandoffOptions(changes.handoffOptionsByChat.newValue?.[chatKey]);
      if (!handoffOptions.auto && next.auto) limitHandoffAttempted = false;
      handoffOptions = next;
    }
    if (changes.handoffStatusByChat) handoffStatus = changes.handoffStatusByChat.newValue?.[chatKey] || null;
    if (changes.workflowByChat) {
      workflow = changes.workflowByChat.newValue?.[chatKey] || null;
    }
    if (changes.enabledChats) {
      const wasSelected = selectedForThisChat();
      enabledChats = changes.enabledChats.newValue || {};
      const nowSelected = selectedForThisChat();
      if (!wasSelected && nowSelected) {
        // El usuario acaba de habilitar expresamente esta conversación.
        // El último turno terminado queda pendiente de procesar UNA vez.
        lastAction = 'Auto-Sigue activado en este chat';
      } else if (wasSelected && !nowSelected) {
        answeringSince = null;
        lastAction = 'Auto-Sigue desactivado en este chat';
      }
    }
  });

  // Menú asociado inequívocamente al enlace del chat original. En algunos
  // diseños el botón aparece en el DOM pero solo es visible al pasar el ratón.
  function deleteSourceMenuTrigger() {
    const direct = currentChatSidebarTrigger() || headerChatMenuTrigger();
    if (direct) return direct;
    const links=[...document.querySelectorAll('nav a[href], aside a[href], [data-testid*="sidebar"] a[href]')]
      .filter(a=>{try{return chatIdInPath(new URL(a.href,location.href).pathname)===chatKey.slice(2);}catch(_){return false;}});
    if(links.length!==1) return null;
    const row=links[0].closest('[data-testid^="history-item"], [data-testid*="conversation-item"], [data-testid*="chat-item"],li,[role="listitem"]') || links[0].parentElement;
    if(!row || row.querySelectorAll('a[href*="/c/"]').length!==1) return null;
    const btn=[...row.querySelectorAll('button')].filter(b=>!b.disabled && isMenuTrigger(b));
    // Nunca pulsar un botón genérico distinto del de menú asociado al chat.
    return btn.length===1 ? btn[0] : null;
  }

  // Borrado conservador en la interfaz visible del chat original.
  // Se rechazan menús ambiguos y jamás se elimina mediante endpoints privados.
  let deleteSourceBusy = false;
  async function deleteHandoffSource(sourceKey, newKey) {
    if (deleteSourceBusy) return {ok:false,error:'Ya existe un borrado en curso.'};
    if (!/^c:[\w-]{8,}$/.test(newKey) || newKey === sourceKey ||
        sourceKey !== chatKey || getChatKey() !== sourceKey || !selectedForThisChat())
      return {ok:false,error:'La pestaña no muestra el chat original autorizado.'};
    const snapshot = await chrome.storage.local.get({handoffJobsBySource:{},handoffOptionsByChat:{}});
    const job = snapshot.handoffJobsBySource?.[sourceKey];
    const opts = snapshot.handoffOptionsByChat?.[sourceKey];
    if (job?.state !== 'confirmed' || job.newKey !== newKey ||
        !opts?.deleteOldChat || job.drivePending || job.zipPending ||
        !job.clickedAt || !job.finishedAt)
      return {ok:false,error:'Faltan confirmación del relevo, autorización de borrado o archivos.'};
    deleteSourceBusy = true;
    try {
      const trigger = deleteSourceMenuTrigger();
      if (!trigger) return {ok:false,error:'No se identifica el menú único de este chat; elimínalo manualmente.'};
      trigger.click();
      const deletion = await waitForMenuChoice(s => /^(?:eliminar|borrar|delete)(?:\s+(?:chat|conversation|conversación))?$/i.test(cleanText(s)),4500);
      if (!deletion) return {ok:false,error:'No hay una opción Eliminar única para el chat.'};
      deletion.click();
      // No aceptar botones "Eliminar" fuera del diálogo de confirmación.
      const until = Date.now()+6500;
      let confirmButton=null;
      while(Date.now()<until && !confirmButton) {
        const dialogs=[...document.querySelectorAll('[role="alertdialog"], [role="dialog"]')].filter(isVisible);
        const valid=dialogs.filter(d => /(?:eliminar|borrar|delete|permanently)/i.test(elementLabel(d)));
        const matches=valid.flatMap(d=>[...d.querySelectorAll('button')].filter(b=>isVisible(b)&&
          /^(?:eliminar|borrar|delete)(?:\s+(?:chat|conversation|conversación))?$/i.test(elementLabel(b))));
        if(matches.length===1) confirmButton=matches[0];
        else if(matches.length>1) return {ok:false,error:'Varias opciones de eliminación: no se pulsa ninguna.'};
        if(!confirmButton) await sleep(130);
      }
      if(!confirmButton) return {ok:false,error:'No se encuentra diálogo de confirmación de borrado.'};
      // A partir de aquí el clic es irreversible. Si la página cambia antes de
      // confirmarlo, devolver NO COMPROBABLE y no repetir jamás el clic.
      confirmButton.click();
      const originalId=sourceKey.slice(2);
      const waitUntil=Date.now()+9000;
      while(Date.now()<waitUntil) {
        const navigated = chatIdInPath(location.pathname) !== originalId;
        const oldLinks=[...document.querySelectorAll('nav a[href],aside a[href],[data-testid*="sidebar"] a[href]')]
          .filter(a=>{try{return chatIdInPath(new URL(a.href,location.href).pathname)===originalId;}catch(_){return false;}});
        if(navigated && oldLinks.length===0) return {ok:true,deleted:true};
        await sleep(170);
      }
      return {ok:false,error:'Se pulsó Eliminar pero no se pudo confirmar su desaparición. No reintentar automáticamente.'};
    } finally {deleteSourceBusy=false;}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (false && msg?.type === 'HANDOFF_DELETE_SOURCE') {
      deleteHandoffSource(String(msg.sourceKey||''),String(msg.newKey||''))
        .then(sendResponse).catch(err=>sendResponse({ok:false,error:String(err?.message||err)}));
      return true;
    }
    if (msg?.type?.startsWith('WORKFLOW_')) {
      workflowControl(msg)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: workflowErrorText(err) }));
      return true;
    }
    if (msg?.type === 'HANDOFF_CONFIGURE') {
      if (!chatKey.startsWith('c:') || !selectedForThisChat()) { sendResponse({ ok: false, error: 'Autoriza este chat.' }); return true; }
      const options = {};
      for (const key of ['auto','inheritMode']) {
        if (typeof msg[key] === 'boolean') options[key] = msg[key];
      }
      if (!Object.keys(options).length) { sendResponse({ok:false,error:'No hay ajustes válidos.'}); return true; }
      chrome.storage.local.get({ handoffOptionsByChat: {} }).then(data => {
        const updated = { ...readHandoffOptions(data.handoffOptionsByChat?.[chatKey]), ...options };
        const next = { ...data.handoffOptionsByChat, [chatKey]: updated };
        return chrome.storage.local.set({ handoffOptionsByChat: next }).then(() => updated);
      }).then(updated => { handoffOptions = updated; sendResponse({ ok: true }); })
        .catch(err => sendResponse({ ok: false, error: workflowErrorText(err) }));
      return true;
    }
    if(false && msg?.type==='HANDOFF_RESET'){
      chrome.runtime.sendMessage({type:'HANDOFF_RESET',sourceKey:chatKey})
        .then(result=>{
          if(result?.ok){handoffStatus=null;limitHandoffAttempted=false;limitAttemptCount=0;receivedHandoffId='';}
          sendResponse(result||{ok:false});
        }).catch(error=>sendResponse({ok:false,error:workflowErrorText(error)}));
      return true;
    }
    if (false && msg?.type === 'HANDOFF_NOW') {
      handoffRequest('Relevo manual solicitado por el usuario', true).then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: workflowErrorText(err) }));
      return true;
    }
    if (msg?.type === 'TEST_SEND') {
      (workflowEnabled() ? Promise.resolve(false) : sendContinue('Envío manual', { force: true }))
        .then(ok => sendResponse({ ok, lastError, lastSendMethod }))
        .catch(err => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (msg?.type === 'RESET_SEND_STATUS') {
      sendStage='';lastError='';lastAction='';nextRetryAt=0;ambiguousSend=false;
      if (stopped) {
        clearStoppedForChat().then(() => sendResponse({ok:true})).catch(error => sendResponse({ok:false,error:String(error)}));
        return true;
      }
      sendResponse({ok:true});return true;
    }
    if (msg?.type === 'REACTIVATE_CHAT') {
      clearStoppedForChat()
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
    if (msg?.type === 'GET_STATUS') {
      syncChatState().then(() => sendResponse({ ok: true, status: getStatus() })).catch(() => sendResponse({ ok: false }));
      return true;
    }
  });

  load().then(() => {
    async function guardedScan() {
      if (scanBusy) return;
      scanBusy = true;
      try {
        await scan();
      } catch (err) {
        lastError = `scan: ${String(err?.message || err)}`;
        await publishStatus();
      } finally {
        scanBusy = false;
      }
    }
    setInterval(guardedScan, LOOP_MS);
    setInterval(() => watchdog().catch(() => {}), 5000);
    guardedScan();
  });
})();

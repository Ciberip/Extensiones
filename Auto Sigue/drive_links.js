/* Enlaces de archivos Google Drive, sin OAuth, descargas ni cambio de permisos. */
(function (root) {
  'use strict';
  const ID_RE = /^[a-zA-Z0-9_-]{10,}$/;
  function normalize(raw) {
    if (typeof raw !== 'string' || raw.length > 2048) return null;
    let value = raw.trim().replace(/^[<(["']+/, '').replace(/[>),;.!\]"']+$/, '');
    let u;
    try { u = new URL(value); } catch (_) { return null; }
    if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com' || u.username || u.password) return null;
    let id = '';
    const match = u.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]{10,})(?:\/(?:view|preview|edit)\/?)?$/);
    if (match) id = match[1];
    else if (/^\/(?:open|uc)\/?$/.test(u.pathname)) id = u.searchParams.get('id') || '';
    if (!ID_RE.test(id)) return null;
    // Resource keys are required for some private files. Keep only this key;
    // no other user-supplied query parameters are copied into handoff links.
    const resourcekey = u.searchParams.get('resourcekey');
    const q = resourcekey && /^[a-zA-Z0-9_-]{3,250}$/.test(resourcekey)
      ? '?resourcekey=' + encodeURIComponent(resourcekey) : '';
    return { id, url: 'https://drive.google.com/file/d/' + id + '/view' + q };
  }
  function inText(text) {
    if (typeof text !== 'string' || !text) return [];
    const candidates = text.match(/https:\/\/drive\.google\.com\/(?:file\/d\/|open\?|uc\?)[^\s<>"'`]+/gi) || [];
    const out = [], seen = new Set();
    for (const s of candidates) {
      const entry = normalize(s);
      if (entry && !seen.has(entry.id)) { seen.add(entry.id); out.push(entry); }
    }
    return out;
  }
  // El marcador es una afirmación del asistente, NO una prueba de subida real.
  function latestMarker(text) {
    if (typeof text !== 'string' || !text) return null;
    const re = /(?:^|\s)DRIVE_ZIP_URL\s*:\s*(NO_SUBIDO|https:\/\/drive\.google\.com\/[^\s<>"'`]+)/gi;
    let match, last=null;
    while ((match=re.exec(text))) {
      if (/^NO_SUBIDO$/i.test(match[1])) last={state:'not_uploaded',ref:null};
      else {const ref=normalize(match[1]);last=ref?{state:'url',ref}:{state:'invalid',ref:null};}
    }
    return last;
  }
  const api = Object.freeze({ normalize, inText, latestMarker });
  root.AutoSigueDrive = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

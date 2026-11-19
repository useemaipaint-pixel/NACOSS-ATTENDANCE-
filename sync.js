/* NACOSS offline-first sync.
 * The app always reads/writes the phone's local storage (so it works with no network).
 * When online + configured, changed records are pushed to Supabase and other devices' changes are pulled.
 */
(function () {
  'use strict';
  var CFG = window.NACOSS_CONFIG || {};
  var URL_ = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '');
  var KEY = String(CFG.SUPABASE_KEY || '');
  var TABLE = CFG.TABLE || 'nacoss_records';
  var ENABLED = !!(URL_ && KEY);
  var DB_KEY = 'nacoss_offline_db_v2';
  var ST_KEY = 'nacoss_sync_state_v1';
  var COLLS = ['members', 'meetings', 'attendance'];
  var EVERY = Math.max(10, Number(CFG.SYNC_EVERY_SECONDS) || 30) * 1000;

  var status = ENABLED ? (navigator.onLine ? 'idle' : 'offline') : 'disabled';
  var pending = 0, running = false, again = false, timer = null, lastError = '';

  function ls(op, k, v) {
    try { return op === 'g' ? localStorage.getItem(k) : op === 's' ? localStorage.setItem(k, v) : localStorage.removeItem(k); }
    catch (e) { return null; }
  }
  function loadState() {
    try { var s = JSON.parse(ls('g', ST_KEY) || 'null'); if (s && s.snap) return s; } catch (e) {}
    return { snap: { members: {}, meetings: {}, attendance: {}, admin: {} }, since: '', init: false };
  }
  function saveState(s) { ls('s', ST_KEY, JSON.stringify(s)); }
  var VD_KEY = 'nacoss_empty_data_reset_v2';
  /* Make sure a local database exists (and the app's one-time "empty reset" is already marked done),
     so pulled online data is never wiped when the app starts for the first time on a new device. */
  function ensureDb() {
    if (!ls('g', DB_KEY)) {
      ls('s', DB_KEY, JSON.stringify({ version: '1.0.0',
        admin: { username: 'NACOSS', fullName: 'System Administrator', email: 'admin@nacoss.org', role: 'Super Admin', updatedAt: '2026-10-30T08:00:00Z' },
        members: [], meetings: [], attendance: [], auditLogs: [], backups: [] }));
    }
    if (ls('g', VD_KEY) !== '1') ls('s', VD_KEY, '1');
  }
  if (ENABLED) ensureDb();
  function readDb() { try { return JSON.parse(ls('g', DB_KEY) || 'null'); } catch (e) { return null; } }
  function writeDb(db) { ls('s', DB_KEY, JSON.stringify(db)); }

  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function hash(v) { // cyrb53
    var s = canon(v), h1 = 0xdeadbeef, h2 = 0x41c6ce57, c;
    for (var i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function setStatus(s, err) {
    status = s; lastError = err || '';
    try { window.dispatchEvent(new CustomEvent('nacoss-sync', { detail: { status: status, pending: pending, error: lastError, enabled: ENABLED } })); } catch (e) {}
  }

  /* map of id -> record for one collection of a db */
  function recMap(db, c) {
    var m = {};
    if (c === 'admin') { if (db.admin) m.admin = db.admin; return m; }
    (db[c] || []).forEach(function (r) { if (r && r.id != null) m[r.id] = r; });
    return m;
  }
  function allColls() { return COLLS.concat(['admin']); }

  /* find changed / deleted records vs. last synced snapshot */
  function diff(db, st) {
    var rows = [];
    allColls().forEach(function (c) {
      var cur = recMap(db, c), snap = st.snap[c] || {};
      Object.keys(cur).forEach(function (id) {
        if (snap[id] !== hash(cur[id])) rows.push({ collection: c, id: String(id), data: cur[id], deleted: false });
      });
      Object.keys(snap).forEach(function (id) {
        if (!(id in cur) && c !== 'admin') rows.push({ collection: c, id: String(id), data: null, deleted: true });
      });
    });
    return rows;
  }

  function headers(extra) {
    var h = { apikey: KEY };
    if (KEY.indexOf('sb_') !== 0) h.Authorization = 'Bearer ' + KEY; /* new sb_publishable keys are not JWTs */
    for (var k in extra) h[k] = extra[k];
    return h;
  }
  function withTimeout(ms) {
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ac) ac.abort(); }, ms);
    return { signal: ac && ac.signal, done: function () { clearTimeout(t); } };
  }

  async function push(st) {
    var db = readDb(); if (!db) return;
    var rows = diff(db, st);
    pending = rows.length;
    if (!rows.length) return;
    var i = 0;
    while (i < rows.length) {
      var batch = [], size = 0;
      while (i < rows.length && batch.length < 100 && size < 900000) {
        var r = rows[i++]; batch.push(r); size += JSON.stringify(r).length;
      }
      var tt = withTimeout(30000);
      var res;
      try {
        res = await fetch(URL_ + '/rest/v1/' + TABLE + '?on_conflict=collection,id', {
          method: 'POST', signal: tt.signal,
          headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(batch)
        });
      } finally { tt.done(); }
      if (!res.ok) throw new Error('Push failed (' + res.status + '): ' + (await res.text()).slice(0, 160));
      batch.forEach(function (r) {
        var snap = st.snap[r.collection] || (st.snap[r.collection] = {});
        if (r.deleted) delete snap[r.id]; else snap[r.id] = hash(r.data);
      });
      pending = Math.max(0, pending - batch.length);
      saveState(st);
    }
  }

  /* returns true if local data was changed by remote records */
  async function pull(st) {
    var first = !st.init, since = st.since, offset = 0, maxSeen = since, changed = false, PAGE = 500;
    var db = readDb(); if (!db) return false;
    for (;;) {
      var q = '?select=collection,id,data,deleted,updated_at&order=updated_at.asc,collection.asc,id.asc&limit=' + PAGE + '&offset=' + offset;
      if (since) q += '&updated_at=gte.' + encodeURIComponent(since);
      var tt = withTimeout(30000), res;
      try { res = await fetch(URL_ + '/rest/v1/' + TABLE + q, { headers: headers({}), signal: tt.signal }); }
      finally { tt.done(); }
      if (!res.ok) throw new Error('Pull failed (' + res.status + '): ' + (await res.text()).slice(0, 160));
      var rows = await res.json();
      rows.forEach(function (r) {
        if (r.updated_at && r.updated_at > maxSeen) maxSeen = r.updated_at;
        if (applyRemote(db, st, r, first)) changed = true;
      });
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
    if (changed) {
      ['members', 'meetings'].forEach(function (c) {
        (db[c] || []).sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      });
      writeDb(db);
    }
    st.since = maxSeen; st.init = true; saveState(st);
    return changed;
  }

  function applyRemote(db, st, r, first) {
    var c = r.collection;
    if (allColls().indexOf(c) < 0) return false;
    var snap = st.snap[c] || (st.snap[c] = {}), id = String(r.id);
    var cur = recMap(db, c)[id];
    var localDirty = cur ? snap[id] !== hash(cur) : (id in snap);
    if (localDirty && !first) return false;            // un-pushed local edit wins; it will be pushed next
    if (r.deleted) {
      if (!cur) { delete snap[id]; return false; }
      db[c] = (db[c] || []).filter(function (x) { return String(x.id) !== id; });
      delete snap[id]; return true;
    }
    var data = r.data; if (!data) return false;
    if (cur && hash(cur) === hash(data)) { snap[id] = hash(data); return false; }
    if (c === 'admin') { db.admin = data; }
    else {
      var arr = db[c] || (db[c] = []), k = -1;
      for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === id) { k = i; break; }
      if (k >= 0) arr[k] = data; else arr.unshift(data);
    }
    snap[id] = hash(data); return true;
  }

  async function sync(opts) {
    opts = opts || {};
    if (!ENABLED) return false;
    if (!navigator.onLine) { setStatus('offline'); return false; }
    if (running) { again = true; return false; }
    running = true; var changed = false;
    setStatus('syncing');
    try {
      var st = loadState();
      if (!opts.pushOnly || !st.init) changed = await pull(st);
      await push(st);
      pending = 0;
      setStatus('synced');
      if (changed && !opts.silent) announceChange();
    } catch (e) {
      console.warn('[NACOSS sync]', e);
      setStatus(navigator.onLine ? 'error' : 'offline', String(e && e.message || e));
    } finally {
      running = false;
      if (again) { again = false; schedulePush(300); }
    }
    return changed;
  }

  function schedulePush(ms) {
    if (!ENABLED) return;
    clearTimeout(timer);
    timer = setTimeout(function () { sync({ pushOnly: true }); }, ms == null ? 1200 : ms);
  }

  /* called by the app every time it saves its data */
  function onSave() {
    if (!ENABLED) return;
    try { var st = loadState(); pending = diff(readDb() || {}, st).length; } catch (e) {}
    setStatus(navigator.onLine ? (running ? 'syncing' : 'pending') : 'offline');
    schedulePush();
  }

  function announceChange() {
    try {
      if (typeof window.alert === 'function') { /* uses the in-app toast */ }
      var bar = document.getElementById('nq-refresh'); if (bar) return;
      bar = document.createElement('button');
      bar.id = 'nq-refresh'; bar.type = 'button';
      bar.textContent = 'New data from other devices — tap to refresh';
      bar.onclick = function () { location.reload(); };
      document.body.appendChild(bar);
    } catch (e) {}
  }

  /* Runs before the app starts: grab the latest online data (max ~3s) so the app opens up to date. */
  function bootGate() {
    if (!ENABLED || !navigator.onLine) return Promise.resolve();
    if (loadState().init) { setTimeout(function () { sync(); }, 1500); return Promise.resolve(); } /* already synced before: open instantly */
    return Promise.race([
      sync({ silent: true }).catch(function () {}),
      new Promise(function (r) { setTimeout(r, 3000); })
    ]);
  }

  window.addEventListener('online', function () { setStatus('idle'); sync(); });
  window.addEventListener('offline', function () { setStatus('offline'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  if (ENABLED) setInterval(function () { if (!document.hidden) sync(); }, EVERY);

  window.NacossSync = {
    enabled: ENABLED,
    onSave: onSave,
    sync: sync,
    bootGate: bootGate,
    info: function () { return { status: status, pending: pending, error: lastError, enabled: ENABLED }; }
  };
})();

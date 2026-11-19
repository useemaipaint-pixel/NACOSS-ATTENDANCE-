/* NACOSS PWA helpers: service worker, install prompt, online/offline + sync status pill */
(function () {
  'use strict';
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  /* ---------- service worker (offline support) ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('[NACOSS] SW failed', e); });
    });
  }

  /* ---------- status pill ---------- */
  var pill;
  function ensurePill() {
    if (pill && pill.parentNode) return pill;
    pill = document.createElement('div');
    pill.id = 'nq-pill'; pill.setAttribute('role', 'status');
    pill.innerHTML = '<i></i><span></span>';
    document.body.appendChild(pill);
    return pill;
  }
  function render(d) {
    var enabled = d ? d.enabled : (window.NacossSync && window.NacossSync.enabled);
    var online = navigator.onLine;
    var st = (d && d.status) || (window.NacossSync && window.NacossSync.info().status) || '';
    var text, cls;
    if (!online) { text = 'Offline'; cls = 'off'; }
    else if (!enabled) { pill && pill.parentNode && pill.parentNode.removeChild(pill); return; }
    else if (st === 'syncing') { text = 'Syncing…'; cls = 'sync'; }
    else if (st === 'pending') { text = 'Saving online…'; cls = 'sync'; }
    else if (st === 'error') { text = 'Sync problem'; cls = 'err'; }
    else { text = 'Online'; cls = 'on'; }
    var p = ensurePill();
    p.className = cls; p.lastChild.textContent = text;
    if (d && d.pending && cls !== 'on') p.lastChild.textContent = text + (d.pending ? ' · ' + d.pending : '');
    if (cls === 'err' && d && d.error) p.title = d.error;
  }
  window.addEventListener('nacoss-sync', function (e) { render(e.detail); });
  window.addEventListener('online', function () { render(); });
  window.addEventListener('offline', function () { render(); });
  document.addEventListener('DOMContentLoaded', function () { render(); });

  /* ---------- install banner ---------- */
  var deferred = null, card;
  var DISMISS_KEY = 'nacoss_install_dismissed';
  function dismissed() { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 3 * 864e5; } catch (e) { return false; } }
  function hideCard() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
  function showCard(ios) {
    if (standalone || dismissed() || card) return;
    card = document.createElement('div');
    card.id = 'nq-install';
    card.innerHTML =
      '<img src="icon-192.png" alt="" width="44" height="44">' +
      '<div class="t"><b>Install NACOSS Attendance</b><small>' +
      (ios ? 'Tap <u>Share</u> then <u>Add to Home Screen</u>' : 'Works offline, opens like a normal app') + '</small></div>' +
      (ios ? '' : '<button type="button" class="go">Install</button>') +
      '<button type="button" class="x" aria-label="Close">&times;</button>';
    document.body.appendChild(card);
    var go = card.querySelector('.go');
    if (go) go.onclick = function () {
      if (!deferred) return hideCard();
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; hideCard(); });
    };
    card.querySelector('.x').onclick = function () { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {} hideCard(); };
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    setTimeout(function () { showCard(false); }, 2500);
  });
  window.addEventListener('appinstalled', function () { deferred = null; hideCard(); });
  var ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua) && !standalone) setTimeout(function () { showCard(true); }, 3500);
})();

'use strict';
/*
 * Bus Times — personal real-time Israeli bus arrivals (Yokneam Illit).
 * Live data: curlbus.app JSON API (Ministry of Transport SIRI feed),
 * with a CORS-proxy fallback since curlbus.app sends no CORS headers.
 */

const I18N = {
  he: {
    title: 'זמני אוטובוס', subtitle: 'יקנעם עילית · זמן אמת',
    favorites: 'מועדפים', search: 'חיפוש',
    searchPh: 'חיפוש תחנה לפי שם או מספר…',
    noFavs: 'עוד לא שמרת תחנות ⭐\nלחץ על תחנה במפה כדי להוסיף אותה למועדפים.',
    upcoming: 'אוטובוסים קרובים',
    noBuses: 'אין אוטובוסים קרובים כרגע',
    min: 'דק׳', now: 'מגיע עכשיו',
    errLoad: 'שגיאה בטעינת נתוני זמן אמת. נסה שוב בעוד רגע.',
    addFav: 'הוסף למועדפים', removeFav: 'הסר מהמועדפים',
    loading: 'טוען נתוני זמן אמת…', updated: 'עודכן',
    credit: 'נתוני זמן אמת: משרד התחבורה דרך curlbus.app',
    noResults: 'לא נמצאו תחנות',
    viewTimes: 'הצג זמנים',
  },
  en: {
    title: 'Bus Times', subtitle: 'Yokneam Illit · live',
    favorites: 'Favorites', search: 'Search',
    searchPh: 'Search stops by name or code…',
    noFavs: 'No favorites yet ⭐\nClick a stop on the map to add it to favorites.',
    upcoming: 'Upcoming buses',
    noBuses: 'No upcoming buses right now',
    min: 'min', now: 'arriving now',
    errLoad: 'Error loading live data. Try again in a moment.',
    addFav: 'Add to favorites', removeFav: 'Remove from favorites',
    loading: 'Loading live data…', updated: 'Updated',
    credit: 'Live data: Ministry of Transport via curlbus.app',
    noResults: 'No stops found',
    viewTimes: 'Show times',
  },
};

const CENTER = [32.625, 35.115];
const REFRESH_MS = 30_000;

let stops = [];
let stopsByCode = {};
let lang = localStorage.getItem('bt_lang') || 'he';
let favs = new Set(JSON.parse(localStorage.getItem('bt_favs') || '[]'));
let map = null;
let markers = {};
let selectedCode = null;

const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
const $ = (id) => document.getElementById(id);

/* ---------- live data ---------- */

async function fetchArrivals(code) {
  const url = 'https://curlbus.app/' + encodeURIComponent(code);
  const opts = { headers: { Accept: 'application/json' } };
  const attempts = [
    url, // direct — works once curlbus.app sends CORS headers
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
    'https://api.cors.lol/?url=' + encodeURIComponent(url),
  ];
  let lastErr = null;
  for (const a of attempts) {
    try {
      const r = await fetch(a, opts);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all fetch attempts failed');
}

function parseVisits(data, code) {
  const list = (data && data.visits && data.visits[String(code)]) || [];
  const now = Date.now();
  return list
    .map((v) => {
      let etaMs = NaN;
      try { etaMs = new Date(String(v.eta).replace(' ', 'T')).getTime(); } catch (e) { /* ignore */ }
      const mins = Math.round((etaMs - now) / 60000);
      const nm = (((v.static_info || {}).route || {}).destination || {}).name || {};
      return {
        line: v.line_name,
        dest: nm[lang.toUpperCase()] || nm.HE || nm.EN || '',
        mins,
      };
    })
    .filter((a) => a.line && a.mins >= 0)
    .sort((a, b) => a.mins - b.mins)
    .slice(0, 10);
}

function arrivalRow(a) {
  const etaTxt = a.mins <= 1 ? t('now') : a.mins + ' ' + t('min');
  const cls = a.mins <= 3 ? 'eta soon' : 'eta';
  const dest = a.dest ? `<span class="dest">${escapeHtml(a.dest)}</span>` : '<span class="dest"></span>';
  return `<div class="arrival"><span class="line-badge">${escapeHtml(String(a.line))}</span>${dest}<span class="${cls}">${etaTxt}</span></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- stop detail ---------- */

async function selectStop(code) {
  selectedCode = String(code);
  const s = stopsByCode[selectedCode];
  if (!s) return;
  $('stopDetail').hidden = false;
  $('detailName').textContent = s.stop_name;
  $('detailCode').textContent = '#' + s.stop_code;
  updateFavButton();
  await refreshDetail();
  const m = markers[selectedCode];
  if (m) { map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 }); m.openTooltip(); }
}

async function refreshDetail() {
  if (!selectedCode) return;
  const box = $('detailArrivals');
  box.innerHTML = `<div class="loading-msg">${t('loading')}</div>`;
  try {
    const data = await fetchArrivals(selectedCode);
    const arrivals = parseVisits(data, selectedCode);
    box.innerHTML = arrivals.length
      ? arrivals.map(arrivalRow).join('')
      : `<div class="empty">${t('noBuses')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="error">${t('errLoad')}</div>`;
  }
  $('detailUpdated').textContent = new Date().toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US');
}

function updateFavButton() {
  const btn = $('favToggle');
  const isFav = favs.has(selectedCode);
  btn.textContent = isFav ? '★' : '☆';
  btn.classList.toggle('active', isFav);
  btn.title = isFav ? t('removeFav') : t('addFav');
}

function toggleFav(code) {
  code = String(code);
  if (favs.has(code)) favs.delete(code); else favs.add(code);
  localStorage.setItem('bt_favs', JSON.stringify([...favs]));
  paintMarkers();
  if (code === selectedCode) updateFavButton();
  renderFavs();
}

/* ---------- favorites panel ---------- */

async function renderFavs() {
  const list = $('favList');
  const codes = [...favs].filter((c) => stopsByCode[c]);
  if (!codes.length) {
    list.innerHTML = `<div class="empty">${t('noFavs').replace('\n', '<br>')}</div>`;
    return;
  }
  list.innerHTML = codes.map((code) => {
    const s = stopsByCode[code];
    return `<div class="card fav-card" style="margin-bottom:.6rem">
      <div class="stop-head">
        <div><h2>${escapeHtml(s.stop_name)}</h2><span class="stop-code">#${code}</span></div>
        <button class="star-btn active" data-fav="${code}" title="${t('removeFav')}">★</button>
      </div>
      <div class="arrivals" id="fav-${code}"><div class="loading-msg">${t('loading')}</div></div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-fav]').forEach((b) =>
    b.addEventListener('click', (ev) => { ev.stopPropagation(); toggleFav(b.dataset.fav); })
  );
  await refreshFavs();
}

async function refreshFavs() {
  const codes = [...favs].filter((c) => stopsByCode[c]);
  await Promise.all(codes.map(async (code) => {
    const el = $('fav-' + code);
    if (!el) return;
    try {
      const data = await fetchArrivals(code);
      const arrivals = parseVisits(data, code).slice(0, 4);
      el.innerHTML = arrivals.length
        ? arrivals.map(arrivalRow).join('')
        : `<div class="empty">${t('noBuses')}</div>`;
    } catch (e) {
      el.innerHTML = `<div class="error">${t('errLoad')}</div>`;
    }
  }));
}

/* ---------- search ---------- */

function doSearch(q) {
  q = q.trim().toLowerCase();
  const box = $('searchResults');
  if (!q) { box.innerHTML = ''; return; }
  const hits = stops
    .filter((s) => s.stop_code.includes(q) || s.stop_name.toLowerCase().includes(q))
    .slice(0, 15);
  box.innerHTML = hits.length
    ? hits.map((s) => `<div class="result-item" data-code="${s.stop_code}">
        <span class="name">${escapeHtml(s.stop_name)}</span><span class="stop-code">#${s.stop_code}</span>
      </div>`).join('')
    : `<div class="empty">${t('noResults')}</div>`;
  box.querySelectorAll('.result-item').forEach((el) =>
    el.addEventListener('click', () => selectStop(el.dataset.code))
  );
}

/* ---------- map ---------- */

function paintMarkers() {
  Object.entries(markers).forEach(([code, m]) => {
    const isFav = favs.has(code);
    m.setStyle({
      color: isFav ? '#b45309' : '#0d9488',
      fillColor: isFav ? '#f5a623' : '#14b8a6',
      radius: isFav ? 9 : 6,
    });
  });
}

function initMap() {
  map = L.map('map').setView(CENTER, 14);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19,
  }).addTo(map);

  stops.forEach((s) => {
    const m = L.circleMarker([s.stop_lat, s.stop_lon], {
      color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.85, weight: 2, radius: 6,
    }).addTo(map);
    m.bindTooltip(`${escapeHtml(s.stop_name)} (#${s.stop_code})`, { direction: 'top' });
    m.on('click', () => selectStop(s.stop_code));
    markers[s.stop_code] = m;
  });
  paintMarkers();
}

/* ---------- language ---------- */

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('langToggle').textContent = lang === 'he' ? 'EN' : 'עב';
  document.title = t('title') + ' — ' + (lang === 'he' ? 'יקנעם עילית' : 'Yokneam Illit');
  if (selectedCode) refreshDetail();
  renderFavs();
  doSearch($('searchInput').value);
}

/* ---------- boot ---------- */

async function boot() {
  applyLang();

  const res = await fetch('data/stops.json');
  const payload = await res.json();
  stops = payload.stops || [];
  stopsByCode = Object.fromEntries(stops.map((s) => [String(s.stop_code), s]));

  initMap();

  $('favToggle').addEventListener('click', () => selectedCode && toggleFav(selectedCode));
  $('tabFav').addEventListener('click', () => switchTab('fav'));
  $('tabSearch').addEventListener('click', () => switchTab('search'));
  $('searchInput').addEventListener('input', (e) => doSearch(e.target.value));
  $('langToggle').addEventListener('click', () => {
    lang = lang === 'he' ? 'en' : 'he';
    localStorage.setItem('bt_lang', lang);
    applyLang();
  });

  renderFavs();
  setInterval(async () => {
    if (selectedCode && !$('stopDetail').hidden) await refreshDetail();
    if (!$('panelFav').hidden) await refreshFavs();
  }, REFRESH_MS);
}

function switchTab(which) {
  $('tabFav').classList.toggle('active', which === 'fav');
  $('tabSearch').classList.toggle('active', which === 'search');
  $('panelFav').hidden = which !== 'fav';
  $('panelSearch').hidden = which !== 'search';
  if (which === 'search') $('searchInput').focus();
}

document.addEventListener('DOMContentLoaded', boot);

'use strict';
/*
 * Bus Times — personal real-time Israeli bus arrivals (all of Israel).
 * Live data: curlbus.app JSON API (Ministry of Transport SIRI feed),
 * with a CORS-proxy fallback since curlbus.app sends no CORS headers.
 */

const I18N = {
  he: {
    title: 'זמני אוטובוס', subtitle: 'ישראל · זמן אמת',
    favorites: 'מועדפים', search: 'חיפוש', nearby: 'קרוב אליי',
    searchPh: 'חיפוש תחנה לפי שם, עיר או מספר…',
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
    locate: '📍 מצא תחנות לידי',
    locating: 'מאתר את המיקום שלך…',
    nearYou: 'תחנות קרובות אליך',
    youAreHere: 'אתה כאן',
    geoDenied: 'לא התקבלה גישת מיקום. אפשר גישה למיקום בדפדפן ונסה שוב.',
    geoError: 'לא ניתן לאתר את המיקום כרגע. נסה שוב.',
    meters: 'מ׳',
    km: 'ק״מ',
  },
  en: {
    title: 'Bus Times', subtitle: 'Israel · live',
    favorites: 'Favorites', search: 'Search', nearby: 'Nearby',
    searchPh: 'Search stops by name, city or code…',
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
    locate: '📍 Find stops near me',
    locating: 'Locating you…',
    nearYou: 'Stations near you',
    youAreHere: 'You are here',
    geoDenied: 'Location permission denied. Allow location access in your browser and try again.',
    geoError: 'Could not determine your location right now. Try again.',
    meters: 'm',
    km: 'km',
  },
};

const CENTER = [32.625, 35.115];
const REFRESH_MS = 30_000;

let stops = [];
let stopsByCode = {};
let lang = localStorage.getItem('bt_lang') || 'he';
let favs = new Set(JSON.parse(localStorage.getItem('bt_favs') || '[]'));
let map = null;
let clusterGroup = null;
let markers = {};
let selectedCode = null;
let userPos = null;
let userMarker = null;

const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
const $ = (id) => document.getElementById(id);

/* ---------- live data ---------- */

async function fetchArrivals(code) {
  const url = 'https://curlbus.app/' + encodeURIComponent(code);
  const opts = { headers: { Accept: 'application/json' } };
  const attempts = [
    'https://bus-times-cors.ohrmich.workers.dev/?url=' + encodeURIComponent(url), // Or's own Cloudflare worker — reliable
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
  $('detailCode').textContent = '#' + s.stop_code + (s.city ? ' · ' + s.city : '');
  updateFavButton();
  await refreshDetail();
  const m = markers[selectedCode];
  if (m && clusterGroup && clusterGroup.zoomToShowLayer) {
    clusterGroup.zoomToShowLayer(m, () => m.openTooltip());
  } else if (m) {
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
    m.openTooltip();
  }
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
        <div><h2>${escapeHtml(s.stop_name)}</h2><span class="stop-code">#${code}${s.city ? ' · ' + escapeHtml(s.city) : ''}</span></div>
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
    .filter((s) => s.stop_code.includes(q)
      || s.stop_name.toLowerCase().includes(q)
      || (s.city && s.city.toLowerCase().includes(q)))
    .slice(0, 20);
  box.innerHTML = hits.length
    ? hits.map((s) => `<div class="result-item" data-code="${s.stop_code}">
        <span class="name">${escapeHtml(s.stop_name)}${s.city ? ` <span class="city">${escapeHtml(s.city)}</span>` : ''}</span><span class="stop-code">#${s.stop_code}</span>
      </div>`).join('')
    : `<div class="empty">${t('noResults')}</div>`;
  box.querySelectorAll('.result-item').forEach((el) =>
    el.addEventListener('click', () => selectStop(el.dataset.code))
  );
}


/* ---------- bus-line search & route view ---------- */

async function ensureRouteIndex() {
  if (!routeIndex) {
    const res = await fetch('data/routes.json');
    routeIndex = ((await res.json()).routes) || [];
  }
  return routeIndex;
}

async function ensureRouteStops() {
  if (!routeStopsCache) {
    const res = await fetch('data/route_stops.json');
    routeStopsCache = ((await res.json()).routes) || {};
  }
  return routeStopsCache;
}

function dirArrow() { return lang === 'he' ? '←' : '→'; }

function setSearchMode(m) {
  searchMode = m;
  $('modeStop').classList.toggle('active', m === 'stop');
  $('modeLine').classList.toggle('active', m === 'line');
  $('searchInput').placeholder = t(m === 'line' ? 'searchLinePh' : 'searchPh');
  $('searchInput').value = '';
  $('searchResults').innerHTML = '';
  $('searchInput').focus();
}

function lineResultHtml(r) {
  return `<div class="result-item line-result" data-rid="${r.id}">`
    + `<span class="line-badge">${escapeHtml(r.n)}</span>`
    + `<span class="name">${escapeHtml(r.from)} ${dirArrow()} <b>${escapeHtml(r.to)}</b>`
    + (r.a ? ` <span class="city">${escapeHtml(r.a)}</span>` : '') + `</span></div>`;
}

async function doLineSearch(q) {
  q = q.trim();
  const box = $('searchResults');
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="loading-msg">${t('loading')}</div>`;
  try {
    const idx = await ensureRouteIndex();
    const hits = idx.filter((r) => r.n.startsWith(q)).slice(0, 25);
    box.innerHTML = hits.length
      ? hits.map(lineResultHtml).join('')
      : `<div class="empty">${t('noLines')}</div>`;
    box.querySelectorAll('.line-result').forEach((el) =>
      el.addEventListener('click', () => selectRoute(el.dataset.rid))
    );
  } catch (e) {
    box.innerHTML = `<div class="error">${t('errLoad')}</div>`;
  }
}

function clearRoute() {
  if (routeBusTimer) { clearInterval(routeBusTimer); routeBusTimer = null; }
  if (routeLayer && map) { map.removeLayer(routeLayer); }
  routeLayer = null;
  busMarkers = {};
  selectedRoute = null;
  $('routeDetail').hidden = true;
}

async function selectRoute(rid) {
  const idx = await ensureRouteIndex();
  const r = idx.find((x) => String(x.id) === String(rid));
  if (!r) return;
  const stopsMap = await ensureRouteStops();
  const codes = stopsMap[r.id] || [];
  const pts = codes.map((c) => stopsByCode[String(c)]).filter(Boolean);
  if (pts.length < 2) return;
  clearRoute();
  selectedRoute = r;

  routeLayer = L.layerGroup().addTo(map);
  const latlngs = pts.map((s) => [s.stop_lat, s.stop_lon]);
  L.polyline(latlngs, { color: '#7c3aed', weight: 4, opacity: 0.7 }).addTo(routeLayer);
  pts.forEach((s) => {
    const m = L.circleMarker([s.stop_lat, s.stop_lon], {
      color: '#7c3aed', fillColor: '#a78bfa', fillOpacity: 0.9, weight: 2, radius: 5,
    });
    m.bindTooltip(`${escapeHtml(s.stop_name)} (#${s.stop_code})`, { direction: 'top' });
    m.on('click', () => selectStop(s.stop_code));
    routeLayer.addLayer(m);
  });
  const flag = (s, emoji) => {
    routeLayer.addLayer(L.marker([s.stop_lat, s.stop_lon], {
      icon: L.divIcon({ className: 'flag-marker', html: emoji, iconSize: [24, 24], iconAnchor: [12, 12] }),
    }));
  };
  flag(pts[0], '🚩');
  flag(pts[pts.length - 1], '🏁');
  map.flyToBounds(L.latLngBounds(latlngs).pad(0.12), { duration: 0.8 });

  $('routeDetail').hidden = false;
  $('routeTitle').innerHTML = `<span class="line-badge big">${escapeHtml(r.n)}</span> ${escapeHtml(r.to)}`;
  $('routeSub').textContent = r.from + (r.a ? ' · ' + r.a : '');
  $('routeClose').title = t('closeRoute');
  await refreshRouteBuses();
  routeBusTimer = setInterval(refreshRouteBuses, REFRESH_MS);
}

async function refreshRouteBuses() {
  const r = selectedRoute;
  if (!r || !routeLayer) return;
  const box = $('busList');
  box.innerHTML = `<div class="loading-msg">${t('loading')}</div>`;
  try {
    const stopsMap = await ensureRouteStops();
    const codes = stopsMap[r.id] || [];
    const N = 8;
    const sample = codes.length <= N
      ? codes
      : Array.from({ length: N }, (_, i) => codes[Math.round((i * (codes.length - 1)) / (N - 1))]);
    const results = await Promise.all(sample.map((c) => fetchArrivals(c).catch(() => null)));
    const buses = new Map();
    results.forEach((data, i) => {
      const code = String(sample[i]);
      const visits = (data && data.visits && data.visits[code]) || [];
      visits.forEach((v) => {
        if (String(v.line_name) !== String(r.n)) return;
        const loc = v.location;
        if (!loc || loc.lat == null || loc.lon == null) return;
        let etaMs = NaN;
        try { etaMs = new Date(String(v.eta).replace(' ', 'T')).getTime(); } catch (e) { /* ignore */ }
        const mins = Math.round((etaMs - Date.now()) / 60000);
        if (!isFinite(mins) || mins < 0 || mins > 180) return;
        const ref = String(v.vehicle_ref || '') || (String(v.trip_id) + '@' + code);
        const nm = (((v.static_info || {}).route || {}).destination || {}).name || {};
        const dest = nm[lang.toUpperCase()] || nm.HE || nm.EN || '';
        const s = stopsByCode[code];
        const prev = buses.get(ref);
        if (!prev || mins < prev.mins) {
          buses.set(ref, {
            ref, lat: parseFloat(loc.lat), lon: parseFloat(loc.lon), mins,
            nextStop: s ? s.stop_name : '#' + code,
            dest, destId: String(v.destination_id || ''),
          });
        }
      });
    });
    let list = [...buses.values()];
    const directed = list.filter((b) => b.destId && b.destId === String(r.last));
    if (directed.length) list = directed;
    list.sort((a, b) => a.mins - b.mins);

    Object.values(busMarkers).forEach((m) => routeLayer.removeLayer(m));
    busMarkers = {};
    list.forEach((b) => {
      const m = L.marker([b.lat, b.lon], {
        icon: L.divIcon({ className: 'bus-marker', html: '🚌', iconSize: [30, 30], iconAnchor: [15, 15] }),
      });
      const etaTxt = b.mins <= 1 ? t('now') : b.mins + ' ' + t('min');
      m.bindPopup(`<b>${escapeHtml(r.n)}</b> ${dirArrow()} ${escapeHtml(b.dest || r.to)}<br>${t('nextStop')}: ${escapeHtml(b.nextStop)} (${etaTxt})`);
      routeLayer.addLayer(m);
      busMarkers[b.ref] = m;
    });

    $('busCount').textContent = list.length ? `(${list.length})` : '';
    box.innerHTML = list.length
      ? list.map((b) => {
          const etaTxt = b.mins <= 1 ? t('now') : b.mins + ' ' + t('min');
          return `<div class="arrival"><span class="bus-ico">🚌</span>`
            + `<span class="dest">${escapeHtml(b.dest || r.to)}<br><span class="next">${t('nextStop')}: ${escapeHtml(b.nextStop)}</span></span>`
            + `<span class="eta${b.mins <= 3 ? ' soon' : ''}">${etaTxt}</span></div>`;
        }).join('')
      : `<div class="empty">${t('noLiveBuses')}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="error">${t('errLoad')}</div>`;
  }
  $('routeUpdated').textContent = new Date().toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-US');
}

/* ---------- geolocation & nearby ---------- */

function distMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtDist(m) {
  return m < 1000
    ? Math.round(m) + ' ' + t('meters')
    : (m / 1000).toFixed(1) + ' ' + t('km');
}

function locateMe() {
  switchTab('nearby');
  const status = $('nearbyStatus');
  if (!('geolocation' in navigator)) {
    status.innerHTML = `<div class="error">${t('geoError')}</div>`;
    return;
  }
  status.innerHTML = `<div class="loading-msg">${t('locating')}</div>`;
  $('nearbyList').innerHTML = '';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userPos.lat, userPos.lon], {
        color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 3, radius: 9,
      }).addTo(map).bindTooltip(t('youAreHere'));
      map.flyTo([userPos.lat, userPos.lon], 15, { duration: 0.8 });
      renderNearby();
    },
    (err) => {
      status.innerHTML = `<div class="error">${err.code === err.PERMISSION_DENIED ? t('geoDenied') : t('geoError')}</div>`;
    },
    { enableHighAccuracy: true, timeout: 12000 }
  );
}

function renderNearby() {
  const box = $('nearbyList');
  const status = $('nearbyStatus');
  if (!userPos) { status.innerHTML = ''; box.innerHTML = ''; return; }
  const nearest = stops
    .map((s) => ({ s, d: distMeters(userPos.lat, userPos.lon, s.stop_lat, s.stop_lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);
  status.innerHTML = `<div class="updated" style="text-align:start">${t('nearYou')}</div>`;
  box.innerHTML = nearest.map(({ s, d }) => `
    <div class="result-item nearby-item" data-code="${s.stop_code}">
      <span class="name">${escapeHtml(s.stop_name)}${s.city ? ` <span class="city">${escapeHtml(s.city)}</span>` : ''}<br><span class="stop-code">#${s.stop_code}</span></span>
      <span class="dist">${fmtDist(d)}</span>
    </div>`).join('');
  box.querySelectorAll('.nearby-item').forEach((el) =>
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
  if (clusterGroup && clusterGroup.refreshClusters) clusterGroup.refreshClusters();
}

function initMap() {
  map = L.map('map').setView(CENTER, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 60,
    disableClusteringAtZoom: 16,
  });
  map.addLayer(clusterGroup);

  stops.forEach((s) => {
    const m = L.circleMarker([s.stop_lat, s.stop_lon], {
      color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.85, weight: 2, radius: 6,
    });
    m.bindTooltip(`${escapeHtml(s.stop_name)} (#${s.stop_code})`, { direction: 'top' });
    m.on('click', () => selectStop(s.stop_code));
    markers[s.stop_code] = m;
    clusterGroup.addLayer(m);
  });
  paintMarkers();

  const locateCtl = L.control({ position: 'bottomright' });
  locateCtl.onAdd = () => {
    const btn = L.DomUtil.create('button', 'map-locate-btn');
    btn.id = 'mapLocateBtn';
    btn.innerHTML = '📍';
    btn.title = t('locate');
    btn.setAttribute('aria-label', t('locate'));
    L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.stopPropagation(e); locateMe(); });
    return btn;
  };
  locateCtl.addTo(map);
}

/* ---------- language ---------- */

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('langToggle').textContent = lang === 'he' ? 'EN' : 'עב';
  document.title = t('title') + ' — ' + (lang === 'he' ? 'ישראל' : 'Israel');
  const mapBtn = $('mapLocateBtn');
  if (mapBtn) { mapBtn.title = t('locate'); mapBtn.setAttribute('aria-label', t('locate')); }
  if (selectedCode) refreshDetail();
  $('searchInput').placeholder = t(searchMode === 'line' ? 'searchLinePh' : 'searchPh');
  if (searchMode === 'line' && $('searchInput').value) doLineSearch($('searchInput').value);
  if (selectedRoute) {
    $('routeTitle').innerHTML = `<span class="line-badge big">${escapeHtml(selectedRoute.n)}</span> ${escapeHtml(selectedRoute.to)}`;
    $('routeSub').textContent = selectedRoute.from + (selectedRoute.a ? ' · ' + selectedRoute.a : '');
    $('routeClose').title = t('closeRoute');
    refreshRouteBuses();
  }
  renderFavs();
  if (userPos) renderNearby();
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
  $('tabNearby').addEventListener('click', () => switchTab('nearby'));
  $('tabSearch').addEventListener('click', () => switchTab('search'));
  $('locateBtn').addEventListener('click', locateMe);
  $('searchInput').addEventListener('input', (e) => {
    if (searchMode === 'line') doLineSearch(e.target.value); else doSearch(e.target.value);
  });
  $('modeStop').addEventListener('click', () => setSearchMode('stop'));
  $('modeLine').addEventListener('click', () => setSearchMode('line'));
  $('routeClose').addEventListener('click', clearRoute);
  $('langToggle').addEventListener('click', () => {
    lang = lang === 'he' ? 'en' : 'he';
    localStorage.setItem('bt_lang', lang);
    applyLang();
  });

  renderFavs();
  setInterval(async () => {
    if (selectedCode && !$('stopDetail').hidden) await refreshDetail();
    if (!$('panelFav').hidden) await refreshFavs();
    if (selectedRoute && !$('routeDetail').hidden) await refreshRouteBuses();
  }, REFRESH_MS);
}

function switchTab(which) {
  $('tabFav').classList.toggle('active', which === 'fav');
  $('tabNearby').classList.toggle('active', which === 'nearby');
  $('tabSearch').classList.toggle('active', which === 'search');
  $('panelFav').hidden = which !== 'fav';
  $('panelNearby').hidden = which !== 'nearby';
  $('panelSearch').hidden = which !== 'search';
  if (which === 'search') $('searchInput').focus();
}

document.addEventListener('DOMContentLoaded', boot);

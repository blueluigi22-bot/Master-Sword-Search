/*
 * Master Sword Search — content script.
 *
 * Brings Google's own Ocarina of Time Easter egg to every Google web search.
 * Art and sound load straight from Google's CDN (the same gstatic files its
 * Easter egg uses), and the sword, warp and sound timings follow Google's code.
 * Plunging the sword plays the warp and shows the current results as a
 * 1998-style page. Pulling it out returns to the modern page.
 *
 * The chosen era is kept in this tab's sessionStorage, so paging, searching
 * again or reloading while in 1998 stays in 1998 until the sword is pulled.
 *
 * Everything is built with DOM APIs (no innerHTML) inside a shadow root so
 * Google's styles, CSP and Trusted Types do not interfere.
 */
(() => {
  'use strict';

  if (window.__masterSwordSearch) return;
  window.__masterSwordSearch = true;

  const ERA_KEY = 'masterSwordSearch.era';
  const DEFAULTS = { enabled: true, sound: true, skipNative: true };
  // Searches on which Google's own Master Sword Easter egg appears.
  const NATIVE_TRIGGER = /\b(zelda|ocarina\s+of\s+time)\b/i;
  // The controller Google's Easter egg mounts on, and its sword button.
  const NATIVE_EGG = '[jscontroller="FqhAde"]';

  const OOT = 'https://www.gstatic.com/delight/srp/oot/';
  const ART = {
    triforce: OOT + 'Triforce-Yellow.png',
    tile: OOT + 'TransitionTile.2.png',
    particle: OOT + 'BlueParticle.png',
    sword: OOT + 'MasterSword-2026.png',
    stand: OOT + 'Stand-2026.png',
    sword1998: OOT + 'MasterSword-1998.png',
    stand1998: OOT + 'Stand-1998.png',
  };
  const GLOW_ART = OOT + 'BGGlow-370x348-12fps-36f.png';
  const LOGO_ART = OOT + '1998_lm.png';
  const SOUND_FILES = {
    adult: OOT + 'AdultLink.mp3',
    young: OOT + 'YoungLink.mp3',
    return: OOT + 'ReturnMS.mp3',
    draw: OOT + 'DrawMS.mp3',
    warp: OOT + 'TimeWarp.mp3',
  };

  let params, query, start, isWebSearch;
  const root = document.documentElement;
  let settings = { ...DEFAULTS }, era = readEra(), ui = null, busy = false;
  let generation = 0, lastUrl = '', refreshTimer, originalInert = false;
  let observedBody = null, images = null, artReady = false, sounds = null, warpRun = null;
  let scrolledAway = false, scrollTravel = 0, lastScrollY = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (ui && era === 'past') showRetro(); }, 180);
  });
  function readLocation() {
    lastUrl = location.href;
    params = new URLSearchParams(location.search);
    query = (params.get('q') || '').trim();
    start = Math.max(0, parseInt(params.get('start') || '0', 10) || 0);
    const udm = params.get('udm');
    isWebSearch = location.pathname === '/search' && !!query && !params.get('tbm') && (!udm || udm === '14');
  }
  readLocation();
  loadSettings().then(loaded => {
    settings = loaded;
    whenBodyReady(() => {
      sync();
      // Google sometimes changes query and results without a document navigation.
      setInterval(() => {
        if (location.href !== lastUrl) {
          cancelTransition();
          readLocation();
          if (ui) ui.signature = null;
          sync();
        } else if (ui && (!ui.host.isConnected || document.body !== observedBody || !active())) sync();
      }, 400);
    });
  });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(DEFAULTS)) if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
      cancelTransition();
      sync();
    });
  } catch (_) {}
  window.addEventListener('pageshow', () => { readLocation(); era = readEra(); sync(); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (era === 'past' || busy)) {
      cancelTransition(); era = 'present'; writeEra(era); sync(); ui?.button.focus();
    }
  });

  // ---------------------------------------------------------------- state

  function readEra() {
    try { return sessionStorage.getItem(ERA_KEY) === 'past' ? 'past' : 'present'; } catch (_) { return 'present'; }
  }

  function writeEra(value) {
    try {
      if (value === 'past') sessionStorage.setItem(ERA_KEY, 'past');
      else sessionStorage.removeItem(ERA_KEY);
    } catch (_) { /* ignore */ }
  }

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (items) => resolve({ ...DEFAULTS, ...(items || {}) }));
      } catch (_) {
        resolve({ ...DEFAULTS });
      }
    });
  }

  function active() {
    if (!settings.enabled || !isWebSearch) return false;
    if (settings.skipNative && (NATIVE_TRIGGER.test(query) || document.querySelector(NATIVE_EGG))) return false;
    return true;
  }

  function whenBodyReady(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function cancelTransition() {
    generation++; busy = false;
    stopWarp(); stopSounds();
    if (ui) ui.button.disabled = false;
  }
  function sync() {
    if (!document.body) return;
    if (!active()) {
      cancelTransition(); hideRetro(); observer.disconnect(); observedBody = null;
      root.removeAttribute('data-mss-active');
      if (ui) { ui.host.remove(); ui = null; }
      return;
    }
    // With the option off, this sword takes the place of Google's on Zelda searches.
    root.setAttribute('data-mss-active', '');
    loadArt();
    if (settings.sound) loadSounds();
    if (!ui) ui = buildUI();
    if (!ui.host.isConnected) root.appendChild(ui.host);
    if (observedBody !== document.body) {
      observer.disconnect(); observedBody = document.body;
      observer.observe(observedBody, {subtree:true, childList:true, characterData:true});
    }
    if (!busy) setSwordState(era === 'past');
    updateButtonLabel(); updateSwordVisibility();
    if (era === 'past') showRetro(); else hideRetro();
  }

  // ------------------------------------------------------------- DOM helpers

  function append(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    return append(el, kids);
  }

  // ------------------------------------------------------------------- assets

  /** Like Google's egg, the sword only slides in once all its art has loaded. */
  function loadArt() {
    if (images) return;
    images = {};
    new Image().src = LOGO_ART;
    const names = Object.keys(ART);
    let loaded = 0, warned = false;
    for (const name of names) {
      const img = new Image();
      img.addEventListener('load', () => {
        if (++loaded === names.length) {
          artReady = true; lastScrollY = window.scrollY; scrollTravel = 0;
          updateSwordVisibility();
        }
      });
      img.addEventListener('error', () => {
        if (!warned) console.warn('Master Sword Search: could not load Google\'s Easter egg art from', img.src);
        warned = true;
      });
      img.src = ART[name];
      images[name] = img;
    }
  }

  function loadSounds() {
    if (sounds) return;
    sounds = {};
    for (const [name, url] of Object.entries(SOUND_FILES)) {
      sounds[name] = new Audio(url);
      sounds[name].preload = 'auto';
    }
  }

  function playSound(name) {
    if (!settings.sound) return;
    loadSounds();
    const audio = sounds[name];
    try { audio.currentTime = 0; } catch (_) { /* not loaded yet */ }
    audio.play()?.catch(() => {});
  }

  function stopSounds() {
    for (const audio of Object.values(sounds || {})) audio.pause();
  }

  // ------------------------------------------------------------------- the UI

  function buildUI() {
    const host = h('div', { id: 'master-sword-search' });
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    addStyles(shadow, STYLES);

    const retro = h('div', { class: 'retro', hidden: true, role: 'main' });
    const warp = h('canvas', { class: 'warp', hidden: true, 'aria-hidden': 'true' });
    const button = h('button', { class: 'sword-btn', type: 'button', onclick: onSwordClick },
      h('span', { class: 'glow' }), h('span', { class: 'sword' }), h('span', { class: 'stand' }));

    append(shadow, [retro, button, warp]);
    return { host, shadow, retro, warp, button, lastCount: 0, signature: null };
  }

  function addStyles(shadow, css) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch (_) {
      shadow.append(h('style', null, css));
    }
  }

  function updateButtonLabel() {
    const label = era === 'past'
      ? 'Pull the Master Sword to return to the present'
      : 'Place the Master Sword in the pedestal to travel back to 1998';
    ui.button.setAttribute('aria-label', label);
    ui.button.title = label;
  }

  /** Sets the sword without replaying the plunge, e.g. when a reload lands in 1998. */
  function setSwordState(past) {
    const list = ui.button.classList;
    list.toggle('still', past); list.toggle('in', past); list.toggle('y1998', past);
    ui.button.setAttribute('aria-pressed', String(past));
  }

  function updateSwordVisibility() {
    if (!ui) return;
    const show = artReady && (!scrolledAway || era === 'past');
    ui.button.classList.toggle('shown', show);
    ui.button.setAttribute('aria-hidden', String(!show));
    ui.button.tabIndex = show ? 0 : -1;
  }

  /** The sword ducks away after scrolling down 150px and returns on the way back up. */
  function onScroll() {
    if (!ui || busy || !artReady || era === 'past') return;
    const y = window.scrollY, delta = y - lastScrollY;
    if (!delta) return;
    lastScrollY = y;
    scrollTravel = Math.sign(delta) === Math.sign(scrollTravel) ? scrollTravel + delta : delta;
    if (!scrolledAway && scrollTravel >= 150) { scrolledAway = true; scrollTravel = 0; updateSwordVisibility(); }
    else if (scrolledAway && (scrollTravel <= -150 || (delta < 0 && y <= 0))) { scrolledAway = false; scrollTravel = 0; updateSwordVisibility(); }
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function onSwordClick() {
    if (busy || !ui) return;
    const view = ui, token = ++generation, toPast = era !== 'past', quick = reducedMotion();
    const valid = () => generation === token && ui === view && active();
    busy = true; view.button.disabled = true;
    try {
      const list = view.button.classList;
      list.remove('still'); list.toggle('in', toPast);
      view.button.setAttribute('aria-pressed', String(toPast));
      if (toPast) {
        playSound('adult');
        if (quick) playSound('return');
        else wait(350).then(() => { if (valid()) playSound('return'); });
        await wait(quick ? 0 : 450); if (!valid()) return;
      } else {
        playSound('draw'); playSound('young');
      }
      await playWarp(view, quick, () => {
        if (!valid()) return;
        era = toPast ? 'past' : 'present'; writeEra(era);
        list.toggle('y1998', toPast);
        if (toPast) { showRetro(); view.retro.scrollTop = 0; }
        else { hideRetro(); window.scrollTo(0, 0); }
        lastScrollY = window.scrollY; scrollTravel = 0; scrolledAway = false;
        updateButtonLabel(); updateSwordVisibility();
      });
    } finally {
      if (valid()) {
        view.button.disabled = false; busy = false;
        if (!view.shadow.activeElement) view.button.focus({preventScroll:true});
      }
    }
  }

  // ------------------------------------------------------------- the time warp

  const WARP_SWAP_MS = 2000, WARP_END_MS = 3500, WARP_SPAWN_END_MS = 2500;

  /** Plays Google's canvas warp, calling onSwap at its peak. Resolves when done or cancelled. */
  function playWarp(view, quick, onSwap) {
    stopWarp();
    playSound('warp');
    if (quick) { onSwap(); return wait(130); }
    return new Promise((resolve) => {
      const canvas = view.warp, state = { particles: [], next: particleGap(0) };
      const run = warpRun = { resolve, canvas, timer: null };
      let elapsed = 0, last = Date.now(), swapped = false;
      canvas.hidden = false;
      drawWarp(canvas, state, 0, 0);
      const tick = () => {
        const now = Date.now(), step = Math.max(now - last, 16);
        elapsed += step; last = now;
        if (!swapped && elapsed >= WARP_SWAP_MS) { swapped = true; onSwap(); }
        if (warpRun !== run) return;
        if (elapsed >= WARP_END_MS) { stopWarp(); return; }
        drawWarp(canvas, state, elapsed, step);
        run.timer = setTimeout(tick, 16);
      };
      run.timer = setTimeout(tick, 16);
    });
  }

  function stopWarp() {
    if (!warpRun) return;
    const { resolve, canvas, timer } = warpRun;
    warpRun = null;
    clearTimeout(timer);
    canvas.hidden = true;
    resolve();
  }

  /** Particles stream fastest in the middle of the warp and thin out at either end. */
  function particleGap(t) {
    const x = 2 * Math.min(1, Math.max(0, t / WARP_SPAWN_END_MS)) - 1;
    return (25 + x * x * 225) * (1 + (Math.random() * 2 - 1) * 0.5);
  }

  /** Fades in over a second, holds for a second, then fades back out. */
  function warpAlpha(t) {
    if (t <= 0 || t >= 3000) return 0;
    if (t < 1000) { const p = t / 1000; return 1 - (1 - p) * (1 - p); }
    if (t < 2000) return 1;
    const p = (t - 2000) / 1000;
    return 1 - p * p;
  }

  const drawable = (img) => img.complete && img.naturalWidth > 0;

  function drawWarp(canvas, state, t, step) {
    const w = window.innerWidth, ht = window.innerHeight;
    if (canvas.width !== w || canvas.height !== ht) { canvas.width = w; canvas.height = ht; }
    const { tile, triforce, particle } = images;
    const pw = particle.naturalWidth || 33, ph = particle.naturalHeight || 111;
    if (step > 0) {
      state.particles = state.particles.filter((p) => {
        p.y -= p.speed * step;
        return p.y + ph > 0;
      });
    }
    while (t <= WARP_SPAWN_END_MS && t >= state.next) {
      const speed = 1.2 + Math.random() * 1.2;
      const y = ht - speed * (t - state.next);
      if (y + ph > 0) state.particles.push({ x: Math.random() * Math.max(0, w - pw), y, speed });
      state.next += particleGap(state.next);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, ht);

    const tileAlpha = warpAlpha(t);
    const pattern = tileAlpha > 0 && drawable(tile) && ctx.createPattern(tile, 'repeat');
    if (pattern) {
      const offset = t * 0.4 % (tile.naturalHeight || 500);
      ctx.save();
      ctx.globalAlpha = tileAlpha;
      ctx.fillStyle = pattern;
      ctx.translate(0, -offset);
      ctx.fillRect(0, offset, w, ht);
      ctx.restore();
    }
    const triforceAlpha = warpAlpha(t - 500);
    if (triforceAlpha > 0 && drawable(triforce)) {
      const size = Math.min(400, Math.min(w, ht) * 0.6);
      ctx.save();
      ctx.globalAlpha = triforceAlpha;
      ctx.drawImage(triforce, (w - size) / 2, (ht - size) / 2, size, size);
      ctx.restore();
    }
    if (drawable(particle)) for (const p of state.particles) ctx.drawImage(particle, p.x, p.y, pw, ph);
  }

  function showRetro() {
    if (!ui) return;
    const results = scrapeResults();
    const signature = JSON.stringify([query, start, results]);
    if (ui.signature !== signature) {
      const oldScroll = ui.retro.scrollTop;
      if (ui.retro.hidden || !ui.retro.firstChild || ui.renderQuery !== query) {
        ui.retro.replaceChildren(renderRetroPage(results));
        ui.renderQuery = query;
      } else {
        // Streaming results must not destroy a search field the user is editing.
        ui.retro.querySelector('.results').replaceChildren(...resultNodes(results));
        ui.retro.querySelector('.bar').replaceWith(renderStats(results));
        ui.retro.querySelector('.pager').replaceWith(pager(results.length > 0));
      }
      ui.signature = signature; ui.lastCount = results.length; ui.retro.scrollTop = oldScroll;
    }
    if (ui.retro.hidden) originalInert = document.body.inert;
    ui.retro.hidden = false;
    document.body.inert = true;
    // Only hide Google after the replacement UI exists; never leave a blank page.
    root.setAttribute('data-mss-era', 'past');
  }
  function hideRetro() {
    root.removeAttribute('data-mss-era');
    if (!ui) return;
    if (!ui.retro.hidden) document.body.inert = originalInert;
    ui.retro.hidden = true;
  }

  // --------------------------------------------------------- reading results

  const RESULT_BOX = '[data-snc], [jsname="pKB8Bc"]';
  const SNIPPET = '[jsname="VNxLed"], .VwiC3b, .ITZIwc, .UkWcmd, .D8dVkf, .XVPTd, .p4wth';
  const URL_ATTRS = '[data-surl], [data-curl], [data-vurl]';
  const GOOGLE_SEARCH = /^(?:https?:\/\/(?:www\.)?google\.[^/]+)?\/search\b/i;

  function clean(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  const stripScheme = (url) => url.replace(/^https?:\/\//i, '');

  /** The destination inside one of Google's /url?q=… redirect links. */
  function redirectTarget(raw) {
    const search = new URLSearchParams(raw.slice(raw.indexOf('?')));
    return (search.get('url') || search.get('q') || '').trim();
  }

  /** Absolute link for a result, or null if it is not an ordinary web destination. */
  function resultLink(raw) {
    if (/^\/goto\?/i.test(raw)) return new URL(raw, location.href).href;
    let target = raw;
    if (/^\/url\?/i.test(raw)) target = redirectTarget(raw);
    if (!/^https?:\/\//i.test(target) || GOOGLE_SEARCH.test(target)) return null;
    try { return new URL(target).href; } catch (_) { return null; }
  }

  function headingTitle(heading) {
    const exact = heading.querySelector('.HEMzcc, .tNxQIb, .ZxS7Db');
    if (exact && clean(exact.textContent)) return clean(exact.textContent);
    if (!heading.querySelector('.ZtihLe, .YrbPuc')) return clean(heading.textContent);
    const copy = heading.cloneNode(true);
    for (const extra of copy.querySelectorAll('.ZtihLe, .YrbPuc')) extra.remove();
    return clean(copy.textContent);
  }

  function snippetText(el) {
    let source = el, trimmed = false;
    if (el.querySelector('.vzmbzf')) {
      source = el.cloneNode(true); trimmed = true;
      for (const more of source.querySelectorAll('.vzmbzf')) more.remove();
    }
    const text = clean(source.textContent).replace(/(?:\.{2,}|…)\s*read more\s*$/i, '...');
    return trimmed ? text.replace(/(?:\.{2,}|…)\s*$/, '...') : text;
  }

  function findSnippet(box) {
    const featured = Array.from(box.querySelectorAll('[data-sncf]'));
    for (const part of featured) {
      const el = part.querySelector(SNIPPET);
      const text = el && snippetText(el);
      if (text) return text;
    }
    const el = box.querySelector(SNIPPET);
    const text = el && snippetText(el);
    if (text) return text;
    for (const part of featured) {
      const fallback = snippetText(part);
      if (fallback) return fallback;
    }
    return '';
  }

  /** Readable source line: the destination URL when known, else Google's breadcrumb. */
  function displayUrl(raw, box, head) {
    if (/^https?:\/\//i.test(raw) && stripScheme(raw)) return stripScheme(raw);
    if (/^\/url\?/i.test(raw)) {
      const target = redirectTarget(raw);
      if (/^https?:\/\//i.test(target) && stripScheme(target)) return stripScheme(target);
    }
    const tagged = box.matches(URL_ATTRS) ? box : box.querySelector(URL_ATTRS);
    if (tagged) {
      const url = (tagged.getAttribute('data-surl') || tagged.getAttribute('data-curl') || tagged.getAttribute('data-vurl') || '').trim();
      if (/^https?:\/\//i.test(url) && stripScheme(url)) return stripScheme(url);
    }
    const cite = clean(head.querySelector('cite')?.textContent);
    if (/^(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i.test(cite)) return stripScheme(cite);
    const site = clean(head.querySelector('.VuuXrf, .WCg2uf, .mPGeZc')?.textContent);
    return site && cite ? site + ' · ' + cite : site || cite;
  }

  /** Reads organic results the way Google's own Easter egg does. */
  function scrapeResultBoxes(container) {
    const seen = new Set();
    const results = [];
    for (const box of container.querySelectorAll(RESULT_BOX)) {
      const outer = box.parentElement?.closest(RESULT_BOX);
      if (outer && container.contains(outer)) continue;
      const nested = box.closest('g-scrolling-carousel, [aria-expanded], [jsname="S9LgTb"], [jsname="TlEBqd"]');
      if (nested && container.contains(nested)) continue;
      const head = box.querySelector('[data-snhf]') || box;
      const heading = head.querySelector('[role="heading"][aria-level="3"], h3');
      if (!heading) continue;
      const title = headingTitle(heading);
      const anchor = heading.closest('a[href]') || head.querySelector('a[href]');
      if (!title || !anchor) continue;
      const raw = (anchor.getAttribute('href') || '').trim();
      const href = resultLink(raw);
      if (!href || seen.has(href)) continue;
      const snippet = findSnippet(box);
      if (!snippet) continue;
      seen.add(href);
      results.push({ title, href, snippet, source: displayUrl(raw, box, head) });
    }
    return results;
  }

  /** Fallback for result markup without Google's box attributes. */
  function looseSnippet(box, anchor, title) {
    if (!box) return '';
    const known = box.querySelector('.VwiC3b, [data-sncf~="1"], [data-content-feature="1"], [style*="line-clamp"]');
    if (known && !known.contains(anchor) && !anchor.contains(known)) return clean(known.textContent);
    // Fallback: the longest block of text that is not the title link.
    let best = '';
    for (const el of box.querySelectorAll('div, span')) {
      if (el.contains(anchor) || anchor.contains(el)) continue;
      const text = clean(el.textContent);
      if (text.length > best.length && text.length >= 40 && !text.includes(title)) best = text;
    }
    return best;
  }

  function scrapeHeadings(container) {
    const seen = new Set();
    const results = [];
    for (const heading of container.querySelectorAll('a h3, a [role="heading"]')) {
      const anchor = heading.closest('a[href]');
      if (!anchor || anchor.closest('#master-sword-search')) continue;
      const raw = (anchor.getAttribute('href') || '').trim();
      const href = resultLink(raw);
      const title = clean(heading.textContent);
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      let box = anchor.parentElement;
      for (let parent = box; parent && parent !== container; parent = parent.parentElement) {
        if (parent.querySelectorAll('h3').length > 1) break;
        box = parent;
        if (parent.querySelector('.VwiC3b, [data-sncf], [data-content-feature="1"]')) break;
      }
      results.push({ title, href, snippet: looseSnippet(box, anchor, title), source: displayUrl(raw, box, box) });
    }
    return results;
  }

  function scrapeResults() {
    const container = document.querySelector('#rso') || document.querySelector('#search') || document.body;
    const results = scrapeResultBoxes(container);
    return results.length ? results : scrapeHeadings(container);
  }

  // ------------------------------------------------------ the 1998 results page

  function searchUrl(q, extra) {
    const u = new URL('/search', location.origin);
    u.searchParams.set('q', q);
    const hl = params.get('hl');
    if (hl) u.searchParams.set('hl', hl);
    for (const [k, v] of Object.entries(extra || {})) u.searchParams.set(k, v);
    return u.href;
  }

  function logo() {
    return h('a', { class: 'logo', href: searchUrl(query), title: 'Google', 'aria-label': 'Google' });
  }

  function searchForm(id, withLucky) {
    const input = h('input', { type: 'text', name: 'q', size: 31, maxlength: 256, value: query, 'aria-label': 'Search', id });
    const submit = (lucky) => (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (lucky) {
        const first = q === query ? scrapeResults()[0] : null;
        location.href = first ? first.href : searchUrl(q, { btnI: '1' });
      } else {
        location.href = searchUrl(q);
      }
    };
    return h('form', { class: 'form', onsubmit: submit(false) },
      input,
      h('input', { type: 'submit', value: 'Google Search' }),
      withLucky ? h('input', { type: 'button', value: "I'm Feeling Lucky", onclick: submit(true) }) : null);
  }

  function shorten(text, max) {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)) + ' ';
  }

  function renderResult(r) {
    return h('div', { class: 'result' },
      h('a', { class: 'title', href: r.href }, r.title),
      h('div', { class: 'snippet' }, r.snippet ? shorten(r.snippet, 240) : null,
        r.source ? h('span', { class: 'url' }, r.source) : null));
  }

  function pager(hasResults) {
    const page = Math.floor(start / 10);
    const items = [h('span', null, 'Result Page: ')];
    if (page > 0) items.push(h('a', { href: searchUrl(query, { start: (page - 1) * 10 }) }, 'Previous'), ' ');
    const first = Math.max(0, page - 4);
    for (let p = first; p < first + 10; p++) {
      items.push(p === page ? h('b', { class: 'cur' }, String(p + 1)) : h('a', { href: searchUrl(query, { start: p * 10 }) }, String(p + 1)), ' ');
    }
    if (hasResults) items.push(h('a', { href: searchUrl(query, { start: (page + 1) * 10 }) }, 'Next'));
    return h('p', { class: 'pager' }, items);
  }

  function renderStats(results) {
    return h('div', {class:'bar'}, 'Showing results ', h('b', null, results.length ? (start+1)+'-'+(start+results.length) : '0'),
      ' for ', h('b', null, query), '.');
  }
  function resultNodes(results) {
    return results.length ? results.map(renderResult) : [h('p', {class:'none',role:'status'},
      'No standard web results are available yet. Results will appear here as Google loads them. ',
      h('button', {type:'button',onclick:() => { cancelTransition(); era='present'; writeEra(era); sync(); }}, 'Return to Google'))];
  }
  function renderRetroPage(results) {
    return h('div', {class:'page'},
      h('header', {class:'header'}, logo(), searchForm('mss-q-top', true), h('div',{class:'spacer'})),
      h('hr'), renderStats(results), h('div',{class:'results'},resultNodes(results)), pager(results.length > 0),
      h('div',{class:'foot-form'},searchForm('mss-q-bottom', false)), h('hr'),
      h('p',{class:'footer'}, 'Current results, dressed like 1998. Pull the sword or press Esc to return.'));
  }

  // ------------------------------------------------------------------- styles

  const STYLES = `
:host { all: initial; color-scheme: light; }
[hidden] { display: none !important; }

.sword-btn { position:fixed; right:24px; bottom:0; width:140px; height:215px; padding:0; margin:0; border:0; background:none; overflow:visible; cursor:pointer; pointer-events:auto; z-index:3; transform:translateY(230px); transform-origin:bottom right; transition:transform .5s cubic-bezier(.22,1,.36,1); -webkit-tap-highlight-color:transparent; }
.sword-btn.shown { transform:translateY(0); }
.sword-btn:focus-visible { outline:2px solid #4267d6; outline-offset:-4px; border-radius:8px; }
.glow { position:absolute; left:50%; bottom:-12px; width:185px; height:174px; z-index:1; pointer-events:none; transform:translateX(-50%); opacity:1; background:url('${GLOW_ART}') no-repeat; background-size:6660px 174px; animation:oot-glow-frames 3s steps(36) infinite; transition:opacity .45s ease-in-out 2s; }
.sword-btn.in .glow { opacity:0; transition:opacity .45s ease-in-out 0s; }
.sword { position:absolute; left:50%; bottom:42px; width:52px; height:175px; z-index:2; pointer-events:none; transform:translateX(-50%) translateY(0); background:url('${ART.sword}') no-repeat; background-size:100% 100%; animation:oot-sword-bob 1.8s ease-in-out infinite; transition:transform .35s cubic-bezier(.22,1,.36,1); }
.sword-btn.in .sword { transform:translateX(-50%) translateY(42px); animation:oot-sword-insert .5s ease-in; }
.sword-btn.still .sword { animation:none; }
.sword-btn.y1998 .sword { background-image:url('${ART.sword1998}'); }
.stand { position:absolute; left:50%; bottom:0; width:91px; height:37px; z-index:3; pointer-events:none; transform:translateX(-50%); background:url('${ART.stand}') no-repeat; background-size:100% 100%; }
.sword-btn.y1998 .stand { background-image:url('${ART.stand1998}'); }
@keyframes oot-glow-frames { 0% { background-position:0 0; } 100% { background-position:-6660px 0; } }
@keyframes oot-sword-bob { 0%,100% { margin-bottom:0; } 50% { margin-bottom:5px; } }
@keyframes oot-sword-insert { 0% { transform:translateX(-50%) translateY(0); } 75%,90% { transform:translateX(-50%) translateY(-15px); } 96% { transform:translateX(-50%) translateY(48px); } 100% { transform:translateX(-50%) translateY(42px); } }

.warp { position:fixed; left:0; top:0; width:100vw; height:100vh; z-index:4; pointer-events:none; }

.retro { position:fixed; inset:0; z-index:1; overflow:auto; pointer-events:auto; background:#fff; color:#16171a; color-scheme:light; font-family:'Times New Roman',Times,serif; line-height:18px; text-align:left; }
.page { box-sizing:border-box; min-height:100%; padding:8px 8px 16px; }
.retro .header { display:flex; align-items:center; width:100%; margin:0 0 4px; white-space:nowrap; }
.retro .logo { flex-shrink:0; display:inline-block; width:200px; height:78px; background:url('${LOGO_ART}') left center / contain no-repeat; }
.retro .spacer { flex:0 1 200px; }
.retro .header .form { flex:1; padding:4px 8px; text-align:center; white-space:nowrap; }
.retro input { vertical-align:middle; font-family:verdana,arial,sans-serif; font-size:13px; line-height:normal; border-radius:0; }
.retro input[type=text] { box-sizing:border-box; max-width:100%; padding:2px 4px; background:#fff; color:#16171a; border:1px solid; border-color:#656773 #d2d2d2 #d2d2d2 #656773; box-shadow:inset 1px 1px 0 #000; }
.retro input[type=submit],.retro input[type=button],.retro button { margin:2px; padding:2px 8px; cursor:pointer; color:#16171a; font-family:verdana,arial,sans-serif; font-size:13px; line-height:normal; background:#d2d2d2; border:1px solid; border-color:#fff #000 #000 #fff; box-shadow:inset 1px 1px 0 #dee1e3,inset -1px -1px 0 #656773; }
.retro input[type=submit]:active,.retro input[type=button]:active,.retro button:active { border-color:#000 #fff #fff #000; box-shadow:inset 1px 1px 0 #656773,inset -1px -1px 0 #dee1e3; }
.retro input:focus-visible,.retro button:focus-visible { outline:2px solid #375bba; outline-offset:2px; }
.retro hr { height:1px; margin:8px 0; border:0; background:#d2d2d2; }
.retro .bar { margin:8px 0 14px; text-align:center; color:#656773; font-family:verdana,arial,sans-serif; font-size:13px; }
.retro .results { margin:12px 0 20px 24px; max-width:650px; }
.retro .result { margin-bottom:16px; }
.retro .title { color:#1a0dab; cursor:pointer; font-size:18px; overflow-wrap:break-word; text-decoration:underline; }
.retro .title:active { color:#b3261e; }
.retro .snippet { margin:2px 0 0 12px; color:#4e5059; font-size:15px; overflow-wrap:break-word; }
.retro .url { display:block; overflow:hidden; color:#146c2e; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }
.retro .none { font-size:15px; line-height:1.5; }
.retro .pager { margin:0 0 16px; text-align:center; color:#4e5059; font-family:verdana,arial,sans-serif; font-size:13px; }
.retro .pager a { color:#1a0dab; }
.retro .pager a,.retro .pager b { margin:0 3px; }
.retro .pager .cur { color:#b3261e; }
.retro .foot-form { margin:16px 0; text-align:center; }
.retro .footer { margin:12px 0 0; text-align:center; color:#4e5059; font-family:verdana,arial,sans-serif; font-size:13px; }

@media(max-width:800px) { .retro .header { flex-wrap:wrap; white-space:normal; } .retro .header .form { flex-basis:100%; white-space:normal; } .retro .spacer { display:none; } }
@media(max-width:650px) { .retro .results { margin-left:10px; } .retro input[type=text] { width:100%; } .sword-btn { right:0; transform:translateY(230px) scale(.62); } .sword-btn.shown { transform:scale(.62); } .retro .page { padding-bottom:140px; } }
@media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
`;
})();

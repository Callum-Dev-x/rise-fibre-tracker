/* ===========================================================================
   RISE Fibre Door Tracker — application logic
   Plain JavaScript, no framework, no network. Everything is saved straight
   into localStorage so it is still there tomorrow morning.

   Two canvassing lists (Ian's and Russel's) live in separate data files. Only
   the one being used is downloaded and held in memory — Russel's runs to
   99,220 doors, so loading both at launch would make the app crawl on an
   older phone.

   Screens: Home / Areas / Streets / Street / Address / History / Settings.
   Navigation is by the URL hash so the phone's Back button works, and every
   screen also has its own Back button (tap only, no swipe gestures).
   =========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- data */

  /* The six outcomes a door can be in. The key is what gets saved. */
  var STATUS = {
    new:    { label: 'Not started',    short: 'Not started',    cls: 'b-new' },
    noans:  { label: 'No Answer',      short: 'No answer',      cls: 'b-noans' },
    notint: { label: 'Not Interested', short: 'Not interested', cls: 'b-notint' },
    call:   { label: 'Callback',       short: 'Callback',       cls: 'b-call' },
    sold:   { label: 'Sold',           short: 'Sold',           cls: 'b-sold' },
    dnk:    { label: 'Do Not Knock',   short: 'Do not knock',   cls: 'b-dnk' }
  };
  var ORDER = ['sold', 'call', 'noans', 'notint', 'dnk'];   // history tab order

  var KEY = 'riseFibreTracker.v1';

  /* Everything the app remembers. Loaded once, saved on every change. */
  var store = {
    records: {},                 // uprn -> { status, updated, notes, ... , list, town, street, label, pos }
    events: [],                  // { id, status, at, list } — drives "Today so far"
    settings: { textSize: 'normal', list: 'ian' },
    lastStreet: {}               // list key -> "areaIndex.streetIndex"
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        store.records = saved.records || {};
        store.events = saved.events || [];
        store.settings = saved.settings || store.settings;
        if (!store.settings.list) store.settings.list = 'ian';
        store.lastStreet = saved.lastStreet || {};
        /* Older versions kept a single street name here. */
        if (typeof store.lastStreet !== 'object') store.lastStreet = {};
      }
    } catch (e) {
      // A corrupt or unreadable store must never stop the app opening.
      console.warn('Could not read saved data:', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      return true;
    } catch (e) {
      console.warn('Could not save:', e);
      alert('The phone would not let the app save. Check there is free space.');
      return false;
    }
  }

  function rec(id) {
    if (!store.records[id]) store.records[id] = { status: 'new', updated: null, notes: '' };
    return store.records[id];
  }
  function statusOf(id) {
    var r = store.records[id];
    return (r && r.status) || 'new';
  }

  /* ------------------------------------------------------------- helpers */

  var $ = function (sel) { return document.querySelector(sel); };
  var app = $('#app');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return '£' + n.toFixed(2); }

  /* 61814 -> "61,814", so big lists stay readable. */
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function longDate(d) {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function shortDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function whenText(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return '';
    var t = d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
    return (d.toISOString().slice(0, 10) === todayISO() ? 'Today' : shortDate(d.toISOString())) + ' at ' + t;
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 1800);
  }

  /* Two-step confirmation used before anything hard to undo. */
  function confirmBox(title, body, yesText, onYes) {
    $('#modalTitle').textContent = title;
    $('#modalBody').textContent = body;
    $('#modalYesText').textContent = yesText;
    $('#modal').hidden = false;
    confirmBox._yes = onYes;
    $('#modalYes').focus();
  }
  $('#modalYes').addEventListener('click', function () {
    $('#modal').hidden = true;
    var fn = confirmBox._yes; confirmBox._yes = null;
    if (fn) fn();
  });
  $('#modalNo').addEventListener('click', function () {
    $('#modal').hidden = true; confirmBox._yes = null;
  });

  /* ------------------------------------------------- the loaded address list

     A data file holds { key, name, areas: [ { n, c, s: [ street ] } ] } where a
     street is { n: name, p: [postcodes], b: base UPRN, d: [ [delta, label, pcIndex?] ] }.
     Doors are expanded one at a time rather than up front, so a 99,220 door
     list costs almost nothing to hold in memory.                            */

  var LIST = null;        // the payload for the list currently being used
  var AREAS = [];

  function listInfo(key) {
    for (var i = 0; i < RISE_LIST_INDEX.length; i++) {
      if (RISE_LIST_INDEX[i].key === key) return RISE_LIST_INDEX[i];
    }
    return RISE_LIST_INDEX[0];
  }
  function currentKey() { return store.settings.list || 'ian'; }

  /* Fetch a list's data file the first time it is needed. */
  function ensureList(key, done) {
    if (LIST && LIST.key === key) return done();
    for (var i = 0; i < RISE_LISTS.length; i++) {
      if (RISE_LISTS[i].key === key) { useList(RISE_LISTS[i]); return done(); }
    }
    var info = listInfo(key);
    app.innerHTML = '<div class="card"><p style="margin:0"><b>Getting ' +
      esc(info.name) + ' list…</b></p><p class="muted" style="margin:.4em 0 0">' +
      num(info.addresses) + ' doors. This only happens once.</p></div>';
    var s = document.createElement('script');
    s.src = info.file;
    s.onload = function () {
      for (var j = 0; j < RISE_LISTS.length; j++) {
        if (RISE_LISTS[j].key === key) { useList(RISE_LISTS[j]); return done(); }
      }
      app.innerHTML = '<div class="card"><p style="margin:0">That list could not be read.</p></div>';
    };
    s.onerror = function () {
      app.innerHTML = '<div class="card"><p style="margin:0"><b>Could not get that list.</b></p>' +
        '<p class="muted">Open the app once where you have signal, then it works without.</p></div>';
    };
    document.head.appendChild(s);
  }

  function useList(payload) {
    LIST = payload;
    AREAS = payload.areas;
  }

  /* One door, built on demand from its position in the list. */
  function doorAt(ai, si, di) {
    var area = AREAS[ai]; if (!area) return null;
    var st = area.s[si]; if (!st) return null;
    var d = st.d[di]; if (!d) return null;
    return {
      id: String(st.b + d[0]),
      label: d[1],
      postcode: st.p[d[2] || 0],
      street: st.n,
      town: area.n,
      pos: ai + '.' + si + '.' + di
    };
  }
  function doorAtPos(pos) {
    var p = String(pos || '').split('.');
    return p.length === 3 ? doorAt(+p[0], +p[1], +p[2]) : null;
  }

  /* Doors logged in this list, tallied by town and by "town|street".
     Counts come from the saved records, never from a walk over all 99,220
     doors, so this stays instant however big the list is. */
  function tallies() {
    var key = currentKey(), byTown = {}, byStreet = {};
    for (var id in store.records) {
      var r = store.records[id];
      if (r.list !== key || r.status === 'new') continue;
      byTown[r.town] = (byTown[r.town] || 0) + 1;
      var k = r.town + '|' + r.street;
      byStreet[k] = (byStreet[k] || 0) + 1;
    }
    return { town: byTown, street: byStreet };
  }

  /* Today's tally for this list, counted once per address. */
  function todayTally() {
    var day = todayISO(), key = currentKey(), latest = {};
    store.events.forEach(function (e) {
      if (e.list === key && String(e.at).slice(0, 10) === day) latest[e.id] = e.status;
    });
    var out = { total: 0, sold: 0, call: 0, notint: 0, noans: 0, dnk: 0 };
    Object.keys(latest).forEach(function (id) {
      if (latest[id] === 'new') return;          // an undone door does not count
      out.total++;
      if (out[latest[id]] !== undefined) out[latest[id]]++;
    });
    return out;
  }

  /* ------------------------------------------------------------ rendering */

  function badge(status) {
    var s = STATUS[status] || STATUS.new;
    return '<span class="badge ' + s.cls + '">' + esc(s.short) + '</span>';
  }

  /* ---- Screen: Home ---------------------------------------------------- */
  function screenHome() {
    setTop('RISE Fibre', false);
    var info = listInfo(currentKey());
    var t = todayTally();
    var logged = 0, sold = 0, key = currentKey();
    for (var id in store.records) {
      var r = store.records[id];
      if (r.list !== key || r.status === 'new') continue;
      logged++;
      if (r.status === 'sold') sold++;
    }

    /* Whose list is being worked. Two big tabs, never a dropdown. */
    var tabs = RISE_LIST_INDEX.map(function (l) {
      return '<button type="button" class="tab tab-list" data-list="' + esc(l.key) + '" aria-pressed="' +
        (l.key === key) + '">' + (l.key === key ? '&#10004; ' : '') + esc(l.name) + '</button>';
    }).join('');

    var resume = '';
    var last = store.lastStreet[key];
    if (last) {
      var d = doorAtPos(last + '.0');
      if (d) {
        var doneOn = tallies().street[d.town + '|' + d.street] || 0;
        var totalOn = AREAS[+last.split('.')[0]].s[+last.split('.')[1]].d.length;
        if (doneOn < totalOn) {
          resume = '<button type="button" class="btn btn-secondary" data-go="#/street/' + esc(last) + '">' +
            '<span class="ico" aria-hidden="true">&#8634;</span><span>Carry on: ' + esc(d.street) +
            '<span class="sub">' + doneOn + ' of ' + totalOn + ' doors done</span></span></button>';
        }
      }
    }

    app.innerHTML =
      '<p class="muted" style="margin-bottom:.5em">' + esc(longDate(new Date())) + '</p>' +
      '<div class="tabs tabs-list">' + tabs + '</div>' +
      '<p class="small muted" style="margin-top:-.3em">' + esc(info.where) + ' · ' +
        num(info.addresses) + ' doors</p>' +

      '<button type="button" class="btn btn-primary" data-go="#/areas">' +
        '<span class="ico" aria-hidden="true">&#9995;</span><span>Start Knocking</span></button>' +
      resume +

      '<h2>Today so far</h2>' +
      '<div class="tiles">' +
        tile(t.total, 'Doors knocked') +
        tile(t.sold, 'Sold', 'sold') +
        tile(t.call, 'Callbacks') +
        tile(t.notint, 'Not interested') +
        tile(t.noans, 'No answer') +
        tile(t.dnk, 'Do not knock') +
      '</div>' +

      '<h2>Go to</h2>' +
      '<button type="button" class="btn" data-go="#/areas">' +
        '<span class="ico" aria-hidden="true">&#128506;</span><span>' +
        (AREAS.length > 1 ? 'My Areas' : 'My Streets') +
        '<span class="sub">' + num(logged) + ' of ' + num(info.addresses) + ' doors done</span></span></button>' +
      '<button type="button" class="btn" data-go="#/history">' +
        '<span class="ico" aria-hidden="true">&#128203;</span><span>History' +
        '<span class="sub">Everything you have logged · ' + num(sold) + ' sold in total</span></span></button>' +
      '<button type="button" class="btn" data-go="#/settings">' +
        '<span class="ico" aria-hidden="true">&#9881;</span><span>Settings' +
        '<span class="sub">Make the text bigger</span></span></button>';
  }

  function tile(n, label, cls) {
    return '<div class="tile ' + (cls || '') + '"><span class="tile-num">' + num(n) +
      '</span><span class="tile-lab">' + esc(label) + '</span></div>';
  }

  /* ---- Screen: areas (towns) ------------------------------------------- */
  function screenAreas() {
    /* A list covering one town only skips this screen entirely. */
    if (AREAS.length === 1) return go('#/area/0');
    setTop('My Areas', '#/');
    var done = tallies().town;

    /* Biggest first — the four real towns before the villages. */
    var order = AREAS.map(function (a, i) { return i; })
      .sort(function (x, y) { return AREAS[y].c - AREAS[x].c; });

    var rows = order.map(function (i) {
      var a = AREAS[i];
      var d = done[a.n] || 0;
      var pct = a.c ? Math.round(d / a.c * 100) : 0;
      return '<button type="button" class="row" data-go="#/area/' + i + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + esc(a.n) + '</span>' +
          '<span class="row-sub">' + num(d) + ' of ' + num(a.c) + ' done · ' +
            num(a.s.length) + (a.s.length === 1 ? ' street' : ' streets') + '</span>' +
          '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
        '</span><span class="row-chev" aria-hidden="true">&rsaquo;</span></button>';
    }).join('');

    app.innerHTML = '<p class="muted">Pick the town you are working in.</p>' + rows;
  }

  /* ---- Screen: street list within one area ----------------------------- */
  function screenStreets(ai, filter) {
    var area = AREAS[ai];
    if (!area) return go('#/areas');
    setTop(area.n, AREAS.length > 1 ? '#/areas' : '#/');
    var done = tallies().street;
    var q = (filter || '').trim().toLowerCase();

    var matches = [];
    for (var si = 0; si < area.s.length; si++) {
      var st = area.s[si];
      if (q && st.n.toLowerCase().indexOf(q) === -1 &&
          st.p.join(' ').toLowerCase().indexOf(q) === -1) continue;
      matches.push(si);
      if (matches.length >= 100) break;      // keep the page light while typing
    }

    var rows = matches.map(function (si) {
      var st = area.s[si];
      var d = done[area.n + '|' + st.n] || 0;
      var pct = st.d.length ? Math.round(d / st.d.length * 100) : 0;
      return '<button type="button" class="row" data-go="#/street/' + ai + '.' + si + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + esc(st.n) + '</span>' +
          '<span class="row-sub">' + d + ' of ' + st.d.length + ' done · ' +
            esc(st.p.slice(0, 3).join(', ')) + (st.p.length > 3 ? '…' : '') + '</span>' +
          '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
        '</span><span class="row-chev" aria-hidden="true">&rsaquo;</span></button>';
    }).join('');

    var capped = matches.length >= 100
      ? '<p class="small muted">Showing the first 100. Type in the box to find the one you want.</p>' : '';

    app.innerHTML =
      '<label for="findStreet">Find a street</label>' +
      '<input type="search" id="findStreet" placeholder="Type a street or postcode" value="' +
        esc(filter || '') + '" autocomplete="off">' +
      '<p class="small muted">' + num(area.s.length) + ' streets in ' + esc(area.n) + '</p>' +
      capped +
      (rows || '<div class="card"><p style="margin:0">No street matches that. Clear the box above to see them all.</p></div>');

    var input = $('#findStreet');
    input.addEventListener('input', function () {
      var v = input.value;
      screenStreets(ai, v);
      var again = $('#findStreet');
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });
  }

  /* ---- Screen: one street ---------------------------------------------- */
  function screenStreet(pos) {
    var p = String(pos).split('.');
    var ai = +p[0], si = +p[1];
    var area = AREAS[ai];
    if (!area || !area.s[si]) return go('#/areas');
    var st = area.s[si];

    store.lastStreet[currentKey()] = ai + '.' + si;
    save();
    setTop(st.n, '#/area/' + ai);

    var doneCount = 0, sold = 0, next = -1;
    for (var di = 0; di < st.d.length; di++) {
      var s = statusOf(String(st.b + st.d[di][0]));
      if (s !== 'new') { doneCount++; if (s === 'sold') sold++; }
      else if (next < 0) next = di;
    }

    var head =
      '<div class="card"><div class="card-head">' + esc(st.n) + '</div>' +
      '<p class="muted">' + esc(area.n) + ' · ' + doneCount + ' of ' + st.d.length + ' doors done' +
        (sold ? ' · ' + sold + ' sold' : '') + '</p>' +
      '<span class="bar"><span style="width:' +
        (st.d.length ? Math.round(doneCount / st.d.length * 100) : 0) + '%"></span></span></div>' +
      (next >= 0
        ? '<button type="button" class="btn btn-primary" data-go="#/door/' + ai + '.' + si + '.' + next + '">' +
          '<span class="ico" aria-hidden="true">&#9995;</span><span>Next door: ' +
          esc(st.d[next][1]) + '</span></button>'
        : '<div class="card"><p style="margin:0"><b>All doors on this street are done.</b></p></div>');

    var rows = st.d.map(function (d, di) {
      var id = String(st.b + d[0]);
      var r = store.records[id];
      return '<button type="button" class="row" data-go="#/door/' + ai + '.' + si + '.' + di + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + esc(d[1]) + '</span>' +
          '<span class="row-sub">' + esc(st.p[d[2] || 0]) +
            (r && r.updated ? ' · ' + esc(whenText(r.updated)) : '') + '</span>' +
          badge(statusOf(id)) +
        '</span><span class="row-chev" aria-hidden="true">&rsaquo;</span></button>';
    }).join('');

    app.innerHTML = head + '<h2>All doors on ' + esc(st.n) + '</h2>' + rows;
  }

  /* ---- Screen: one address --------------------------------------------- */
  function screenDoor(pos) {
    var a = doorAtPos(pos);
    if (!a) return go('#/areas');
    var id = a.id;
    var r = rec(id);
    setTop(a.label, '#/street/' + pos.split('.').slice(0, 2).join('.'));

    var pkgs = packagesFor(a.postcode);

    /* Package cards: speed, price, badge, and the printed increase schedule. */
    var pkgCards = pkgs.map(function (p) {
      var inc = p.increases.map(function (i) {
        return money(i.price) + ' from ' + esc(i.from);
      }).join('<br>');
      var feats = (p.features || []).map(function (f) {
        return '<li>' + esc(f) + '</li>';
      }).join('');
      return '<div class="card pkg' + (p.flagship ? ' pkg-flag' : '') + '">' +
        '<div class="pkg-top"><span class="pkg-speed">' + esc(p.speed) + '</span>' +
          (p.badge ? '<span class="pkg-badge">' + esc(p.badge) + '</span>' : '') + '</div>' +
        '<div class="pkg-price">' + money(p.price) + ' <small>a month</small></div>' +
        '<p class="pkg-note">' + esc(RISE_PRICE_NOTE) + '</p>' +
        (p.discountText ? '<p>' + esc(p.discountText) + '</p>' : '') +
        '<p class="muted">' + esc(p.blurb) + '</p>' +
        '<div class="pkg-inc"><b>Price increases to:</b>' + inc + '</div>' +
        (feats
          ? '<details class="more"><summary><span class="ico" aria-hidden="true">&#8505;</span>' +
            'More information</summary><ul class="pkg-feats">' + feats + '</ul></details>'
          : '') +
        '</div>';
    }).join('');

    /* Extra fields, shown only for the outcome that needs them. */
    var extra = '';
    if (r.status === 'call') {
      extra =
        '<div class="card">' +
        '<label for="cbDate">Call back on</label>' +
        '<input type="date" id="cbDate" data-field="callbackDate" value="' + esc(r.callbackDate || '') + '">' +
        '<label for="cbName">Their name (if given)</label>' +
        '<input type="text" id="cbName" data-field="name" value="' + esc(r.name || '') + '" autocomplete="name">' +
        '<label for="cbPhone">Phone number (if given)</label>' +
        '<input type="tel" id="cbPhone" data-field="phone" value="' + esc(r.phone || '') + '" autocomplete="tel">' +
        '</div>';
    } else if (r.status === 'sold') {
      var choices = pkgs.map(function (p) {
        return '<button type="button" class="btn ' + (r.pkg === p.id ? 'btn-lime' : '') + '" data-pkg="' + esc(p.id) + '" aria-pressed="' + (r.pkg === p.id) + '">' +
          '<span class="ico" aria-hidden="true">' + (r.pkg === p.id ? '&#10004;' : '&#9675;') + '</span>' +
          '<span>' + esc(p.speed) + '<span class="sub">' + money(p.price) +
          ' a month for 6 months</span></span></button>';
      }).join('');
      extra =
        '<div class="sold-reminder">&#10004; Now open the sign-up app to finish this sale.</div>' +
        '<div class="card">' +
        '<h3 style="margin-top:0">Which package did they choose?</h3>' + choices +
        '<label for="soldName">Their name</label>' +
        '<input type="text" id="soldName" data-field="name" value="' + esc(r.name || '') + '" autocomplete="name">' +
        '<label for="soldPhone">Phone number</label>' +
        '<input type="tel" id="soldPhone" data-field="phone" value="' + esc(r.phone || '') + '" autocomplete="tel">' +
        '</div>';
    }

    app.innerHTML =
      '<div class="card">' +
        '<div class="card-head">' + esc(a.label) + '</div>' +
        '<p class="muted" style="margin:0">' + esc(a.street) + ' · ' + esc(a.town) + ' · ' + esc(a.postcode) + '</p>' +
        '<p style="margin:.5em 0 0">Now: ' + badge(r.status) +
          (r.updated ? ' <span class="small muted">' + esc(whenText(r.updated)) + '</span>' : '') + '</p>' +
      '</div>' +

      '<h2>What happened at this door?</h2>' +
      outcomeBtn('noans',  'No Answer',             '&#128682;', 'o-noans',  r.status) +
      outcomeBtn('notint', 'Not Interested',        '&#10006;',  'o-notint', r.status) +
      outcomeBtn('call',   'Interested / Callback', '&#9742;',   'o-call',   r.status) +
      outcomeBtn('sold',   'Sold',                  '&#10004;',  'o-sold',   r.status) +
      outcomeBtn('dnk',    'Do Not Knock',          '&#9940;',   'o-dnk',    r.status) +
      extra +

      '<h2>Notes</h2>' +
      '<p class="small muted">Tap the microphone on your keyboard to speak instead of typing.</p>' +
      '<textarea id="notes" data-field="notes" placeholder="Anything worth remembering about this door">' + esc(r.notes || '') + '</textarea>' +
      '<div class="spacer"></div>' +

      '<h2>Packages available here</h2>' +
      '<p class="muted small">' + esc(a.postcode) + ' · ' + esc(RISE_TERM) + '</p>' +
      pkgCards +

      '<hr>' +
      '<button type="button" class="btn btn-primary" data-go="#/street/' + esc(pos.split('.').slice(0, 2).join('.')) + '">' +
        '<span class="ico" aria-hidden="true">&#10004;</span><span>Done — back to ' + esc(a.street) + '</span></button>' +
      (r.status !== 'new'
        ? '<button type="button" class="btn btn-secondary" data-reset="' + esc(pos) + '">' +
          '<span class="ico" aria-hidden="true">&#8634;</span><span>Undo — set back to Not started</span></button>'
        : '');

    /* Text fields save as they are typed, so nothing is ever lost. */
    Array.prototype.forEach.call(app.querySelectorAll('[data-field]'), function (f) {
      f.addEventListener('input', function () {
        var rr = rec(id);
        rr[f.dataset.field] = f.value;
        rr.updated = new Date().toISOString();
        stamp(rr, a);
        save();
        markSaved();
      });
    });
  }

  function outcomeBtn(key, label, icon, cls, current) {
    return '<button type="button" class="btn btn-outcome ' + cls + '" data-status="' + key +
      '" aria-pressed="' + (current === key) + '">' +
      '<span class="ico" aria-hidden="true">' + icon + '</span><span>' + esc(label) + '</span></button>';
  }

  var savedTimer;
  function markSaved() {
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { toast('Saved'); }, 700);
  }

  /* Keep enough of the address on the record itself that History and the
     progress counts never have to search the whole list for it. */
  function stamp(r, a) {
    r.list = currentKey();
    r.town = a.town;
    r.street = a.street;
    r.label = a.label;
    r.postcode = a.postcode;
    r.pos = a.pos;
  }

  /* Record an outcome for a door. */
  function setStatus(pos, status) {
    var a = doorAtPos(pos);
    if (!a) return;
    var r = rec(a.id);
    r.status = status;
    r.updated = new Date().toISOString();
    stamp(r, a);
    if (status !== 'call') { delete r.callbackDate; }
    if (status !== 'sold') { delete r.pkg; }
    store.events.push({ id: a.id, status: status, at: r.updated, list: currentKey() });
    if (store.events.length > 5000) store.events = store.events.slice(-4000);
    save();
    toast(STATUS[status].label + ' saved');
    render();
    /* Take him straight to the extra question the outcome asks for, so he is
       never left hunting down the page for the date or the package list. */
    var jumpTo = status === 'call' ? '#cbDate' : (status === 'sold' ? '.sold-reminder' : null);
    if (jumpTo) {
      var target = document.querySelector(jumpTo);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        if (status === 'call') target.focus({ preventScroll: true });
      }
    }
  }

  /* ---- Screen: history -------------------------------------------------- */
  var histFilter = 'all';
  function screenHistory() {
    setTop('History', '#/');
    var key = currentKey();

    var logged = Object.keys(store.records)
      .filter(function (id) {
        var r = store.records[id];
        return r.list === key && r.status !== 'new';
      })
      .map(function (id) { return { id: id, r: store.records[id] }; })
      .sort(function (x, y) { return (y.r.updated || '').localeCompare(x.r.updated || ''); });

    var shown = logged.filter(function (o) { return histFilter === 'all' || o.r.status === histFilter; });

    var tabs = '<div class="tabs">' +
      tab('all', 'All (' + logged.length + ')') +
      ORDER.map(function (k) {
        var n = logged.filter(function (o) { return o.r.status === k; }).length;
        return tab(k, STATUS[k].short + ' (' + n + ')');
      }).join('') + '</div>';

    var rows = shown.map(function (o) {
      var sub = esc(o.r.street + ' · ' + o.r.postcode);
      if (o.r.status === 'call' && o.r.callbackDate) sub += ' · Call back ' + esc(shortDate(o.r.callbackDate));
      if (o.r.status === 'sold' && o.r.pkg) {
        var p = RISE_PACKAGES.filter(function (x) { return x.id === o.r.pkg; })[0];
        if (p) sub += ' · ' + esc(p.speed);
      }
      return '<button type="button" class="row" data-go="#/door/' + esc(o.r.pos || '') + '">' +
        '<span class="row-main"><span class="row-title">' + esc(o.r.label || o.id) + '</span>' +
        '<span class="row-sub">' + sub + '</span>' +
        '<span class="row-sub">' + esc(whenText(o.r.updated)) + '</span>' +
        badge(o.r.status) + '</span>' +
        '<span class="row-chev" aria-hidden="true">&rsaquo;</span></button>';
    }).join('');

    app.innerHTML = tabs +
      (rows || '<div class="card"><p style="margin:0">Nothing logged here yet.</p></div>');

    Array.prototype.forEach.call(app.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { histFilter = b.dataset.tab; screenHistory(); });
    });
  }
  function tab(key, label) {
    return '<button type="button" class="tab" data-tab="' + esc(key) + '" aria-pressed="' +
      (histFilter === key) + '">' + esc(label) + '</button>';
  }

  /* ---- Screen: settings ------------------------------------------------- */
  function screenSettings() {
    setTop('Settings', '#/');
    var size = store.settings.textSize;
    var key = currentKey();
    var mine = 0;
    for (var id in store.records) {
      if (store.records[id].list === key && store.records[id].status !== 'new') mine++;
    }
    var info = listInfo(key);

    app.innerHTML =
      '<h2 style="margin-top:0">Text size</h2>' +
      '<p class="muted">This makes all the writing and buttons bigger.</p>' +
      sizeBtn('normal', 'Normal', size) +
      sizeBtn('large', 'Large', size) +
      sizeBtn('xl', 'Extra Large', size) +

      '<hr>' +
      '<h2>Whose list</h2>' +
      RISE_LIST_INDEX.map(function (l) {
        return '<button type="button" class="btn ' + (l.key === key ? 'btn-lime' : '') +
          '" data-list="' + esc(l.key) + '" aria-pressed="' + (l.key === key) + '">' +
          '<span class="ico" aria-hidden="true">' + (l.key === key ? '&#10004;' : '&#9675;') + '</span>' +
          '<span>' + esc(l.name) + '<span class="sub">' + esc(l.where) + ' · ' +
          num(l.addresses) + ' doors</span></span></button>';
      }).join('') +

      '<hr>' +
      '<h2>Your data</h2>' +
      '<p class="muted">Everything is kept on this phone only. It stays here when you close the app.</p>' +
      '<div class="card"><p style="margin:0"><b>' + num(mine) + '</b> doors logged out of ' +
        num(info.addresses) + ' on ' + esc(info.name) + ' list.</p></div>' +
      '<button type="button" class="btn btn-danger" id="clearBtn">' +
        '<span class="ico" aria-hidden="true">&#128465;</span><span>Clear all data</span></button>' +
      '<p class="small muted">This clears both lists. Only use it if you are moving to a new phone.</p>' +

      '<hr>' +
      '<h2>About</h2>' +
      '<p class="small muted">RISE Fibre Door Tracker.<br>Prices shown are the ' + esc(RISE_TERM) +
      ' prices.<br>Works with no signal. This app does not sign anyone up — use the company sign-up app for that.</p>';

    Array.prototype.forEach.call(app.querySelectorAll('[data-size]'), function (b) {
      b.addEventListener('click', function () {
        store.settings.textSize = b.dataset.size;
        applySettings(); save(); screenSettings(); toast('Text size changed');
      });
    });

    /* Clearing everything asks twice, in plain words. */
    $('#clearBtn').addEventListener('click', function () {
      confirmBox('Are you sure?',
        'This will delete every door you have logged on this phone, on both lists.',
        'Yes, carry on', function () {
          confirmBox('This cannot be undone',
            'All your notes, callbacks and sales will be gone for good. Delete everything?',
            'Delete everything', function () {
              store.records = {}; store.events = []; store.lastStreet = {};
              save(); toast('All data cleared'); go('#/');
            });
        });
    });
  }
  function sizeBtn(key, label, current) {
    return '<button type="button" class="btn ' + (current === key ? 'btn-lime' : '') + '" data-size="' + key +
      '" aria-pressed="' + (current === key) + '">' +
      '<span class="ico" aria-hidden="true">' + (current === key ? '&#10004;' : '&#9675;') + '</span>' +
      '<span>' + esc(label) + '</span></button>';
  }

  function applySettings() {
    document.documentElement.setAttribute('data-size', store.settings.textSize || 'normal');
  }

  /* ------------------------------------------------------------- routing */

  function setTop(title, back) {
    $('#topTitle').textContent = title;
    var b = $('#backBtn');
    if (back) { b.hidden = false; b.dataset.go = back; } else { b.hidden = true; }
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var h = location.hash || '#/';
    var parts = h.replace(/^#\//, '').split('/');
    window.scrollTo(0, 0);
    /* Nothing renders until the list being used is in memory. */
    ensureList(currentKey(), function () {
      if (parts[0] === '' || parts[0] === undefined) screenHome();
      else if (parts[0] === 'areas') screenAreas();
      else if (parts[0] === 'area') screenStreets(+parts[1] || 0, '');
      else if (parts[0] === 'street') screenStreet(parts[1]);
      else if (parts[0] === 'door') screenDoor(parts[1]);
      else if (parts[0] === 'history') screenHistory();
      else if (parts[0] === 'settings') screenSettings();
      else screenHome();
    });
  }

  window.addEventListener('hashchange', render);

  /* One tap handler for the whole app (no swipes, no long presses). */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-go],[data-status],[data-pkg],[data-reset],[data-list]');
    if (!t) return;

    /* Switching whose list is being worked. */
    if (t.dataset.list) {
      var wanted = t.dataset.list;
      if (wanted === currentKey()) return;
      store.settings.list = wanted;
      store.lastStreet = store.lastStreet || {};
      save();
      LIST = null; AREAS = [];
      go('#/');
      render();
      toast(listInfo(wanted).name + ' list');
      return;
    }

    if (t.dataset.go) { go(t.dataset.go); return; }

    if (t.dataset.status) {
      var pos = currentPos();
      if (!pos) return;
      if (t.dataset.status === 'dnk') {
        confirmBox('Mark as Do Not Knock?',
          'This house will be flagged so you know not to call here again.',
          'Yes, do not knock', function () { setStatus(pos, 'dnk'); });
      } else {
        setStatus(pos, t.dataset.status);
      }
      return;
    }

    if (t.dataset.pkg) {
      var p2 = currentPos();
      var a = doorAtPos(p2);
      if (!a) return;
      var r = rec(a.id);
      r.pkg = t.dataset.pkg;
      r.updated = new Date().toISOString();
      stamp(r, a);
      save(); toast('Package saved'); render();
      return;
    }

    if (t.dataset.reset) {
      var rpos = t.dataset.reset;
      confirmBox('Undo this door?',
        'It will go back to Not started. Your notes are kept.',
        'Yes, undo it', function () {
          var d = doorAtPos(rpos);
          if (!d) return;
          var rr = rec(d.id);
          rr.status = 'new';
          rr.updated = new Date().toISOString();
          stamp(rr, d);
          delete rr.callbackDate; delete rr.pkg;
          store.events.push({ id: d.id, status: 'new', at: rr.updated, list: currentKey() });
          save(); toast('Set back to Not started'); render();
        });
    }
  });

  function currentPos() {
    var m = (location.hash || '').match(/^#\/door\/([\d.]+)$/);
    return m ? m[1] : null;
  }

  /* ------------------------------------------------- start up + offline */

  load();
  applySettings();
  render();

  /* Cache the app so it opens instantly, even with no signal. */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('Offline mode unavailable:', e);
      });
    });
  }
})();

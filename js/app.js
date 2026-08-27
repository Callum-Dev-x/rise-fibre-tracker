/* ===========================================================================
   RISE Fibre Door Tracker — application logic
   Plain JavaScript, no framework, no network. Everything is saved straight
   into localStorage so it is still there tomorrow morning.
   Screens: Home / Streets / Street / Address / History / Settings.
   Navigation is by the URL hash so the phone's Back button works, and every
   screen also has its own Back button (tap only, no swipe gestures).
   =========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- data */

  /* The six outcomes a door can be in. `key` is what gets saved. */
  var STATUS = {
    new:    { label: 'Not started',    short: 'Not started',    cls: 'b-new',    icon: '○' },
    noans:  { label: 'No Answer',      short: 'No answer',      cls: 'b-noans',  icon: '\u{1F6AA}' },
    notint: { label: 'Not Interested', short: 'Not interested', cls: 'b-notint', icon: '✖' },
    call:   { label: 'Callback',       short: 'Callback',       cls: 'b-call',   icon: '☎' },
    sold:   { label: 'Sold',           short: 'Sold',           cls: 'b-sold',   icon: '✔' },
    dnk:    { label: 'Do Not Knock',   short: 'Do not knock',   cls: 'b-dnk',    icon: '⛔' }
  };
  var ORDER = ['sold', 'call', 'noans', 'notint', 'dnk'];   // history tab order

  var KEY = 'riseFibreTracker.v1';

  /* Everything the app remembers. Loaded once, saved on every change. */
  var store = {
    records: {},                 // uprn -> { status, updated, notes, name, phone, callbackDate, pkg }
    events: [],                  // { id, status, at } — one per logged outcome, for the day count
    settings: { textSize: 'normal' },
    lastStreet: null
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
        store.lastStreet = saved.lastStreet || null;
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

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* "Tuesday 27 August" / "27 Aug 2026" style dates — no codes or jargon. */
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

  /* ------------------------------------------------------- address lookup */

  var ADDRESSES = RISE_AREAS.addresses;
  var STREETS = RISE_AREAS.streets;
  var byId = {};
  var byStreet = {};
  ADDRESSES.forEach(function (a) {
    byId[a.id] = a;
    (byStreet[a.street] = byStreet[a.street] || []).push(a);
  });

  /* Doors done / total for one street. "Done" = anything other than Not started. */
  function streetProgress(name) {
    var list = byStreet[name] || [], done = 0, sold = 0;
    list.forEach(function (a) {
      var s = statusOf(a.id);
      if (s !== 'new') done++;
      if (s === 'sold') sold++;
    });
    return { done: done, total: list.length, sold: sold };
  }

  /* Today's tally, counted once per address (the latest outcome wins). */
  function todayTally() {
    var day = todayISO(), latest = {};
    store.events.forEach(function (e) {
      if (String(e.at).slice(0, 10) === day) latest[e.id] = e.status;
    });
    var out = { total: 0, sold: 0, call: 0, notint: 0, noans: 0, dnk: 0 };
    Object.keys(latest).forEach(function (id) {
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
    var t = todayTally();
    var totalDone = 0, totalSold = 0;
    ADDRESSES.forEach(function (a) {
      var s = statusOf(a.id);
      if (s !== 'new') totalDone++;
      if (s === 'sold') totalSold++;
    });

    var resume = '';
    if (store.lastStreet && byStreet[store.lastStreet]) {
      var p = streetProgress(store.lastStreet);
      if (p.done < p.total) {
        resume = '<button type="button" class="btn btn-secondary" data-go="#/street/' +
          esc(encodeURIComponent(store.lastStreet)) + '">' +
          '<span class="ico" aria-hidden="true">↺</span><span>Carry on: ' + esc(store.lastStreet) +
          '<span class="sub">' + p.done + ' of ' + p.total + ' doors done</span></span></button>';
      }
    }

    app.innerHTML =
      '<p class="muted" style="margin-bottom:.6em">' + esc(longDate(new Date())) + '</p>' +

      '<button type="button" class="btn btn-primary" data-go="#/streets">' +
        '<span class="ico" aria-hidden="true">✋</span><span>Start Knocking</span></button>' +
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
      '<button type="button" class="btn" data-go="#/streets">' +
        '<span class="ico" aria-hidden="true">\u{1F5FA}</span><span>My Streets' +
        '<span class="sub">' + STREETS.length + ' streets · ' + totalDone + ' of ' + ADDRESSES.length + ' doors done</span></span></button>' +
      '<button type="button" class="btn" data-go="#/history">' +
        '<span class="ico" aria-hidden="true">\u{1F4CB}</span><span>History' +
        '<span class="sub">Everything you have logged · ' + totalSold + ' sold in total</span></span></button>' +
      '<button type="button" class="btn" data-go="#/settings">' +
        '<span class="ico" aria-hidden="true">⚙</span><span>Settings' +
        '<span class="sub">Make the text bigger</span></span></button>';
  }

  function tile(n, label, cls) {
    return '<div class="tile ' + (cls || '') + '"><span class="tile-num">' + n +
      '</span><span class="tile-lab">' + esc(label) + '</span></div>';
  }

  /* ---- Screen: street list --------------------------------------------- */
  function screenStreets(filter) {
    setTop('My Streets', '#/');
    var q = (filter || '').trim().toLowerCase();
    var list = STREETS.filter(function (s) {
      if (!q) return true;
      return s.name.toLowerCase().indexOf(q) !== -1 ||
             s.postcodes.join(' ').toLowerCase().indexOf(q) !== -1;
    });

    var rows = list.map(function (s) {
      var p = streetProgress(s.name);
      var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
      return '<button type="button" class="row" data-go="#/street/' + esc(encodeURIComponent(s.name)) + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + esc(s.name) + '</span>' +
          '<span class="row-sub">' + p.done + ' of ' + p.total + ' done' +
            (p.sold ? ' · ' + p.sold + ' sold' : '') + ' · ' + esc(s.postcodes.join(', ')) + '</span>' +
          '<span class="bar"><span style="width:' + pct + '%"></span></span>' +
        '</span><span class="row-chev" aria-hidden="true">›</span></button>';
    }).join('');

    app.innerHTML =
      '<label for="findStreet">Find a street</label>' +
      '<input type="search" id="findStreet" placeholder="Type a street or postcode" value="' + esc(filter || '') + '" autocomplete="off">' +
      '<div class="spacer"></div>' +
      (rows || '<p class="card">No street matches that. Clear the box above to see them all.</p>') ;

    var input = $('#findStreet');
    input.addEventListener('input', function () {
      screenStreets(input.value);
      var again = $('#findStreet');
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });
  }

  /* ---- Screen: one street ---------------------------------------------- */
  function screenStreet(name) {
    var list = byStreet[name];
    if (!list) return go('#/streets');
    store.lastStreet = name; save();
    setTop(name, '#/streets');

    var p = streetProgress(name);
    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (statusOf(list[i].id) === 'new') { next = list[i]; break; }
    }

    var head =
      '<div class="card"><div class="card-head">' + esc(name) + '</div>' +
      '<p class="muted">' + p.done + ' of ' + p.total + ' doors done' +
        (p.sold ? ' · ' + p.sold + ' sold' : '') + '</p>' +
      '<span class="bar"><span style="width:' + (p.total ? Math.round(p.done / p.total * 100) : 0) + '%"></span></span></div>' +
      (next
        ? '<button type="button" class="btn btn-primary" data-go="#/address/' + esc(next.id) + '">' +
          '<span class="ico" aria-hidden="true">✋</span><span>Next door: ' + esc(next.label) + '</span></button>'
        : '<div class="card"><p style="margin:0"><b>All doors on this street are done.</b></p></div>');

    var rows = list.map(function (a) {
      var s = statusOf(a.id);
      var r = store.records[a.id];
      return '<button type="button" class="row" data-go="#/address/' + esc(a.id) + '">' +
        '<span class="row-main">' +
          '<span class="row-title">' + esc(a.label) + '</span>' +
          '<span class="row-sub">' + esc(a.postcode) + (r && r.updated ? ' · ' + esc(whenText(r.updated)) : '') + '</span>' +
          badge(s) +
        '</span><span class="row-chev" aria-hidden="true">›</span></button>';
    }).join('');

    app.innerHTML = head + '<h2>All doors on ' + esc(name) + '</h2>' + rows;
  }

  /* ---- Screen: one address --------------------------------------------- */
  function screenAddress(id) {
    var a = byId[id];
    if (!a) return go('#/streets');
    var r = rec(id);
    setTop(a.label, '#/street/' + encodeURIComponent(a.street));

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
          ? '<details class="more"><summary><span class="ico" aria-hidden="true">\u2139</span>' +
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
          '<span class="ico" aria-hidden="true">' + (r.pkg === p.id ? '✔' : '○') + '</span>' +
          '<span>' + esc(p.speed) + '<span class="sub">' + money(p.price) +
          ' a month for 6 months</span></span></button>';
      }).join('');
      extra =
        '<div class="sold-reminder">✔ Now open the sign-up app to finish this sale.</div>' +
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
        '<p class="muted" style="margin:0">' + esc(a.street) + ' · ' + esc(a.postcode) + '</p>' +
        '<p style="margin:.5em 0 0">Now: ' + badge(r.status) +
          (r.updated ? ' <span class="small muted">' + esc(whenText(r.updated)) + '</span>' : '') + '</p>' +
      '</div>' +

      '<h2>What happened at this door?</h2>' +
      outcomeBtn('noans',  'No Answer',            '\u{1F6AA}', 'o-noans',  r.status) +
      outcomeBtn('notint', 'Not Interested',       '✖',    'o-notint', r.status) +
      outcomeBtn('call',   'Interested / Callback', '☎',   'o-call',   r.status) +
      outcomeBtn('sold',   'Sold',                 '✔',    'o-sold',   r.status) +
      outcomeBtn('dnk',    'Do Not Knock',         '⛔',    'o-dnk',    r.status) +
      extra +

      '<h2>Notes</h2>' +
      '<p class="small muted">Tap the microphone on your keyboard to speak instead of typing.</p>' +
      '<textarea id="notes" data-field="notes" placeholder="Anything worth remembering about this door">' + esc(r.notes || '') + '</textarea>' +
      '<div class="spacer"></div>' +

      '<h2>Packages available here</h2>' +
      '<p class="muted small">' + esc(a.postcode) + ' · ' + esc(RISE_TERM) + '</p>' +
      pkgCards +

      '<hr>' +
      '<button type="button" class="btn btn-primary" data-go="#/street/' + esc(encodeURIComponent(a.street)) + '">' +
        '<span class="ico" aria-hidden="true">✔</span><span>Done — back to ' + esc(a.street) + '</span></button>' +
      (r.status !== 'new'
        ? '<button type="button" class="btn btn-secondary" data-reset="' + esc(id) + '">' +
          '<span class="ico" aria-hidden="true">↺</span><span>Undo — set back to Not started</span></button>'
        : '');

    /* Text fields save as they are typed, so nothing is ever lost. */
    Array.prototype.forEach.call(app.querySelectorAll('[data-field]'), function (f) {
      f.addEventListener('input', function () {
        var rr = rec(id);
        rr[f.dataset.field] = f.value;
        rr.updated = new Date().toISOString();
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

  /* Record an outcome for a door. */
  function setStatus(id, status) {
    var r = rec(id);
    r.status = status;
    r.updated = new Date().toISOString();
    if (status !== 'call') { delete r.callbackDate; }
    if (status !== 'sold') { delete r.pkg; }
    store.events.push({ id: id, status: status, at: r.updated });
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

    var logged = Object.keys(store.records)
      .filter(function (id) { return byId[id] && store.records[id].status !== 'new'; })
      .map(function (id) { return { a: byId[id], r: store.records[id] }; })
      .sort(function (x, y) { return (y.r.updated || '').localeCompare(x.r.updated || ''); });

    var shown = logged.filter(function (o) { return histFilter === 'all' || o.r.status === histFilter; });

    var tabs = '<div class="tabs">' +
      tab('all', 'All (' + logged.length + ')') +
      ORDER.map(function (k) {
        var n = logged.filter(function (o) { return o.r.status === k; }).length;
        return tab(k, STATUS[k].short + ' (' + n + ')');
      }).join('') + '</div>';

    var rows = shown.map(function (o) {
      var sub = esc(o.a.street + ' · ' + o.a.postcode);
      if (o.r.status === 'call' && o.r.callbackDate) sub += ' · Call back ' + esc(shortDate(o.r.callbackDate));
      if (o.r.status === 'sold' && o.r.pkg) {
        var p = RISE_PACKAGES.filter(function (x) { return x.id === o.r.pkg; })[0];
        if (p) sub += ' · ' + esc(p.speed);
      }
      return '<button type="button" class="row" data-go="#/address/' + esc(o.a.id) + '">' +
        '<span class="row-main"><span class="row-title">' + esc(o.a.label) + '</span>' +
        '<span class="row-sub">' + sub + '</span>' +
        '<span class="row-sub">' + esc(whenText(o.r.updated)) + '</span>' +
        badge(o.r.status) + '</span>' +
        '<span class="row-chev" aria-hidden="true">›</span></button>';
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
    app.innerHTML =
      '<h2 style="margin-top:0">Text size</h2>' +
      '<p class="muted">This makes all the writing and buttons bigger.</p>' +
      sizeBtn('normal', 'Normal', size) +
      sizeBtn('large', 'Large', size) +
      sizeBtn('xl', 'Extra Large', size) +

      '<hr>' +
      '<h2>Your data</h2>' +
      '<p class="muted">Everything is kept on this phone only. It stays here when you close the app.</p>' +
      '<div class="card"><p style="margin:0">' +
        '<b>' + Object.keys(store.records).filter(function (id) { return store.records[id].status !== 'new'; }).length +
        '</b> doors logged out of ' + ADDRESSES.length + '.</p></div>' +
      '<button type="button" class="btn btn-danger" id="clearBtn">' +
        '<span class="ico" aria-hidden="true">\u{1F5D1}</span><span>Clear all data</span></button>' +
      '<p class="small muted">Only use this if you are moving to a new phone.</p>' +

      '<hr>' +
      '<h2>About</h2>' +
      '<p class="small muted">RISE Fibre Door Tracker · ' + ADDRESSES.length + ' addresses · ' +
      STREETS.length + ' streets · Horsham RH13.<br>Prices shown are the ' + esc(RISE_TERM) + ' prices.<br>' +
      'Works with no signal. This app does not sign anyone up — use the company sign-up app for that.</p>';

    Array.prototype.forEach.call(app.querySelectorAll('[data-size]'), function (b) {
      b.addEventListener('click', function () {
        store.settings.textSize = b.dataset.size;
        applySettings(); save(); screenSettings(); toast('Text size changed');
      });
    });

    /* Clearing everything asks twice, in plain words. */
    $('#clearBtn').addEventListener('click', function () {
      confirmBox('Are you sure?',
        'This will delete every door you have logged on this phone.',
        'Yes, carry on', function () {
          confirmBox('This cannot be undone',
            'All your notes, callbacks and sales will be gone for good. Delete everything?',
            'Delete everything', function () {
              store.records = {}; store.events = []; store.lastStreet = null;
              save(); toast('All data cleared'); go('#/');
            });
        });
    });
  }
  function sizeBtn(key, label, current) {
    return '<button type="button" class="btn ' + (current === key ? 'btn-lime' : '') + '" data-size="' + key +
      '" aria-pressed="' + (current === key) + '">' +
      '<span class="ico" aria-hidden="true">' + (current === key ? '✔' : '○') + '</span>' +
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
    if (parts[0] === '' || parts[0] === undefined) screenHome();
    else if (parts[0] === 'streets') screenStreets('');
    else if (parts[0] === 'street') screenStreet(decodeURIComponent(parts.slice(1).join('/')));
    else if (parts[0] === 'address') screenAddress(parts[1]);
    else if (parts[0] === 'history') screenHistory();
    else if (parts[0] === 'settings') screenSettings();
    else screenHome();
  }

  window.addEventListener('hashchange', render);

  /* One tap handler for the whole app (no swipes, no long presses). */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-go],[data-status],[data-pkg],[data-reset]');
    if (!t) return;

    if (t.dataset.go) { go(t.dataset.go); return; }

    if (t.dataset.status) {
      var id = currentAddressId();
      if (!id) return;
      if (t.dataset.status === 'dnk') {
        confirmBox('Mark as Do Not Knock?',
          'This house will be flagged so you know not to call here again.',
          'Yes, do not knock', function () { setStatus(id, 'dnk'); });
      } else {
        setStatus(id, t.dataset.status);
      }
      return;
    }

    if (t.dataset.pkg) {
      var aid = currentAddressId();
      if (!aid) return;
      var r = rec(aid);
      r.pkg = t.dataset.pkg;
      r.updated = new Date().toISOString();
      save(); toast('Package saved'); render();
      return;
    }

    if (t.dataset.reset) {
      var rid = t.dataset.reset;
      confirmBox('Undo this door?',
        'It will go back to Not started. Your notes are kept.',
        'Yes, undo it', function () {
          var rr = rec(rid);
          rr.status = 'new';
          rr.updated = new Date().toISOString();
          delete rr.callbackDate; delete rr.pkg;
          store.events.push({ id: rid, status: 'new', at: rr.updated });
          save(); toast('Set back to Not started'); render();
        });
    }
  });

  function currentAddressId() {
    var m = (location.hash || '').match(/^#\/address\/(.+)$/);
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

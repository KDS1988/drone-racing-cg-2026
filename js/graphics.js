/* =====================================================================
   Графика эфира. Получает состояние от пульта (через сервер/BroadcastChannel)
   и анимирует титры: стартовый, геотитр, нижняя подпись, таблицы.
   ===================================================================== */
(function () {
  'use strict';
  var STAGE_W = 1920, STAGE_H = 1080;
  var stage = document.getElementById('stage');
  var qs = new URLSearchParams(location.search);
  if (qs.has('checker')) document.body.classList.add('checker');

  /* ---------- масштаб сцены под окно (для превью; в vMix = 1:1) ---------- */
  function fitStage() {
    var s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    var x = (window.innerWidth - STAGE_W * s) / 2, y = (window.innerHeight - STAGE_H * s) / 2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fitStage); fitStage();

  /* ---------- утилиты ---------- */
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function anim(el, kf, o) {
    if (!el) return Promise.resolve();
    var a = el.animate(kf, Object.assign({ fill: 'both', easing: 'cubic-bezier(.2,.8,.2,1)' }, o));
    return a.finished.catch(function () {});
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var EASE_IO = 'cubic-bezier(.75,0,.2,1)';
  function isCaps(w) { return w.length > 1 && w === w.toLocaleUpperCase('ru-RU') && /[А-ЯЁA-Z]/.test(w); }
  function pilotHTML(t) {
    t = String(t || '').trim();
    if (!t) return '';
    return t.split(/\s*\|\s*/).map(function (p) {
      return p.split(/\s+/).map(function (w) { return '<span class="' + (isCaps(w) ? 'sur' : 'fn') + '">' + esc(w) + '</span>'; }).join(' ');
    }).join('<span class="sep">|</span>');
  }
  function nameHTML(t) { // для нижней подписи
    return String(t || '').trim().split(/\s+/).map(function (w) { return isCaps(w) ? '<span class="sur">' + esc(w) + '</span>' : esc(w); }).join(' ');
  }
  /* ужимаем текст, если не помещается */
  function fit(el, minRatio) {
    if (!el) return;
    el.style.fontSize = '';
    var base = parseFloat(getComputedStyle(el).fontSize), fs = base, min = base * (minRatio || 0.6);
    var guard = 60;
    while (el.scrollWidth > el.clientWidth + 1 && fs > min && guard--) { fs -= 1; el.style.fontSize = fs + 'px'; }
  }
  var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

  var GEO_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12z" fill="#fff"/><circle cx="12" cy="10" r="2.8" fill="#1d6fe0"/></svg>';

  /* =================================================================== */
  /* Стартовый титр                                                      */
  /* =================================================================== */
  function StartGfx(parent, item) {
    this.root = h('div', 'start');
    this.root.innerHTML =
      '<div class="frame"><div class="kv"></div>' +
      '<div class="plate"><div class="tag"></div><div class="txt"><div class="l1"></div><div class="l2"></div></div></div>' +
      '<div class="sweep"></div></div>';
    parent.appendChild(this.root);
    this.set(item.data);
  }
  StartGfx.prototype.set = function (d) {
    d = d || {};
    var q = this.root.querySelector.bind(this.root);
    q('.tag').textContent = d.tag || '';
    q('.tag').style.display = d.tag ? '' : 'none';
    q('.l1').textContent = d.line1 || '';
    q('.l2').textContent = d.line2 || '';
    this.data = d;
    var self = this; fontsReady.then(function () { fit(self.root.querySelector('.l1'), 0.55); fit(self.root.querySelector('.l2'), 0.6); });
  };
  StartGfx.prototype.update = function (d) { this.set(d); return Promise.resolve(); };
  StartGfx.prototype.in = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.frame'), [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 750, easing: EASE_IO });
    anim(q('.kv'), [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 1600 });
    anim(q('.plate'), [{ transform: 'translateY(115px)' }, { transform: 'translateY(0)' }], { duration: 500, delay: 450 });
    anim(q('.tag'), [{ transform: 'translateX(-60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 400, delay: 700 });
    anim(q('.l1'), [{ opacity: 0, transform: 'skewX(-8deg) translateX(-30px)', textShadow: '-14px 0 0 #3cb9f4, 14px 0 0 #f95357' },
      { opacity: 1, offset: .35, textShadow: '6px 0 0 #3cb9f4, -6px 0 0 #f95357' },
      { opacity: .6, offset: .55 },
      { opacity: 1, transform: 'skewX(-8deg) translateX(0)', textShadow: '-4px 3px 0 #3cb9f4' }], { duration: 650, delay: 780 });
    anim(q('.l2'), [{ opacity: 0, letterSpacing: '.8em' }, { opacity: 1, letterSpacing: '.34em' }], { duration: 600, delay: 900 });
    return anim(q('.sweep'), [{ left: '-300px' }, { left: '1500px' }], { duration: 900, delay: 900, easing: 'ease-in-out' });
  };
  StartGfx.prototype.out = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.plate'), [{ transform: 'translateY(0)' }, { transform: 'translateY(115px)' }], { duration: 300, easing: 'ease-in' });
    return anim(q('.frame'), [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 550, delay: 150, easing: EASE_IO });
  };
  StartGfx.prototype.destroy = function () { this.root.remove(); };

  /* =================================================================== */
  /* Геотитр                                                             */
  /* =================================================================== */
  function GeoGfx(parent, item) {
    this.root = h('div', 'geo');
    this.root.innerHTML = '<div class="ico">' + GEO_SVG + '</div><div class="body"><div class="city"></div><div class="date"></div></div>';
    parent.appendChild(this.root);
    this.set(item.data);
  }
  GeoGfx.prototype.set = function (d) {
    d = d || {};
    this.root.querySelector('.city').textContent = d.city || '';
    this.root.querySelector('.date').textContent = d.date || '';
    var self = this; fontsReady.then(function () { fit(self.root.querySelector('.city'), 0.55); fit(self.root.querySelector('.date'), 0.6); });
  };
  GeoGfx.prototype.update = function (d) { this.set(d); return Promise.resolve(); };
  GeoGfx.prototype.in = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.ico'), [{ transform: 'scale(0) rotate(-20deg)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: .7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420 });
    anim(q('.body'), [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 520, delay: 160, easing: EASE_IO });
    anim(q('.city'), [{ transform: 'translateY(26px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 330 });
    return anim(q('.date'), [{ transform: 'translateY(20px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 420 });
  };
  GeoGfx.prototype.out = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.city'), [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 200, easing: 'ease-in' });
    anim(q('.date'), [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 200, easing: 'ease-in' });
    anim(q('.body'), [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 100% 0 0)' }], { duration: 380, delay: 120, easing: EASE_IO });
    return anim(q('.ico'), [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0)', opacity: 0 }], { duration: 260, delay: 380, easing: 'ease-in' });
  };
  GeoGfx.prototype.destroy = function () { this.root.remove(); };

  /* =================================================================== */
  /* Нижняя подпись                                                      */
  /* =================================================================== */
  function LowerGfx(parent, item) {
    this.root = h('div', 'lower');
    this.root.innerHTML = '<div class="brand"><img src="assets/logo.png" alt=""></div><div class="body"><div class="name"></div><div class="role"></div></div><div class="bar"></div>';
    parent.appendChild(this.root);
    this.set(item.data);
  }
  LowerGfx.prototype.set = function (d) {
    d = d || {};
    this.root.querySelector('.name').innerHTML = nameHTML(d.name);
    this.root.querySelector('.role').textContent = d.role || '';
    this.root.querySelector('.role').style.display = d.role ? '' : 'none';
    var self = this; fontsReady.then(function () { fit(self.root.querySelector('.name'), 0.55); fit(self.root.querySelector('.role'), 0.6); });
  };
  LowerGfx.prototype.update = function (d) { this.set(d); return Promise.resolve(); };
  LowerGfx.prototype.in = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.brand'), [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 380, easing: EASE_IO });
    anim(q('.brand img'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, delay: 250 });
    anim(q('.body'), [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 600, delay: 150, easing: EASE_IO });
    anim(q('.bar'), [{ transform: 'skewX(-14deg) scaleX(0)', transformOrigin: 'left' }, { transform: 'skewX(-14deg) scaleX(1)', transformOrigin: 'left' }], { duration: 500, delay: 450 });
    anim(q('.name'), [{ transform: 'translateX(-40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 360 });
    return anim(q('.role'), [{ transform: 'translateX(-40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 460 });
  };
  LowerGfx.prototype.out = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.name'), [{ opacity: 1 }, { opacity: 0, transform: 'translateX(40px)' }], { duration: 220, easing: 'ease-in' });
    anim(q('.role'), [{ opacity: 1 }, { opacity: 0, transform: 'translateX(40px)' }], { duration: 220, easing: 'ease-in' });
    anim(q('.bar'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
    anim(q('.body'), [{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 420, delay: 120, easing: EASE_IO });
    return anim(q('.brand'), [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: 0 }], { duration: 300, delay: 360, easing: 'ease-in' });
  };
  LowerGfx.prototype.destroy = function () { this.root.remove(); };

  /* =================================================================== */
  /* Таблица                                                             */
  /* =================================================================== */
  var ROLE_W = { idx: 78, rating: 128, rank: 92, okrug: 128, region: 250, place: 104, place2: 132, color: 168, channel: 100, time: 160, total: 118, score: 78, laps: 122, num: 122 };
  var TOP_MIN = 48, HEAD_H = 136, COLS_H = 48, GAP = 5;

  function TableGfx(parent, item) {
    this.parent = parent;
    this.root = h('div', 'tbl');
    this.root.innerHTML =
      '<div class="head"><img class="logo" src="assets/logo.png" alt="">' +
      '<div class="tt"><div class="t1"></div><div class="t2"></div></div><div class="pg"></div>' +
      '<div class="stripes"><div class="speed b"></div><div class="speed r"></div></div></div>' +
      '<div class="cols"></div><div class="rows"></div>';
    parent.appendChild(this.root);
    this.data = null;
    this.build(item.data);
  }
  TableGfx.prototype.layout = function (d) {
    var pilotW = d.team ? 610 : 440;
    var widths = d.columns.map(function (c) { return c.role === 'pilot' ? pilotW : (ROLE_W[c.role] || 122); });
    var W = widths.reduce(function (a, b) { return a + b; }, 0) + 40;
    var n = Math.max(1, d.rows.length);
    var avail = STAGE_H - TOP_MIN * 2 - HEAD_H - COLS_H;
    var rh = Math.max(28, Math.min(60, Math.floor(avail / n) - GAP));
    var fs = Math.max(15, Math.min(25, Math.round(rh * 0.47)));
    var H = HEAD_H + COLS_H + (d.rows.length ? n * (rh + GAP) : 80);
    var top = Math.max(TOP_MIN, Math.round((STAGE_H - H) / 2));
    return { widths: widths, W: W, rh: rh, fs: fs, top: top, tpl: widths.map(function (w) { return w + 'px'; }).join(' ') };
  };
  TableGfx.prototype.sig = function (d) {
    return d.columns.map(function (c) { return c.key + ':' + c.label; }).join(',') + '|' + d.page + '/' + d.pages + '|' + d.team;
  };
  TableGfx.prototype.cellHTML = function (col, v) {
    v = v == null ? '' : String(v);
    switch (col.role) {
      case 'pilot': return pilotHTML(v);
      case 'place': return v ? '<span class="badge">' + esc(v) + '</span>' : '';
      case 'color': {
        if (!v) return '';
        var cc = (window.CG && CG.colorOf(v)) || '#888';
        return '<span class="chip" style="--cc:' + cc + '"><i></i>' + esc(v) + '</span>';
      }
      default: return esc(v);
    }
  };
  TableGfx.prototype.cellClass = function (col) {
    var cls = (col.role === 'pilot' || col.role === 'region') ? 'l' : 'c';
    if (col.role === 'pilot') cls += ' pilot';
    if (col.role === 'time') cls += ' time';
    if (col.role === 'total') cls += ' total';
    if (col.role === 'rating' || col.role === 'idx' || col.role === 'okrug' || col.role === 'rank' || col.role === 'channel') cls += ' muted';
    return cls;
  };
  TableGfx.prototype.makeRow = function (d, r) {
    var self = this, row = h('div', 'row' + (r.hl ? ' hl' + r.hl : ''));
    row.dataset.id = r.id;
    row.style.gridTemplateColumns = this.L.tpl;
    d.columns.forEach(function (c) {
      var cell = h('div', self.cellClass(c), self.cellHTML(c, r.cells[c.key]));
      cell.dataset.k = c.key; cell.dataset.v = r.cells[c.key] == null ? '' : r.cells[c.key];
      row.appendChild(cell);
    });
    row.appendChild(h('div', 'glint'));
    return row;
  };
  TableGfx.prototype.fitRow = function (row) {
    var pc = row.querySelectorAll('.pilot');
    for (var i = 0; i < pc.length; i++) fit(pc[i], 0.62);
  };
  TableGfx.prototype.build = function (d) {
    this.data = d;
    this.L = this.layout(d);
    var L = this.L, root = this.root, self = this;
    root.style.width = L.W + 'px';
    root.style.marginLeft = (-L.W / 2) + 'px';
    root.style.top = L.top + 'px';
    root.style.setProperty('--rh', L.rh + 'px');
    root.style.setProperty('--fs', L.fs + 'px');
    root.style.setProperty('--gap', GAP + 'px');
    this.setHead(d);
    var cols = root.querySelector('.cols');
    cols.style.gridTemplateColumns = L.tpl;
    cols.innerHTML = d.columns.map(function (c) { return '<div class="' + ((c.role === 'pilot' || c.role === 'region') ? 'l' : 'c') + '">' + esc(c.label) + '</div>'; }).join('');
    var rows = root.querySelector('.rows');
    rows.innerHTML = '';
    if (!d.rows.length) rows.appendChild(h('div', 'empty', esc(d.emptyText || 'ДАННЫЕ ОЖИДАЮТСЯ')));
    d.rows.forEach(function (r) { rows.appendChild(self.makeRow(d, r)); });
    fontsReady.then(function () {
      var rs = rows.querySelectorAll('.row'); for (var i = 0; i < rs.length; i++) self.fitRow(rs[i]);
      fit(root.querySelector('.t1'), 0.55); fit(root.querySelector('.t2'), 0.6);
    });
  };
  TableGfx.prototype.setHead = function (d) {
    var q = this.root.querySelector.bind(this.root);
    q('.t1').textContent = d.title || '';
    q('.t2').textContent = d.subtitle || '';
    q('.pg').textContent = d.pages > 1 ? (d.page + 1) + ' / ' + d.pages : '';
    q('.pg').style.display = d.pages > 1 ? '' : 'none';
  };
  TableGfx.prototype.rowsIn = function (delay) {
    var rs = this.root.querySelectorAll('.rows > *'), last = Promise.resolve(), W = this.L.W;
    for (var i = 0; i < rs.length; i++) {
      var dl = (delay || 0) + i * 45;
      last = anim(rs[i], [{ opacity: 0, transform: 'translateX(-90px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: dl });
      var g = rs[i].querySelector('.glint');
      if (g) anim(g, [{ left: '-220px', opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .85 }, { left: (W - 200) + 'px', opacity: 0 }], { duration: 700, delay: dl + 160, easing: 'ease-in-out' });
    }
    return last;
  };
  TableGfx.prototype.rowsOut = function () {
    var rs = this.root.querySelectorAll('.rows > *'), last = Promise.resolve();
    for (var i = 0; i < rs.length; i++) {
      last = anim(rs[i], [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(90px)' }], { duration: 260, delay: i * 22, easing: 'ease-in' });
    }
    return last;
  };
  TableGfx.prototype.in = function () {
    var q = this.root.querySelector.bind(this.root);
    anim(q('.head'), [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 600, easing: EASE_IO });
    anim(q('.head .logo'), [{ opacity: 0, transform: 'scale(.6) rotate(-6deg)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 120 });
    anim(q('.head .stripes'), [{ transform: 'translateX(-260px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 650, delay: 200 });
    anim(q('.t1'), [{ opacity: 0, textShadow: '-16px 0 0 #3cb9f4, 16px 0 0 #f95357' }, { opacity: 1, offset: .4, textShadow: '6px 0 0 #3cb9f4, -6px 0 0 #f95357' }, { opacity: 1, textShadow: '-4px 3px 0 #3cb9f4' }], { duration: 600, delay: 250 });
    anim(q('.cols'), [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 350, delay: 300 });
    return this.rowsIn(380);
  };
  TableGfx.prototype.out = function () {
    var q = this.root.querySelector.bind(this.root);
    this.rowsOut();
    anim(q('.cols'), [{ opacity: 1 }, { opacity: 0 }], { duration: 250, delay: 150 });
    return anim(q('.head'), [{ clipPath: 'inset(0 0 0 0%)' }, { clipPath: 'inset(0 0 0 100%)' }], { duration: 450, delay: 220, easing: EASE_IO });
  };
  TableGfx.prototype.update = function (d) {
    var self = this, old = this.data;
    if (this.sig(old) !== this.sig(d) || this.layout(d).rh !== this.L.rh) {
      // смена страницы/структуры: строки уходят, перестраиваем, строки приходят
      return this.rowsOut().then(function () {
        self.build(d);
        return self.rowsIn(0);
      });
    }
    this.setHead(d);
    var rowsEl = this.root.querySelector('.rows');
    var emptyEl = rowsEl.querySelector('.empty'); if (emptyEl && d.rows.length) emptyEl.remove();
    var map = {}; Array.prototype.forEach.call(rowsEl.querySelectorAll('.row'), function (r) { map[r.dataset.id] = r; });
    // FLIP: запоминаем позиции
    var first = {}; Object.keys(map).forEach(function (k) { first[k] = map[k].getBoundingClientRect().top; });
    var keep = {}, added = [];
    d.rows.forEach(function (r) {
      var el = map[r.id];
      if (!el) { el = self.makeRow(d, r); added.push(el); }
      else {
        el.className = 'row' + (r.hl ? ' hl' + r.hl : '');
        d.columns.forEach(function (c) {
          var cell = el.querySelector('[data-k="' + c.key + '"]');
          var v = r.cells[c.key] == null ? '' : String(r.cells[c.key]);
          if (cell && cell.dataset.v !== v) {
            cell.dataset.v = v; cell.innerHTML = self.cellHTML(c, v);
            cell.classList.remove('flash'); void cell.offsetWidth; cell.classList.add('flash');
            if (c.role === 'pilot') fit(cell, 0.62);
          }
        });
      }
      keep[r.id] = 1;
      rowsEl.appendChild(el); // порядок
    });
    Object.keys(map).forEach(function (k) {
      if (!keep[k]) { var el = map[k]; anim(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateX(90px)' }], { duration: 260 }).then(function () { el.remove(); }); }
    });
    // FLIP: анимируем перестановку
    Object.keys(map).forEach(function (k) {
      if (!keep[k]) return;
      var dy = first[k] - map[k].getBoundingClientRect().top;
      if (Math.abs(dy) > 1) anim(map[k], [{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 600, easing: EASE_IO });
    });
    added.forEach(function (el, i) { self.fitRow(el); anim(el, [{ opacity: 0, transform: 'translateX(-90px)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: i * 40 }); });
    this.data = d;
    return Promise.resolve();
  };
  TableGfx.prototype.destroy = function () { this.root.remove(); };

  var TYPES = { start: StartGfx, geo: GeoGfx, lower: LowerGfx, table: TableGfx };

  /* =================================================================== */
  /* Слои: очередь анимаций, всегда применяется последнее состояние      */
  /* =================================================================== */
  function Layer(el) { this.el = el; this.cur = null; this.busy = false; this.pending = undefined; }
  Layer.prototype.set = function (item) {
    this.pending = item || null;
    if (!this.busy) this._run();
  };
  Layer.prototype._run = function () {
    var self = this;
    if (this.pending === undefined) { this.busy = false; return; }
    var item = this.pending; this.pending = undefined; this.busy = true;
    this._apply(item).catch(function (e) { console.error(e); }).then(function () { self._run(); });
  };
  Layer.prototype._apply = function (item) {
    var self = this, cur = this.cur;
    if (!item) {
      if (!cur) return Promise.resolve();
      this.cur = null;
      return cur.out().then(function () { cur.destroy(); });
    }
    var same = cur && cur.key === item.key && cur.type === item.type && cur.take === item.take;
    if (same) {
      if (JSON.stringify(cur.lastData) === JSON.stringify(item.data)) return Promise.resolve();
      cur.lastData = item.data;
      return cur.update(item.data);
    }
    var pre = cur ? cur.out().then(function () { cur.destroy(); }) : Promise.resolve();
    return pre.then(function () {
      var T = TYPES[item.type];
      if (!T) { self.cur = null; return; }
      var g = new T(self.el, item);
      g.key = item.key; g.type = item.type; g.take = item.take; g.lastData = item.data;
      self.cur = g;
      return fontsReady.then(function () { return g.in(); });
    });
  };

  var layers = { center: new Layer(document.getElementById('L-center')), bottom: new Layer(document.getElementById('L-bottom')) };

  function applyState(st) {
    if (!st) return;
    layers.center.set(st.center || null);
    layers.bottom.set(st.bottom || null);
  }

  if (!qs.has('pvw')) new CG.Bus(applyState, function () {});
  window.__cgApply = applyState; // для отладки
})();

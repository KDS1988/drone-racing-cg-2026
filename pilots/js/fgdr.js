/* =====================================================================
   «Пилоты Будущего» — протоколы pro.fgdrrace.online/api/protocols/*
   Разбор JSON и построение таблиц/карточек для графики.
   Все времена в JSON — миллисекунды (timeUnit: "milliseconds").
   ===================================================================== */
(function (root) {
  'use strict';
  var CG = root.CG;

  /* Дисциплины. max — максимум баллов (по данным: 500 у всех, у «Класс 75» — 1000). */
  var DISC = [
    { key: 'simulator', short: 'Симулятор', title: 'Технический симулятор', col: 'Симулятор', max: 500 },
    { key: 'assembly', short: 'Сборка', title: 'Сборка дрона', col: 'Сборка', max: 500 },
    { key: 'basketball', short: 'Баскетбол', title: 'Дрон-баскетбол', col: 'Баскетбол', max: 500 },
    { key: 'monitoring', short: 'Мониторинг', title: 'Скоростной мониторинг', col: 'Мониторинг', max: 500 },
    { key: 'race75', short: 'Класс 75', title: 'Гонка · Класс 75 мм', col: 'Класс 75', max: 1000 }
  ];
  var BY = {}; DISC.forEach(function (d) { BY[d.key] = d; });
  var ENDPOINTS = ['all'].concat(DISC.map(function (d) { return d.key; }));
  var EVENT = 'Пилоты Будущего · 2026';

  /* ---------------- форматирование ---------------- */
  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
  /** 4590 → «4,59»; 66360 → «1:06,36»; 66365 → «1:06,365» */
  var PREC = {};   // дисциплина → знаков после запятой (2 или 3: по точности данных протокола)
  function fmtTime(ms, dec) {
    if (ms == null || ms === '' || isNaN(ms)) return '';
    ms = Math.round(+ms);
    if (dec !== 3) ms = Math.round(ms / 10) * 10;
    var m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    var frac = dec === 3 ? pad(r, 3) : pad(r / 10, 2);
    return (m ? m + ':' + pad(s, 2) : String(s)) + ',' + frac;
  }
  /** 493.0555 → «493,1»; 500 → «500» */
  function fmtScore(v) {
    if (v == null || v === '' || isNaN(v)) return '';
    v = Math.round(+v * 10) / 10;
    return String(v).replace('.', ',');
  }
  function upper(s) { return String(s).toLocaleUpperCase('ru-RU'); }
  /** «Александр Смирнов» → «Александр СМИРНОВ» (в протоколах порядок «Имя Фамилия») */
  function fmtName(n) {
    var w = String(n || '').trim().split(/\s+/).filter(Boolean);
    if (w.length < 2) return w.join(' ');
    return w[0] + ' ' + upper(w.slice(1).join(' '));
  }
  /** «Республика Татарстан (Татарстан)» → «Республика Татарстан» */
  function fmtRegion(r) {
    r = String(r || '').trim();
    var m = /^(.*?)\s*\(([^)]*)\)$/.exec(r);
    if (m && m[1].indexOf(m[2]) >= 0) r = m[1];
    return r.replace(/\s+-\s+/g, ' – ');
  }
  var ST_TXT = { DNF: 'СХОД', DSQ: 'ДИСКВ.', DNS: 'НЕ СТАРТ.' };
  function stText(st) { return ST_TXT[st] || ''; }
  function done(o) { return o && o.status && o.status !== 'PENDING'; }

  /* ---------------- нормализация ----------------
     Храним по каждой дисциплине строки вида { id, name, region, ...поля дисциплины }.
     Берём самую свежую версию: отдельный протокол дисциплины или срез из «all». */
  function Store() { this.raw = {}; this.disc = {}; this.all = null; this.seen = {}; this.recent = {}; this.ready = {}; }
  Store.prototype.put = function (name, json) {
    if (!json || !Array.isArray(json.rows)) throw new Error('нет rows в протоколе «' + name + '»');
    this.raw[name] = json;
    var ver = +json.version || 0;
    if (name === 'all') {
      this.all = json;
      var self = this;
      DISC.forEach(function (d) {
        var cur = self.disc[d.key];
        if (cur && cur.version > ver) return;
        self.setDisc(d.key, ver, json.generatedAt, json.rows.map(function (r) {
          var x = Object.assign({}, (r.disciplines || {})[d.key] || { status: 'PENDING', score: 0, rank: null });
          x.id = r.id; x.name = r.name; x.region = r.region; return x;
        }));
      });
    } else if (BY[name]) {
      var c = this.disc[name];
      if (!c || c.version <= ver) this.setDisc(name, ver, json.generatedAt, json.rows);
    }
  };
  Store.prototype.setDisc = function (key, ver, at, rows) {
    var prev = this.seen[key], now = Date.now(), seen = {};
    var recent = this.recent[key] = this.recent[key] || [];
    rows.forEach(function (r) {
      var sig = r.status + '|' + (r.score || 0) + '|' + (r.complete ? 1 : 0);
      seen[r.id] = sig;
      // «свежий результат»: изменился итог участника после первой загрузки
      if (prev && prev[r.id] !== sig && done(r)) {
        for (var i = recent.length - 1; i >= 0; i--) if (recent[i].id === r.id) recent.splice(i, 1);
        recent.unshift({ id: r.id, at: now });
      }
    });
    if (recent.length > 30) recent.length = 30;
    this.seen[key] = seen;
    // точность времени: если в протоколе есть миллисекунды (не кратные 10) — показываем 3 знака
    var ms3 = rows.some(function (r) {
      return ['timeMs', 'calculatedTimeMs', 'bestTimeMs', 'totalTimeMs', 'lastTagTimeMs'].some(function (f) { return r[f] != null && r[f] % 10 !== 0; }) ||
        (r.attempts || []).some(function (a) { return a.timeMs != null && a.timeMs % 10 !== 0; });
    });
    PREC[key] = ms3 ? 3 : 2;
    this.disc[key] = { version: ver, at: at, rows: rows };
    this.ready[key] = true;
  };
  Store.prototype.has = function (key) { return key === 'all' ? !!this.all : !!this.disc[key]; };
  Store.prototype.version = function () {
    var v = this.all ? +this.all.version || 0 : 0;
    var self = this; DISC.forEach(function (d) { if (self.disc[d.key]) v = Math.max(v, self.disc[d.key].version); });
    return v;
  };

  /* ---------------- сортировка ---------------- */
  function byRank(a, b) {
    var ra = a.rank == null ? 1e9 : a.rank, rb = b.rank == null ? 1e9 : b.rank;
    if (ra !== rb) return ra - rb;
    var sa = done(a) ? (a.status === 'OK' ? 0 : 1) : 2, sb = done(b) ? (b.status === 'OK' ? 0 : 1) : 2;
    if (sa !== sb) return sa - sb;
    return String(a.name).localeCompare(String(b.name), 'ru');
  }
  function placeOf(r) { return r.status === 'OK' && r.rank != null ? String(r.rank) : ''; }

    function T(key, ms) { return fmtTime(ms, PREC[key] || 2); }
/* ---------------- значения дисциплин ---------------- */
  function resultText(key, r) {
    if (!r) return '';
    if (r.status && r.status !== 'OK' && r.status !== 'PENDING') return stText(r.status);
    if (r.status === 'PENDING') return '';
    switch (key) {
      case 'simulator': return T(key, r.calculatedTimeMs != null ? r.calculatedTimeMs : r.timeMs);
      case 'assembly': return T(key, r.totalTimeMs);
      case 'basketball': return r.hits != null ? String(r.hits) : '';
      case 'monitoring': return r.tags != null ? r.tags + '/' + (r.maxTags || 7) : '';
      case 'race75': return T(key, r.bestTimeMs != null ? r.bestTimeMs : r.calculatedTimeMs);
    }
    return '';
  }
  function attemptCell(key, a) {
    if (!a || a.status === 'PENDING') return '';
    if (a.status !== 'OK') return stText(a.status) || a.status;
    if (key === 'race75') return T(key, a.timeMs);
    return a.count != null ? String(a.count) : '';
  }

  /* ---------------- таблицы ---------------- */
  var COLS = {
    place: { key: 'place', label: 'Место', role: 'place' },
    pilot: { key: 'pilot', label: 'Пилот', role: 'pilot' },
    region: { key: 'region', label: 'Регион', role: 'region' },
    score: { key: 'score', label: 'Баллы', role: 'total' }
  };
  function baseCells(r) { return { place: placeOf(r), pilot: fmtName(r.name), region: fmtRegion(r.region) }; }

  function discColumns(key) {
    var c = [COLS.place, COLS.pilot, COLS.region];
    if (key === 'simulator') c = c.concat([{ key: 'time', label: 'Время', role: 'time' }]);
    if (key === 'assembly') c = c.concat([
      { key: 'time', label: 'Время сборки', role: 'time' },
      { key: 'minor', label: 'Ошибки', role: 'score' },
      { key: 'critical', label: 'Крит. ошибки', role: 'score' },
      { key: 'penalty', label: 'Штраф', role: 'time' },
      { key: 'total', label: 'Итог', role: 'time' }]);
    if (key === 'basketball') c = c.concat([1, 2, 3, 4, 5].map(function (n) { return { key: 'a' + n, label: String(n), role: 'score' }; }))
      .concat([{ key: 'hits', label: 'Попадания', role: 'num' }]);
    if (key === 'monitoring') c = c.concat([{ key: 'tags', label: 'Метки', role: 'num' }, { key: 'time', label: 'Время', role: 'time' }]);
    if (key === 'race75') c = c.concat([{ key: 'a1', label: 'Попытка 1', role: 'time' }, { key: 'a2', label: 'Попытка 2', role: 'time' },
      { key: 'best', label: 'Лучшее', role: 'time' }]);
    return c.concat([COLS.score]);
  }
  function discCells(key, r) {
    var c = baseCells(r), dnf = r.status && r.status !== 'OK' && r.status !== 'PENDING';
    var att = r.attempts || [];
    if (key === 'simulator') c.time = resultText(key, r);
    if (key === 'assembly') {
      c.time = dnf ? stText(r.status) : T(key, r.timeMs);
      c.minor = r.minorErrors ? String(r.minorErrors) : (done(r) ? '0' : '');
      c.critical = r.criticalErrors ? String(r.criticalErrors) : (done(r) ? '0' : '');
      c.penalty = r.penaltyMs ? '+' + T(key, r.penaltyMs) : '';
      c.total = dnf ? '' : T(key, r.totalTimeMs);
    }
    if (key === 'basketball') {
      for (var i = 1; i <= 5; i++) c['a' + i] = attemptCell(key, att[i - 1]);
      c.hits = done(r) || r.hits ? String(r.hits || 0) : '';
    }
    if (key === 'monitoring') {
      var a0 = att[0] || {};
      c.tags = done(r) || r.tags ? (r.tags || 0) + '/' + (r.maxTags || 7) : '';
      c.time = dnf ? stText(r.status) : T(key, r.lastTagTimeMs != null ? r.lastTagTimeMs : a0.durationMs);
    }
    if (key === 'race75') {
      c.a1 = attemptCell(key, att[0]); c.a2 = attemptCell(key, att[1]);
      c.best = dnf ? stText(r.status) : T(key, r.bestTimeMs);
    }
    c.score = done(r) ? fmtScore(r.score) : '';
    return c;
  }

  /** общий зачёт: строки из «all» (нужен протокол all) */
  function overallRows(S) {
    if (!S.all) return null;
    return S.all.rows.slice().sort(byRank);
  }
  function anyResult(r) {
    var d = r.disciplines || {};
    return Object.keys(d).some(function (k) { return done(d[k]); }) || (r.score || 0) > 0;
  }
  function overallCells(r) {
    var c = baseCells(r);
    c.place = r.rank != null && anyResult(r) ? String(r.rank) : '';
    DISC.forEach(function (d) {
      var x = (r.disciplines || {})[d.key];
      c[d.key] = !x ? '' : x.status === 'OK' ? fmtScore(x.score) : (done(x) ? stText(x.status) : '');
    });
    c.done = String(DISC.filter(function (d) { return done((r.disciplines || {})[d.key]); }).length) + '/' + DISC.length;
    c.score = fmtScore(r.score);
    return c;
  }
  var OVERALL_COLS = [COLS.place, COLS.pilot, COLS.region].concat(DISC.map(function (d) {
    return { key: d.key, label: d.col, role: 'score' };
  })).concat([{ key: 'done', label: 'Пройдено', role: 'num' }, { key: 'score', label: 'Сумма', role: 'total' }]);

  /** командный (региональный) зачёт: сумма N лучших участников региона (N=0 — все) */
  function regionStandings(S, n) {
    if (!S.all) return null;
    var map = {};
    S.all.rows.forEach(function (r) {
      var k = String(r.region || '—');
      var g = map[k] = map[k] || { region: k, list: [], all: 0 };
      g.all++;
      if (anyResult(r)) g.list.push(r);
    });
    var arr = Object.keys(map).map(function (k) {
      var g = map[k];
      g.list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      var take = n > 0 ? g.list.slice(0, n) : g.list;
      g.sum = take.reduce(function (s, r) { return s + (+r.score || 0); }, 0);
      g.counted = take.length;
      g.avg = g.list.length ? g.list.reduce(function (s, r) { return s + (+r.score || 0); }, 0) / g.list.length : 0;
      g.best = g.list[0] || null;
      return g;
    }).filter(function (g) { return g.list.length; });
    arr.sort(function (a, b) { return (b.sum - a.sum) || (b.avg - a.avg) || a.region.localeCompare(b.region, 'ru'); });
    var place = 0, prev = null;
    arr.forEach(function (g, i) { if (prev === null || Math.abs(g.sum - prev) > 1e-9) place = i + 1; g.place = place; prev = g.sum; });
    return arr;
  }

  /** «Ход соревнований» по дисциплинам */
  function progress(S) {
    return DISC.map(function (d) {
      var x = S.disc[d.key]; if (!x) return { d: d, rows: null };
      var ok = 0, dnf = 0, pend = 0, leader = null;
      x.rows.forEach(function (r) {
        if (r.status === 'OK') ok++; else if (r.status === 'PENDING') pend++; else dnf++;
        if (r.status === 'OK' && r.rank === 1 && !leader) leader = r;
      });
      return { d: d, ok: ok, dnf: dnf, pend: pend, total: x.rows.length, leader: leader };
    });
  }

  /**
   * Каталог таблиц. Возвращает список { id, label, group, count, kind:'fgdr' }.
   * Группы: fg-common (общие), fg-<дисциплина>, fg-pilot (индивидуальные).
   */
  function catalog(S, opt) {
    var items = [];
    var allN = S.all ? S.all.rows.filter(anyResult).length : null;
    items.push({ id: 'f:all', label: 'Общий зачёт', group: 'fg-common', count: allN, need: 'all' });
    items.push({ id: 'f:all:top', label: 'Общий зачёт · Топ-10', group: 'fg-common', count: allN == null ? null : Math.min(10, allN), need: 'all' });
    var reg = S.all ? regionStandings(S, opt.teamN) : null;
    items.push({ id: 'f:regions', label: 'Командный зачёт регионов', group: 'fg-common', count: reg ? reg.length : null, need: 'all' });
    items.push({ id: 'f:region', label: 'Сборная региона' + (opt.region ? ': ' + fmtRegion(opt.region) : ''), group: 'fg-common', need: 'all' });
    items.push({ id: 'f:leaders', label: 'Лидеры дисциплин', group: 'fg-common', need: 'all' });
    items.push({ id: 'f:progress', label: 'Ход соревнований', group: 'fg-common', need: 'all' });
    DISC.forEach(function (d) {
      var x = S.disc[d.key], n = x ? x.rows.filter(done).length : null;
      items.push({ id: 'f:d:' + d.key, label: 'Протокол', group: 'fg-' + d.key, count: n, need: d.key });
      items.push({ id: 'f:d:' + d.key + ':top', label: 'Топ-10', group: 'fg-' + d.key, count: n == null ? null : Math.min(10, n), need: d.key });
      items.push({ id: 'f:d:' + d.key + ':last', label: 'Последние результаты', group: 'fg-' + d.key, count: (S.recent[d.key] || []).length, need: d.key });
    });
    items.forEach(function (it) { it.type = 'table'; it.layer = 'center'; it.kind = 'fgdr'; });
    items.push({ id: 'p:card', type: 'pcard', layer: 'bottom', kind: 'fgdr', group: 'fg-pilot', need: 'all',
      label: 'Карточка пилота · общий зачёт' });
    items.push({ id: 'p:live', type: 'pcard', layer: 'bottom', kind: 'fgdr', group: 'fg-pilot', need: opt.liveDisc || 'race75',
      label: 'Пилот в дисциплине · ' + ((BY[opt.liveDisc] || BY.race75).short) });
    return items;
  }
  var GROUPS = [{ k: 'fg-common', t: 'Общие зачёты' }].concat(DISC.map(function (d) { return { k: 'fg-' + d.key, t: d.title }; }))
    .concat([{ k: 'fg-pilot', t: 'Индивидуальные' }]);

  /** «сырой» вид таблицы (как rawTable в пульте): { columns, rows:[{id,cells}], title, subtitle, defaultHidden } */
  function table(S, id, opt) {
    var m;
    if (id === 'f:all' || id === 'f:all:top') {
      var rows = overallRows(S); if (!rows) return null;
      rows = rows.filter(anyResult);
      if (id === 'f:all:top') rows = rows.slice(0, 10);
      return { columns: OVERALL_COLS, title: id === 'f:all:top' ? 'Общий зачёт · Топ-10' : 'Общий зачёт',
        subtitle: 'Сумма баллов пяти дисциплин' + (S.all.provisional ? ' · предварительно' : ''),
        rows: rows.map(function (r) { return { id: r.id, cells: overallCells(r) }; }), defaultHidden: { done: 1 } };
    }
    if (id === 'f:regions') {
      var reg = regionStandings(S, opt.teamN); if (!reg) return null;
      return {
        columns: [COLS.place, { key: 'region', label: 'Регион', role: 'pilot' }, { key: 'n', label: 'Участники', role: 'num' },
          { key: 'best', label: 'Лучший пилот', role: 'region' }, { key: 'avg', label: 'Средний балл', role: 'total' }, { key: 'score', label: 'Сумма', role: 'total' }],
        title: 'Командный зачёт регионов',
        subtitle: (opt.teamN > 0 ? 'Сумма ' + opt.teamN + ' лучших участников' : 'Сумма баллов всех участников') + ' · предварительный расчёт',
        rows: reg.map(function (g) {
          return { id: 'reg:' + g.region, cells: { place: String(g.place), region: fmtRegion(g.region), n: g.list.length + (g.all !== g.list.length ? '/' + g.all : ''),
            best: g.best ? fmtName(g.best.name) : '', avg: fmtScore(g.avg), score: fmtScore(g.sum) } };
        }), defaultHidden: { best: 1, avg: 1 }
      };
    }
    if (id === 'f:region') {
      if (!S.all) return null;
      var R = opt.region || '';
      var list = S.all.rows.filter(function (r) { return r.region === R; }).sort(byRank);
      return { columns: OVERALL_COLS, title: R ? 'Сборная: ' + fmtRegion(R) : 'Сборная региона', subtitle: 'Участники региона · общий зачёт',
        rows: list.map(function (r) { return { id: r.id, cells: overallCells(r) }; }), defaultHidden: { region: 1 } };
    }
    if (id === 'f:leaders') {
      if (!S.all) return null;
      return {
        columns: [{ key: 'disc', label: 'Дисциплина', role: 'region' }, COLS.pilot, COLS.region, { key: 'res', label: 'Результат', role: 'time' }, COLS.score],
        title: 'Лидеры дисциплин', subtitle: EVENT,
        rows: DISC.map(function (d) {
          var x = S.disc[d.key], r = x && x.rows.filter(function (q) { return q.status === 'OK' && q.rank === 1; })[0];
          return { id: 'lead:' + d.key, cells: { disc: d.short, pilot: r ? fmtName(r.name) : '', region: r ? fmtRegion(r.region) : '',
            res: r ? resultText(d.key, r) + (d.key === 'basketball' ? ' попад.' : '') : 'ожидается', score: r ? fmtScore(r.score) : '' } };
        }), defaultHidden: {}
      };
    }
    if (id === 'f:progress') {
      var pr = progress(S);
      return {
        columns: [{ key: 'disc', label: 'Дисциплина', role: 'region' }, { key: 'ok', label: 'Финишировали', role: 'num' },
          { key: 'dnf', label: 'Сход', role: 'num' }, { key: 'pend', label: 'Ожидают', role: 'num' }, { key: 'pct', label: 'Готово', role: 'num' },
          { key: 'leader', label: 'Лидер', role: 'pilot' }],
        title: 'Ход соревнований', subtitle: EVENT,
        rows: pr.map(function (p) {
          return { id: 'pr:' + p.d.key, cells: p.total == null ? { disc: p.d.short } : { disc: p.d.short, ok: String(p.ok), dnf: String(p.dnf), pend: String(p.pend),
            pct: p.total ? Math.round((p.ok + p.dnf) / p.total * 100) + '%' : '', leader: p.leader ? fmtName(p.leader.name) : '' } };
        }), defaultHidden: {}
      };
    }
    if ((m = /^f:d:(\w+)(?::(top|last))?$/.exec(id))) {
      var key = m[1], mode = m[2], d = BY[key], x = S.disc[key];
      if (!d || !x) return null;
      var rs;
      if (mode === 'last') {
        var idx = {}; x.rows.forEach(function (r) { idx[r.id] = r; });
        rs = (S.recent[key] || []).map(function (q) { return idx[q.id]; }).filter(Boolean).slice(0, 8);
      } else {
        rs = x.rows.filter(done).sort(byRank);
        if (mode === 'top') rs = rs.filter(function (r) { return r.status === 'OK'; }).slice(0, 10);
      }
      return { columns: discColumns(key), title: d.title + (mode === 'top' ? ' · Топ-10' : mode === 'last' ? ' · Последние результаты' : ''),
        subtitle: mode === 'last' ? 'Новые результаты — сверху' : EVENT,
        rows: rs.map(function (r) { return { id: r.id, cells: discCells(key, r) }; }), defaultHidden: {},
        emptyText: mode === 'last' ? 'ЖДЁМ НОВЫХ РЕЗУЛЬТАТОВ' : 'РЕЗУЛЬТАТЫ ОЖИДАЮТСЯ' };
    }
    return null;
  }

  /* ---------------- индивидуальные карточки ---------------- */
  function findPilot(S, id) {
    if (S.all) { var r = S.all.rows.filter(function (x) { return x.id === id; })[0]; if (r) return r; }
    var found = null;
    DISC.forEach(function (d) { var x = S.disc[d.key]; if (!found && x) found = x.rows.filter(function (q) { return q.id === id; })[0] || null; });
    return found;
  }
  /** список пилотов для поиска в пульте */
  function pilots(S) {
    var src = S.all ? S.all.rows : null;
    if (!src) DISC.forEach(function (d) { if (!src && S.disc[d.key]) src = S.disc[d.key].rows; });
    return (src || []).map(function (r) { return { id: r.id, name: r.name, region: r.region }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
  }
  function regions(S) {
    var m = {}; (S.all ? S.all.rows : []).forEach(function (r) { m[r.region] = (m[r.region] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'ru'); }).map(function (k) { return { region: k, n: m[k] }; });
  }

  /** карточка пилота: общий зачёт (mode 'card') или результат в дисциплине (mode = ключ дисциплины) */
  function card(S, pilotId, mode) {
    var p = findPilot(S, pilotId);
    if (!p) return null;
    var out = { name: fmtName(p.name), region: fmtRegion(p.region), cells: [] };
    if (mode === 'card') {
      var hasAll = S.all && p.disciplines;
      out.tag = 'Общий зачёт';
      out.place = hasAll && anyResult(p) && p.rank != null ? String(p.rank) : '—';
      out.placeLabel = 'Место';
      out.total = hasAll ? fmtScore(p.score) : '';
      out.totalLabel = 'Баллы';
      DISC.forEach(function (d) {
        var x = hasAll ? p.disciplines[d.key] : null;
        out.cells.push({ label: d.short, value: !x ? '—' : x.status === 'OK' ? fmtScore(x.score) : done(x) ? stText(x.status) : '—',
          sub: x && x.status === 'OK' && x.rank != null ? x.rank + ' место' : '', st: !x || !done(x) ? 'pending' : x.status === 'OK' ? (x.rank === 1 ? 'best' : 'ok') : 'dnf' });
      });
      return out;
    }
    var d = BY[mode]; if (!d) return null;
    var xd = S.disc[mode], r = xd ? xd.rows.filter(function (q) { return q.id === pilotId; })[0] : (p.disciplines || {})[mode];
    if (!r) return out;
    var dnf = r.status && r.status !== 'OK' && r.status !== 'PENDING';
    out.tag = d.title;
    out.place = r.status === 'OK' && r.rank != null ? String(r.rank) : dnf ? '—' : '…';
    out.placeLabel = 'Место';
    out.total = done(r) ? fmtScore(r.score) : '';
    out.totalLabel = 'Баллы';
    var att = r.attempts || [];
    function st(a) { return !a || a.status === 'PENDING' ? 'pending' : a.status === 'OK' ? 'ok' : 'dnf'; }
    if (mode === 'basketball') {
      att.forEach(function (a, i) { out.cells.push({ label: 'Попытка ' + (i + 1), value: attemptCell(mode, a) || '—', st: st(a) }); });
      out.cells.push({ label: 'Попадания', value: String(r.hits || 0), st: done(r) ? 'best' : 'live' });
    } else if (mode === 'race75') {
      att.forEach(function (a, i) {
        var best = a.status === 'OK' && r.bestTimeMs != null && a.timeMs === r.bestTimeMs;
        out.cells.push({ label: 'Попытка ' + (i + 1), value: attemptCell(mode, a) || '—', st: best ? 'best' : st(a) });
      });
      out.cells.push({ label: 'Лучшее время', value: dnf ? stText(r.status) : T(mode, r.bestTimeMs) || '—', st: dnf ? 'dnf' : r.bestTimeMs != null ? 'best' : 'pending' });
    } else if (mode === 'monitoring') {
      out.cells.push({ label: 'Метки', pips: r.tags || 0, max: r.maxTags || 7, value: (r.tags || 0) + '/' + (r.maxTags || 7), st: done(r) ? 'ok' : 'live' });
      out.cells.push({ label: 'Время', value: dnf ? stText(r.status) : T(mode, r.lastTagTimeMs) || '—', st: dnf ? 'dnf' : st(r) });
    } else if (mode === 'simulator') {
      out.cells.push({ label: 'Время', value: resultText(mode, r) || '—', st: st(r) });
    } else if (mode === 'assembly') {
      out.cells.push({ label: 'Время', value: dnf ? stText(r.status) : T(mode, r.timeMs) || '—', st: st(r) });
      out.cells.push({ label: 'Ошибки', value: String(r.minorErrors || 0), st: r.minorErrors ? 'dnf' : st(r) });
      out.cells.push({ label: 'Крит.', value: String(r.criticalErrors || 0), st: r.criticalErrors ? 'dnf' : st(r) });
      out.cells.push({ label: 'Штраф', value: r.penaltyMs ? '+' + T(mode, r.penaltyMs) : '0', st: r.penaltyMs ? 'dnf' : st(r) });
      out.cells.push({ label: 'Итог', value: T(mode, r.totalTimeMs) || '—', st: done(r) ? 'best' : 'pending' });
    }
    return out;
  }

  CG.FGDR = {
    DISC: DISC, BY: BY, ENDPOINTS: ENDPOINTS, GROUPS: GROUPS, Store: Store,
    catalog: catalog, table: table, card: card, pilots: pilots, regions: regions,
    fmtTime: fmtTime, fmtScore: fmtScore, fmtName: fmtName, fmtRegion: fmtRegion
  };
})(window);

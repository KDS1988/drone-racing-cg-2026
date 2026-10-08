/*!
 * Гонки дронов — Первенство России 2026 · CG-пакет
 * core.js — общий модуль: конфиг, CSV, разбор листов Google Sheets, имена, шина синхронизации.
 * Работает и в браузере (window.CG), и в Node (require) — для тестов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Конфигурация по умолчанию                                           */
  /* ------------------------------------------------------------------ */
  var DEFAULT_CONFIG = {
    sheetId: '1np8-5BWWoadGkBZ2pqfEHBzXOesoQN1hMA-1ylbv8Xo',
    fbUrl: 'https://kds88-title-default-rtdb.europe-west1.firebasedatabase.app', // облачная синхронизация (Firebase RTDB)
    source: 'google',          // 'google' | 'demo'
    pollActive: 3,             // сек — опрос листа, который в эфире / в редакторе
    pollAll: 30,               // сек — фоновый опрос остальных листов
    eventTitle: 'Первенство России',
    sheetsVersion: 2,
    sheets: null              // заполняется из SHEET_CATALOG
  };

  /* Все листы судейской таблицы (имя → gid). on — показывать в пульте. */
  var SHEET_CATALOG = [
    ['75 ЛЗ М', '1000505927'], ['75 ЛЗ Ж', '920113390'], ['75 КЗ М', '1035349723'], ['75 КЗ Ж', '1134263816'],
    ['200 ЛЗ М', '691904425'], ['200 ЛЗ Ж', '1033755617'], ['200 КЗ М', '936846371'], ['200 КЗ Ж', '1512937086'],
    ['330 ЛЗ М', '1782500014'], ['330 ЛЗ Ж', '2107423122'], ['330 КЗ М', '1391772719'], ['330 КЗ Ж', '855223771'],
    ['ТС ЛЗ М', '2029195399'], ['ТС ЛЗ Ж', '250962065'], ['ТС КЗ М', '77532805'], ['ТС КЗ Ж', '404817593']
  ];
  function sheetFromName(name, gid) {
    var m = /^(\S+)\s+(ЛЗ|КЗ)\s+(М|Ж)/i.exec(String(name).trim()) || [];
    var team = /кз/i.test(m[2] || '');
    var key = String(name).replace(/ТС/g, 'TS').replace(/ЛЗ/g, 'LZ').replace(/КЗ/g, 'KZ').replace(/М/g, 'M').replace(/Ж/g, 'W').replace(/[^\w]/g, '');
    return {
      key: key, name: name, gid: String(gid || ''), mode: team ? 'team' : 'individual',
      cls: m[1] ? (/^\d+$/.test(m[1]) ? 'Класс ' + m[1] : m[1]) : '',
      comp: team ? 'Командный зачёт' : 'Личный зачёт',
      cat: /ж/i.test(m[3] || '') ? 'Юниорки' : 'Юниоры',
      on: !/^ТС/i.test(name)
    };
  }
  DEFAULT_CONFIG.sheets = SHEET_CATALOG.map(function (x) { return sheetFromName(x[0], x[1]); });
  var DEMO_KEYS = { '75LZM': 1, '75LZW': 1, '75KZM': 1, '75KZW': 1 };

  function sheetCsvUrl(cfg, sheet) {
    if (cfg.source === 'demo') return DEMO_KEYS[sheet.key] ? 'demo/' + sheet.key + '.csv' : null;
    return 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(cfg.sheetId) +
      '/export?format=csv&gid=' + encodeURIComponent(sheet.gid) + '&_=' + Date.now();
  }

  /* ------------------------------------------------------------------ */
  /* CSV                                                                 */
  /* ------------------------------------------------------------------ */
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i, c;
    text = String(text || '').replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* Утилиты                                                             */
  /* ------------------------------------------------------------------ */
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function low(s) { return norm(s).toLowerCase().replace(/ё/g, 'е'); }
  function isPlaceholder(v) { var t = low(v); return t === '' || t === 'х' || t === 'x' || t === '-' || t === '—'; }
  function isErr(v) { return /^#(REF|N\/A|DIV\/0|VALUE|NAME|NUM|ERROR)/i.test(norm(v)); }
  function clean(v) { v = norm(v); return isErr(v) ? '' : v; }
  function upperRu(s) { return String(s).toLocaleUpperCase('ru-RU'); }
  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toLocaleUpperCase('ru-RU') + s.slice(1) : s; }

  /* ------------------------------------------------------------------ */
  /* Имена: «Фамилия Имя Отчество» → «Имя ФАМИЛИЯ»                       */
  /* ------------------------------------------------------------------ */
  function isAllCaps(w) { return w.length > 1 && w === upperRu(w) && /[А-ЯЁA-Z]/.test(w); }

  function formatName(raw, known) {
    var s = norm(raw);
    if (!s || isPlaceholder(s)) return '';
    if (s.indexOf('|') >= 0) {
      return s.split('|').map(function (p) { return formatName(p, known); }).filter(Boolean).join(' | ');
    }
    var w = s.split(' ');
    if (w.length === 1) return upperRu(w[0]);
    // Уже в формате «Имя ФАМИЛИЯ»
    if (w.length === 2 && isAllCaps(w[1]) && !isAllCaps(w[0])) return w[0] + ' ' + w[1];
    if (w.length === 2 && known) {
      if (known[low(w[1])] && !known[low(w[0])]) return cap(w[0]) + ' ' + upperRu(w[1]); // «Имя Фамилия»
    }
    // По умолчанию: первое слово — фамилия (формат судейской таблицы)
    return cap(w[1]) + ' ' + upperRu(w[0]);
  }

  /* ------------------------------------------------------------------ */
  /* Роли колонок (для ширины / стиля)                                   */
  /* ------------------------------------------------------------------ */
  function colRole(label) {
    var l = low(label);
    if (l === '№') return 'idx';
    if (/^рейтинг/.test(l)) return 'rating';
    if (l === 'ранг') return 'rank';
    if (l === 'фио' || /^пилот/.test(l)) return 'pilot';
    if (l === 'округ') return 'okrug';
    if (l === 'регион') return 'region';
    if (l === 'место' || l === 'команда') return 'place';
    if (/^место/.test(l)) return 'place2';
    if (l === 'цвет') return 'color';
    if (l === 'канал') return 'channel';
    if (/^время/.test(l) || /лучший круг/.test(l)) return 'time';
    if (l === 'сумма') return 'total';
    if (/^(1|2|3|4|5|доп\.?|штраф)$/.test(l)) return 'score';
    if (/круг/.test(l)) return 'laps';
    if (l === 'группа') return 'group';
    return 'num';
  }

  /* ------------------------------------------------------------------ */
  /* Разбор листа                                                        */
  /* ------------------------------------------------------------------ */
  var STAGE_RE = [
    [/квалификац/i, 'Квалификация'],
    [/четвертьфинал/i, 'Четвертьфинал'],
    [/полуфинал/i, 'Полуфинал'],
    [/групповой\s*этап/i, 'Групповой этап'],
    [/финал/i, 'Финал']
  ];
  var GROUP_RE = /группа\s*(\d+)|(\d+)\s*группа/i;
  function groupOf(v) { var m = GROUP_RE.exec(norm(v)); return m ? (m[1] || m[2]) : null; }
  function isLabel(v) { v = norm(v); return !!v && (!!groupOf(v) || !!stageOf(v) || /^(команда|место)$/i.test(v)); }

  function stageOf(v) {
    var s = norm(v);
    for (var i = 0; i < STAGE_RE.length; i++) if (STAGE_RE[i][0].test(s)) return STAGE_RE[i][1];
    return null;
  }

  function parseSheet(grid, sheet) {
    var G = function (r, c) { return grid[r] && grid[r][c] != null ? norm(grid[r][c]) : ''; };
    var nRows = grid.length, nCols = 0, r, c;
    for (r = 0; r < nRows; r++) nCols = Math.max(nCols, grid[r].length);
    var team = sheet.mode === 'team';
    var out = { key: sheet.key, mode: sheet.mode, category: sheet.cat, cls: sheet.cls, comp: sheet.comp, title: '', quali: null, blocks: [], known: {} };

    // Категория / заголовок
    for (r = 0; r < Math.min(nRows, 14); r++) {
      for (c = 0; c < Math.min(nCols, 30); c++) {
        var v = G(r, c);
        if (/^юниор(ы|ки)$/i.test(v) && c === 0) out.category = cap(v.toLowerCase());
        if (/^класс\s/i.test(v) && !out.title) out.title = v;
      }
    }
    // «КЛАСС 330 ЛИЧНЫЙ ЗАЧЁТ» → класс, зачёт и режим берём из самого листа
    var tm = /класс\s+(\S+)/i.exec(out.title);
    if (tm) out.cls = 'Класс ' + tm[1];
    if (/командн/i.test(out.title)) { team = true; out.mode = 'team'; out.comp = 'Командный зачёт'; }
    else if (/личн/i.test(out.title)) { team = false; out.mode = 'individual'; out.comp = 'Личный зачёт'; }
    out.short = (tm ? tm[1] : (sheet.cls || '').replace(/^класс\s*/i, '')) + ' ' + (team ? 'КЗ' : 'ЛЗ') + ' ' + (/юниорк/i.test(out.category) ? 'Ж' : 'М');

    /* ---------- Квалификация (основная таблица слева) ---------- */
    var hr = -1;
    for (r = 0; r < Math.min(nRows, 40); r++) if (G(r, 0) === '№' && low(G(r, 2)) === 'фио') { hr = r; break; }
    if (hr >= 0) {
      var qcols = {}, lastQ = 0;
      for (c = 0; c < nCols; c++) {
        var h = low(G(hr, c));
        if (!h) { if (c > 3) break; else continue; }
        lastQ = c;
        if (h === '№') qcols.idx = c;
        else if (/^рейтинг/.test(h)) qcols.rating = c;
        else if (h === 'фио') qcols.fio = c;
        else if (h === 'регион') qcols.region = c;
        else if (h === 'округ') qcols.okrug = c;
        else if (/^круги/.test(h)) qcols.laps = c;
        else if (/^время/.test(h)) qcols.time = c;
        else if (/^место квал/.test(h)) qcols.placeQ = c;
        else if (/^место групп/.test(h)) qcols.placeG = c;
      }
      var items = [], cur = null, empty = 0;
      var rowEmpty = function (rr) { for (var k = 0; k <= lastQ; k++) if (G(rr, k)) return false; return true; };
      for (r = hr + 1; r < nRows; r++) {
        if (rowEmpty(r)) { if (++empty >= 2) break; continue; }
        empty = 0;
        var idx = G(r, qcols.idx), fio = G(r, qcols.fio);
        if (idx) {
          cur = {
            rowId: 'r' + r, idx: idx,
            rating: clean(G(r, qcols.rating)), region: clean(G(r, qcols.region)), okrug: clean(G(r, qcols.okrug)),
            laps: qcols.laps != null ? clean(G(r, qcols.laps)) : null,
            time: qcols.time != null ? clean(G(r, qcols.time)) : null,
            placeQ: qcols.placeQ != null ? clean(G(r, qcols.placeQ)) : null,
            placeG: qcols.placeG != null ? clean(G(r, qcols.placeG)) : null,
            pilotsRaw: []
          };
          items.push(cur);
          if (!isPlaceholder(fio)) cur.pilotsRaw.push(fio);
        } else if (cur && team && fio && !isPlaceholder(fio)) {
          cur.pilotsRaw.push(fio);
        }
      }
      items = items.filter(function (it) { return it.pilotsRaw.length > 0 && !/^\d{3,}$/.test(it.idx); });
      items.forEach(function (it) {
        it.pilotsRaw.forEach(function (p) { var w = norm(p).split(' '); if (w[0]) out.known[low(w[0])] = 1; });
        if (isPlaceholder(it.rating)) it.rating = '';
        if (isPlaceholder(it.okrug)) it.okrug = '';
      });
      out.quali = { has: qcols, items: items };
    }

    /* ---------- Блоки заездов (квалификация, полуфиналы, группы, финалы) ---------- */
    var findStage = function (r0, c0) {
      var stage = null, group = null;
      for (var rr = r0 - 1; rr >= 0; rr--) {
        var lv = G(rr, c0);
        if (!lv) continue;
        if (!group && groupOf(lv)) group = groupOf(lv);
        var st = stageOf(lv);
        if (st) { stage = st; break; }
      }
      return { stage: stage || 'Заезд', group: group };
    };
    var pilotOk = function (p) { return p && !isPlaceholder(p); };
    for (r = 0; r < nRows; r++) {
      for (c = 1; c < nCols; c++) {
        var a = low(G(r, c)), b = low(G(r, c + 1));
        var isPilotHdr = (b === 'ранг' || b === 'фио' || b === 'пилот' || b === 'пилоты');
        var grouped = a === 'группа' && b !== 'ранг' && isPilotHdr;
        if (!(((a === 'место' || a === 'команда') && isPilotHdr) || grouped)) continue;
        // колонки
        var cols = [], cc = c;
        while (cc < nCols && G(r, cc)) {
          var lab = G(r, cc);
          cols.push({ c: cc, key: 'c' + cc, label: lab, role: colRole(lab) });
          cc++;
        }
        var sg = findStage(r, c), rr;
        var stage = sg.stage, group = sg.group;
        var hasSum = cols.some(function (x) { return x.role === 'total'; });
        var pilotCol = cols.filter(function (x) { return x.role === 'pilot'; })[0];
        var placeCol = cols[0];
        var rankCol = cols.filter(function (x) { return x.role === 'rank'; })[0];
        var sumCol = cols.filter(function (x) { return x.role === 'total'; })[0];
        var blockEmpty = function (rr2) { for (var k = 0; k < cols.length; k++) if (G(rr2, cols[k].c)) return false; return true; };
        var cellsOf = function (rr2) { var o = {}; cols.forEach(function (x) { o[x.key] = clean(G(rr2, x.c)); }); return o; };

        if (grouped) {
          // «Группа | Пилот | Канал | Цвет | Лучший круг»: группы идут подряд, метка группы — в первой колонке
          var gcols = cols.slice(1), byGroup = {}, gOrder = [], curG = group || '1', emp0 = 0;
          for (rr = r + 1; rr < nRows && rr < r + 400; rr++) {
            var lv0 = G(rr, c);
            if (lv0 && stageOf(lv0) && !groupOf(lv0)) break;
            if (lv0 && groupOf(lv0)) curG = groupOf(lv0);
            if (blockEmpty(rr)) { if (++emp0 >= 6) break; continue; }
            emp0 = 0;
            if (!byGroup[curG]) { byGroup[curG] = []; gOrder.push(curG); }
            var cl = cellsOf(rr); delete cl[placeCol.key];
            byGroup[curG].push({ rowId: 'r' + rr, cells: cl, pilotsRaw: pilotCol && pilotOk(cl[pilotCol.key]) ? [cl[pilotCol.key]] : [] });
          }
          gOrder.forEach(function (gN) {
            out.blocks.push({ id: stage + '|' + gN + '|c' + c, stage: stage, group: gN, col: c, row: r, columns: gcols, rows: byGroup[gN], team: false });
          });
          c = cc; continue;
        }

        var rowsOut = [];
        var stopAt = function (rr2) { var v2 = G(rr2, c); return v2 && isLabel(v2) && !/^\d+$/.test(v2); };
        if (hasSum) {
          // личный зачёт: строка шаблона = есть «Сумма» (формула) или место / ранг
          for (rr = r + 1; rr < nRows; rr++) {
            if (stopAt(rr)) break;
            var ok = G(rr, sumCol.c) || G(rr, placeCol.c) || (rankCol && G(rr, rankCol.c));
            if (!ok) { if (rowsOut.length) break; if (rr - r > 2) break; continue; }
            var cells = cellsOf(rr);
            rowsOut.push({ rowId: 'r' + rr, cells: cells, pilotsRaw: pilotCol && pilotOk(cells[pilotCol.key]) ? [cells[pilotCol.key]] : [] });
          }
        } else {
          // командный: команда = 1–2 строки; строка с данными (канал, цвет, время…) начинает новую команду,
          // строка только с фамилией — второй пилот той же команды
          var curT = null, emp = 0;
          for (rr = r + 1; rr < nRows && rr < r + 80; rr++) {
            if (stopAt(rr)) break;
            if (blockEmpty(rr)) { if (++emp >= 8) break; continue; }
            emp = 0;
            var pv = pilotCol ? G(rr, pilotCol.c) : '';
            var others = cols.some(function (x) { return x !== pilotCol && G(rr, x.c); });
            if (others || !curT || curT.pilotsRaw.length >= 2) {
              curT = { rowId: 'r' + rr, cells: {}, pilotsRaw: [] };
              rowsOut.push(curT);
            }
            cols.forEach(function (x) {
              if (x === pilotCol) return;
              var vv = clean(G(rr, x.c));
              if (vv && !curT.cells[x.key]) curT.cells[x.key] = vv;
            });
            if (pilotOk(pv)) curT.pilotsRaw.push(pv);
          }
          rowsOut.forEach(function (t) { if (pilotCol) t.cells[pilotCol.key] = t.pilotsRaw.join(' | '); });
        }
        var id = stage + (group ? '|' + group : '') + '|c' + c;
        out.blocks.push({ id: id, stage: stage, group: group, col: c, row: r, columns: cols, rows: rowsOut, team: team });
        c = cc; // пропускаем колонки блока
      }
    }
    // имена пилотов из заездов тоже помогают распознать формат «Фамилия Имя»
    // Сортировка блоков: по этапу, затем по группе
    var order = { 'Квалификация': 0, 'Групповой этап': 1, 'Четвертьфинал': 2, 'Полуфинал': 3, 'Финал': 4, 'Заезд': 5 };
    out.blocks.sort(function (x, y) {
      return (order[x.stage] - order[y.stage]) || ((x.group ? +x.group : 0) - (y.group ? +y.group : 0)) || (x.col - y.col);
    });
    // для итогового списка «Групповой этап» без группы — понятное имя
    var perStage = {};
    out.blocks.forEach(function (bk) { perStage[bk.stage] = (perStage[bk.stage] || 0) + 1; });
    out.blocks.forEach(function (bk) {
      var showGroup = bk.group && !(bk.stage === 'Финал' && perStage[bk.stage] === 1);
      bk.label = upperRu(bk.stage) + (showGroup ? ' · ГРУППА ' + bk.group :(bk.stage === 'Групповой этап' && team && bk.columns.length <= 3 ? ' · ИТОГ' : ''));
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Цвета пилотов                                                       */
  /* ------------------------------------------------------------------ */
  var COLORS = {
    'красный': '#ff2d3d', 'red': '#ff2d3d',
    'оранжевый': '#ff8a1f', 'orange': '#ff8a1f',
    'желтый': '#ffd60a', 'yellow': '#ffd60a',
    'зеленый': '#22e35b', 'green': '#22e35b',
    'голубой': '#3cd4ff', 'cyan': '#3cd4ff', 'light blue': '#3cd4ff',
    'синий': '#2a5bff', 'blue': '#2a5bff',
    'пурпурный': '#ff2bd6', 'фуксия': '#ff2bd6', 'малиновый': '#e0115f', 'magenta': '#ff2bd6',
    'фиолетовый': '#8a4dff', 'purple': '#8a4dff', 'violet': '#8a4dff',
    'розовый': '#ff6fb5', 'pink': '#ff6fb5',
    'белый': '#ffffff', 'white': '#ffffff'
  };
  function colorOf(v) {
    var k = low(v);
    if (!k) return null;
    if (COLORS[k]) return COLORS[k];
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(k)) return k;
    for (var n in COLORS) if (n && k.indexOf(n) === 0) return COLORS[n];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Шина синхронизации: сервер (SSE) или BroadcastChannel               */
  /* ------------------------------------------------------------------ */
  function normFbUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    return u;
  }
  function normRoom(r) { return String(r || '').trim().replace(/[^\w-]/g, '').slice(0, 64); }
  function qsParam(name) {
    if (typeof location === 'undefined') return '';
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /**
   * opts: { fb: 'https://…firebasedatabase.app', room: 'ключ' } — облачный режим (Firebase Realtime DB, REST+SSE).
   * Без opts: параметры ?fb=…&room=… из адреса страницы; иначе локальный server.js; иначе BroadcastChannel.
   */
  function Bus(onState, onStatus, opts) {
    this.onState = onState || function () {};
    this.onStatus = onStatus || function () {};
    this.mode = null;
    this.lastRev = -1;
    var self = this;
    opts = opts || {};
    var forced = qsParam('bus') || null;
    var fb = normFbUrl(opts.fb || qsParam('fb')), room = normRoom(opts.room || qsParam('room'));
    if (forced !== 'bc' && forced !== 'server' && fb && room) { this._firebase(fb, room); return; }
    var httpOk = typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
    if (forced !== 'bc' && httpOk) {
      fetch('api/state', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('no server');
        return r.json();
      }).then(function (st) { self._server(st); })
        .catch(function () { self._bc(); });
    } else self._bc();
  }
  Bus.prototype._deliver = function (st) {
    if (!st || typeof st !== 'object') return;
    if (st.rev != null && st.rev === this.lastRev) return;
    this.lastRev = st.rev;
    this.onState(st);
  };
  Bus.prototype._server = function (initial) {
    var self = this;
    this.mode = 'server';
    if (initial && initial.rev != null) this._deliver(initial);
    var connect = function () {
      var es = new EventSource('api/events');
      es.onopen = function () { self.onStatus('server', true); };
      es.onmessage = function (e) { try { self._deliver(JSON.parse(e.data)); } catch (err) {} };
      es.onerror = function () { self.onStatus('server', false); };
      self.es = es;
    };
    connect();
  };
  Bus.prototype._firebase = function (fb, room) {
    var self = this;
    this.mode = 'firebase';
    this.fbRef = fb + '/cg/' + encodeURIComponent(room) + '/state.json';
    var es = null, retry = null;
    var connect = function () {
      try { if (es) es.close(); } catch (e) {}
      es = new EventSource(self.fbRef);
      self.es = es;
      var onData = function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (!msg) return;
          if (msg.path === '/') self._deliver(msg.data || { center: null, bottom: null });
          else self._refetch();
        } catch (er) {}
      };
      es.addEventListener('put', onData);
      es.addEventListener('patch', onData);
      es.addEventListener('keep-alive', function () { self.onStatus('firebase', true); });
      es.addEventListener('cancel', function () { self.onStatus('firebase', false, 'доступ запрещён правилами базы'); });
      es.onopen = function () { self.onStatus('firebase', true); };
      es.onerror = function () {
        self.onStatus('firebase', false);
        if (es.readyState === 2) { clearTimeout(retry); retry = setTimeout(connect, 2000); }
      };
    };
    connect();
  };
  Bus.prototype._refetch = function () {
    var self = this;
    fetch(this.fbRef, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (st) { self._deliver(st || { center: null, bottom: null }); }).catch(function () {});
  };
  Bus.prototype._bc = function () {
    var self = this;
    this.mode = 'local';
    try {
      this.bc = new BroadcastChannel('drone-cg-2026');
      this.bc.onmessage = function (e) { self._deliver(e.data); };
    } catch (e) {}
    // storage-событие как резерв (разные вкладки того же браузера)
    try {
      window.addEventListener('storage', function (e) {
        if (e.key === 'drone-cg-state' && e.newValue) { try { self._deliver(JSON.parse(e.newValue)); } catch (er) {} }
      });
      var saved = localStorage.getItem('drone-cg-state');
      if (saved) setTimeout(function () { self._deliver(JSON.parse(saved)); }, 0);
    } catch (e) {}
    this.onStatus('local', true);
  };
  Bus.prototype.send = function (st) {
    if (this.mode === 'firebase') {
      var self = this;
      return fetch(this.fbRef, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) })
        .then(function (r) { if (!r.ok) self.onStatus('firebase', false, 'запись запрещена (HTTP ' + r.status + ')'); return r.ok; })
        .catch(function () { self.onStatus('firebase', false); return false; });
    }
    if (this.mode === 'server') {
      return fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    }
    try { if (this.bc) this.bc.postMessage(st); } catch (e) {}
    try { localStorage.setItem('drone-cg-state', JSON.stringify(st)); } catch (e) {}
    return Promise.resolve(true);
  };

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG, SHEET_CATALOG: SHEET_CATALOG, sheetFromName: sheetFromName,
    sheetCsvUrl: sheetCsvUrl,
    parseCSV: parseCSV,
    parseSheet: parseSheet,
    formatName: formatName,
    colRole: colRole,
    colorOf: colorOf,
    normFbUrl: normFbUrl, normRoom: normRoom,
    norm: norm, low: low, upperRu: upperRu, cap: cap, isPlaceholder: isPlaceholder,
    Bus: Bus
  };
});

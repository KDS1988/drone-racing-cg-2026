/* =====================================================================
   Пульт управления графикой.
   - читает 4 листа Google Sheets (CSV-экспорт), разбирает их в таблицы
   - формирует данные титров, применяет ручные правки
   - отправляет состояние графике (сервер / BroadcastChannel)
   ===================================================================== */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var U = CG.upperRu;

  /* =================================================================== */
  /* Хранилище настроек пульта                                           */
  /* =================================================================== */
  var LS_KEY = 'drone-cg-panel-v1';
  var DEFAULT_STORE = {
    config: clone(CG.DEFAULT_CONFIG),
    start: { tag: 'Класс 75', line1: 'Первенство России по гонкам дронов', line2: 'Юниоры · Юниорки · Личный и командный зачёт' },
    geo: { city: 'Город', date: 'Дата проведения' },
    lowers: [
      { name: 'Имя ФАМИЛИЯ', role: 'Главный судья соревнований' },
      { name: 'Имя ФАМИЛИЯ', role: 'Представитель Федерации гонок дронов России' }
    ],
    tables: {},           // itemId → { title, subtitle, rpp, page, sort, hideEmpty, hiddenCols:{}, hiddenRows:{}, ovr:{rowId:{col:val}}, flip }
    selected: 'start'
  };
  var store;
  try { store = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { store = {}; }
  store = Object.assign(clone(DEFAULT_STORE), store);
  store.config = Object.assign(clone(CG.DEFAULT_CONFIG), store.config || {});
  // если в сохранённом конфиге нет листа из дефолта — добавим
  CG.DEFAULT_CONFIG.sheets.forEach(function (d) {
    if (!store.config.sheets.some(function (s) { return s.key === d.key; })) store.config.sheets.push(clone(d));
  });
  var saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} }, 250); }
  var cfg = store.config;

  /* =================================================================== */
  /* Данные листов                                                       */
  /* =================================================================== */
  var DATA = {};  // key → { parsed, at, err, hash, busy, last }
  cfg.sheets.forEach(function (s) { DATA[s.key] = { parsed: null, at: 0, err: null, hash: '', busy: false, last: 0 }; });
  function sheetByKey(k) { return cfg.sheets.filter(function (s) { return s.key === k; })[0]; }

  function hashStr(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      if (/^\s*<(!doctype|html)/i.test(t)) throw new Error('нет доступа к таблице (откройте доступ по ссылке)');
      return t;
    });
  }

  function loadSheet(s) {
    var d = DATA[s.key];
    if (d.busy) return Promise.resolve();
    d.busy = true; d.last = Date.now();
    var url = CG.sheetCsvUrl(cfg, s);
    var p = fetchText(url).catch(function (e) {
      if (cfg.source === 'google' && bus && bus.mode === 'server') {
        return fetchText('api/sheet?id=' + encodeURIComponent(cfg.sheetId) + '&gid=' + encodeURIComponent(s.gid));
      }
      throw e;
    });
    return p.then(function (txt) {
      d.err = null; d.at = Date.now();
      var hsh = hashStr(txt);
      if (hsh === d.hash) return;
      d.hash = hsh;
      d.parsed = CG.parseSheet(CG.parseCSV(txt), s);
      onDataChanged(s.key);
    }).catch(function (e) {
      d.err = e.message || String(e);
    }).then(function () { d.busy = false; renderStatus(); });
  }

  function hotSheets() {
    var hot = {};
    [state.center, state.bottom].forEach(function (it) { if (it && it.sheet) hot[it.sheet] = 1; });
    var sel = itemById(store.selected); if (sel && sel.sheet) hot[sel.sheet] = 1;
    return hot;
  }
  function pollTick() {
    var now = Date.now(), hot = hotSheets();
    cfg.sheets.forEach(function (s) {
      var d = DATA[s.key];
      var iv = (hot[s.key] ? cfg.pollActive : cfg.pollAll) * 1000;
      if (!d.busy && now - d.last >= iv) loadSheet(s);
    });
  }
  function reloadAll() { cfg.sheets.forEach(function (s) { DATA[s.key].hash = ''; loadSheet(s); }); }

  /* =================================================================== */
  /* Каталог титров                                                      */
  /* =================================================================== */
  function sheetSubtitle(s) {
    var p = DATA[s.key].parsed;
    var cat = (p && p.category) || s.cat;
    return [s.cls, s.comp, cat].filter(Boolean).join(' · ');
  }
  function catalog() {
    var items = [
      { id: 'start', type: 'start', layer: 'center', label: 'Стартовый титр', group: 'common' },
      { id: 'geo', type: 'geo', layer: 'bottom', label: 'Геотитр', group: 'common' }
    ];
    store.lowers.forEach(function (l, i) {
      items.push({ id: 'lower:' + i, type: 'lower', layer: 'bottom', label: 'Подпись: ' + (l.name || '—'), group: 'lowers', idx: i });
    });
    cfg.sheets.forEach(function (s) {
      var p = DATA[s.key].parsed;
      items.push({ id: 'q:' + s.key, type: 'table', layer: 'center', sheet: s.key, kind: 'quali', label: 'Квалификация', group: s.key,
        count: p && p.quali ? p.quali.items.length : null });
      if (p) p.blocks.forEach(function (b) {
        items.push({ id: 'b:' + s.key + ':' + b.id, type: 'table', layer: 'center', sheet: s.key, kind: 'block', blockId: b.id,
          label: CG.cap(b.label.toLowerCase()).replace(/группа/g, 'Группа').replace(/итог/, 'Итог'), group: s.key,
          count: b.rows.filter(function (r) { return r.pilotsRaw.length; }).length });
      });
    });
    return items;
  }
  var ITEMS = [];
  function itemById(id) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    // элемент блока может появиться позже (данные не загружены)
    var m = /^([qb]):(\w+)(?::(.*))?$/.exec(id || '');
    if (m) return { id: id, type: 'table', layer: 'center', sheet: m[2], kind: m[1] === 'q' ? 'quali' : 'block', blockId: m[3], label: id, group: m[2] };
    return null;
  }

  /* =================================================================== */
  /* Таблицы: построение данных для графики                              */
  /* =================================================================== */
  function tcfg(id) {
    if (!store.tables[id]) store.tables[id] = {};
    var t = store.tables[id];
    if (t.hiddenCols == null) t.hiddenCols = null; // null = по умолчанию
    t.hiddenRows = t.hiddenRows || {};
    t.ovr = t.ovr || {};
    if (t.hideEmpty == null) t.hideEmpty = true;
    if (t.page == null) t.page = 0;
    if (t.sort == null) t.sort = '';
    return t;
  }

  /** «сырой» вид таблицы: все колонки, все строки, значения из листа */
  function rawTable(item) {
    var s = sheetByKey(item.sheet), p = DATA[item.sheet] && DATA[item.sheet].parsed;
    if (!s || !p) return null;
    var known = p.known, team = s.mode === 'team';
    if (item.kind === 'quali') {
      var has = (p.quali && p.quali.has) || {};
      var cols = [{ key: 'idx', label: '№', role: 'idx' }];
      if (has.rating != null) cols.push({ key: 'rating', label: 'Рейтинг региона', role: 'rating' });
      cols.push({ key: 'pilot', label: team ? 'Пилоты' : 'Пилот', role: 'pilot' });
      if (has.okrug != null) cols.push({ key: 'okrug', label: 'Округ', role: 'okrug' });
      if (team && has.laps != null) cols.push({ key: 'laps', label: 'Круги квал.', role: 'laps' });
      if (has.time != null) cols.push({ key: 'time', label: 'Время квал.', role: 'time' });
      if (has.placeQ != null) cols.push({ key: 'placeQ', label: 'Место квал.', role: 'place2' });
      if (has.placeG != null) cols.push({ key: 'placeG', label: 'Место групп.', role: 'place2' });
      var rows = (p.quali ? p.quali.items : []).map(function (it) {
        return { id: it.rowId, cells: {
          idx: it.idx, rating: it.rating, pilot: it.pilotsRaw.map(function (x) { return CG.formatName(x, known); }).join(' | '),
          okrug: it.okrug, laps: it.laps, time: it.time, placeQ: it.placeQ, placeG: it.placeG } };
      });
      return { columns: cols, rows: rows, title: 'Квалификация', defaultHidden: {}, team: team };
    }
    var b = p.blocks.filter(function (x) { return x.id === item.blockId; })[0];
    if (!b) return null;
    var defHidden = {};
    var bcols = b.columns.map(function (c) {
      var label = CG.low(c.label) === 'фио' ? (team ? 'Пилоты' : 'Пилот') : c.label;
      if (c.role === 'channel' && !(team && b.stage === 'Финал')) defHidden[c.key] = 1;
      return { key: c.key, label: label, role: c.role };
    });
    var pilotKey = (bcols.filter(function (c) { return c.role === 'pilot'; })[0] || {}).key;
    var brows = b.rows.map(function (r) {
      var cells = Object.assign({}, r.cells);
      if (pilotKey) cells[pilotKey] = r.pilotsRaw.map(function (x) { return CG.formatName(x, known); }).join(' | ');
      return { id: r.rowId, cells: cells, hasPilot: r.pilotsRaw.length > 0 };
    });
    return { columns: bcols, rows: brows, title: b.label, defaultHidden: defHidden, team: team, block: b };
  }

  function sortVal(v) {
    v = String(v == null ? '' : v).trim().replace(',', '.');
    if (!v) return Infinity;
    var m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v);
    if (m) return (+m[1]) * 60 + (+m[2]);
    var n = parseFloat(v);
    return isNaN(n) ? v : n;
  }

  /** данные для графики (с правками, скрытием, сортировкой, страницами) */
  function tablePayload(item) {
    var raw = rawTable(item), t = tcfg(item.id), s = sheetByKey(item.sheet);
    if (!raw || !s) return null;
    var hiddenCols = t.hiddenCols || raw.defaultHidden;
    var cols = raw.columns.filter(function (c) { return !hiddenCols[c.key]; });
    var pilotKey = (raw.columns.filter(function (c) { return c.role === 'pilot'; })[0] || {}).key;
    var placeKeys = raw.columns.filter(function (c) { return CG.low(c.label) === 'место'; }).map(function (c) { return c.key; });
    var rows = raw.rows.map(function (r) {
      var cells = Object.assign({}, r.cells), o = t.ovr[r.id] || {};
      Object.keys(o).forEach(function (k) { cells[k] = o[k]; });
      return { id: r.id, cells: cells, hasPilot: r.hasPilot !== false || !!(o[pilotKey]) };
    }).filter(function (r) {
      if (t.hiddenRows[r.id]) return false;
      if (item.kind === 'block' && t.hideEmpty && !(r.cells[pilotKey] || '').trim()) return false;
      return true;
    });
    if (t.sort) {
      rows = rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
        var x = sortVal(a.r.cells[t.sort]), y = sortVal(b.r.cells[t.sort]);
        if (typeof x === 'number' && typeof y === 'number') return (x - y) || (a.i - b.i);
        return String(x).localeCompare(String(y), 'ru') || (a.i - b.i);
      }).map(function (o) { return o.r; });
    }
    if (item.kind === 'block' && placeKeys.length) {
      var pk = placeKeys[placeKeys.length - 1];
      rows.forEach(function (r) { var v = parseInt(r.cells[pk], 10); if (v >= 1 && v <= 3) r.hl = v; });
    }
    var rpp = Math.max(1, +t.rpp || (item.kind === 'quali' ? 16 : 24));
    var pages = Math.max(1, Math.ceil(rows.length / rpp));
    var page = Math.min(Math.max(0, t.page || 0), pages - 1);
    var pageRows = rows.slice(page * rpp, page * rpp + rpp).map(function (r) {
      var cells = {}; cols.forEach(function (c) { cells[c.key] = r.cells[c.key] == null ? '' : r.cells[c.key]; });
      return { id: r.id, cells: cells, hl: r.hl || 0 };
    });
    return {
      title: t.title != null && t.title !== '' ? t.title : (item.kind === 'quali' ? 'Квалификация' : CG.cap(raw.title.toLowerCase()).replace(/группа/g, 'группа')),
      subtitle: t.subtitle != null && t.subtitle !== '' ? t.subtitle : sheetSubtitle(s),
      team: raw.team, columns: cols, rows: pageRows, page: page, pages: pages
    };
  }

  function payloadFor(item) {
    if (!item) return null;
    if (item.type === 'start') return clone(store.start);
    if (item.type === 'geo') return clone(store.geo);
    if (item.type === 'lower') return clone(store.lowers[item.idx] || {});
    if (item.type === 'table') return tablePayload(item);
    return null;
  }

  /* =================================================================== */
  /* Состояние эфира                                                     */
  /* =================================================================== */
  var state = { center: null, bottom: null };
  var takeN = 1;
  var bus = null, sendTimer = null;

  function makeLayerItem(item) {
    var data = payloadFor(item);
    if (!data) return null;
    return { key: item.id, type: item.type, take: takeN++, data: data, sheet: item.sheet || null, label: itemLabel(item) };
  }
  function itemLabel(item) {
    if (!item) return '';
    if (item.type === 'table') { var s = sheetByKey(item.sheet); return (s ? s.name + ' · ' : '') + item.label; }
    return item.label;
  }
  function sendState() {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(function () {
      if (bus) bus.send({ rev: Date.now(), center: state.center, bottom: state.bottom });
    }, 30);
    renderOnAir();
  }
  function take(id) {
    var item = itemById(id);
    if (!item) return;
    var li = makeLayerItem(item);
    if (!li) { toast('Нет данных для «' + item.label + '»', true); return; }
    state[item.layer] = li;
    sendState(); renderList(); setupFlip();
  }
  function out(layer) { state[layer] = null; sendState(); renderList(); setupFlip(); }
  function isOnAir(id) { return (state.center && state.center.key === id) || (state.bottom && state.bottom.key === id); }
  function toggle(id) { var it = itemById(id); if (!it) return; if (isOnAir(id)) out(it.layer); else take(id); }

  /** пересчитать данные титров в эфире (после правки / обновления таблицы) */
  function refreshOnAir() {
    var changed = false;
    ['center', 'bottom'].forEach(function (L) {
      var cur = state[L]; if (!cur) return;
      var item = itemById(cur.key); if (!item) return;
      var d = payloadFor(item); if (!d) return;
      if (JSON.stringify(d) !== JSON.stringify(cur.data)) { cur.data = d; cur.label = itemLabel(item); changed = true; }
    });
    if (changed) sendState();
  }

  /* автолистание страниц таблицы в эфире */
  var flipTimer = null;
  function setupFlip() {
    clearInterval(flipTimer); flipTimer = null;
    var c = state.center; if (!c || c.type !== 'table') return;
    var t = tcfg(c.key), sec = +t.flip || 0;
    if (!sec || (c.data && c.data.pages < 2)) return;
    flipTimer = setInterval(function () {
      var cur = state.center; if (!cur || cur.type !== 'table') return;
      var tt = tcfg(cur.key); tt.page = ((cur.data.page || 0) + 1) % cur.data.pages; save();
      refreshOnAir(); updatePreview(); if (store.selected === cur.key) renderEditor();
    }, Math.max(3, sec) * 1000);
  }

  /* =================================================================== */
  /* Превью                                                              */
  /* =================================================================== */
  var pvwFrame = $('#pvwFrame'), pvwReady = false, pvwTake = 1000000;
  pvwFrame.addEventListener('load', function () { pvwReady = true; updatePreview(true); });
  function updatePreview(retake) {
    var item = itemById(store.selected);
    $('#pvwName').textContent = item ? itemLabel(item) : '—';
    if (!pvwReady || !pvwFrame.contentWindow || !pvwFrame.contentWindow.__cgApply) return;
    var st = { center: null, bottom: null };
    if (item) {
      var d = payloadFor(item);
      if (d) {
        if (retake) pvwTake++;
        st[item.layer] = { key: item.id, type: item.type, take: pvwTake, data: d };
      }
    }
    pvwFrame.contentWindow.__cgApply(st);
  }

  /* =================================================================== */
  /* Рендер: статус                                                      */
  /* =================================================================== */
  function renderStatus() {
    var errs = [], newest = 0, loaded = 0;
    cfg.sheets.forEach(function (s) {
      var d = DATA[s.key];
      if (d.err) errs.push(s.name + ': ' + d.err);
      if (d.parsed) loaded++;
      newest = Math.max(newest, d.at);
    });
    var p = $('#pData');
    if (errs.length) { p.className = 'pill bad'; p.textContent = 'ДАННЫЕ: ОШИБКА'; p.title = errs.join('\n'); }
    else if (loaded) {
      p.className = 'pill ok';
      p.textContent = 'ДАННЫЕ: ' + (cfg.source === 'demo' ? 'ДЕМО' : 'GOOGLE') + ' · ' + new Date(newest).toLocaleTimeString('ru-RU');
      p.title = 'Листов загружено: ' + loaded;
    } else { p.className = 'pill warn'; p.textContent = 'ДАННЫЕ: ЗАГРУЗКА…'; }
    $('#pDemo').hidden = cfg.source !== 'demo';
    $$('.grp h4 .st').forEach(function (el) {
      var d = DATA[el.dataset.k]; if (!d) return;
      el.textContent = d.err ? '⚠ ошибка' : (d.at ? new Date(d.at).toLocaleTimeString('ru-RU') : '…');
      el.title = d.err || '';
    });
  }
  function syncStatus(mode, ok) {
    var p = $('#pSync');
    if (mode === 'server') { p.className = 'pill ' + (ok ? 'ok' : 'bad'); p.textContent = ok ? 'СВЯЗЬ: СЕРВЕР' : 'СВЯЗЬ: НЕТ СЕРВЕРА'; p.title = 'Пульт и графика синхронизируются через server.js'; }
    else { p.className = 'pill warn'; p.textContent = 'СВЯЗЬ: ЛОКАЛЬНО'; p.title = 'Без сервера: графика обновляется только в этом же браузере. Для vMix запустите node server.js'; }
  }

  /* =================================================================== */
  /* Рендер: список титров                                               */
  /* =================================================================== */
  function renderList() {
    ITEMS = catalog();
    var html = '';
    var groups = [{ k: 'common', t: 'Общие' }, { k: 'lowers', t: 'Нижние подписи' }].concat(cfg.sheets.map(function (s) {
      return { k: s.key, t: s.name + ' · ' + (s.comp || '') + ' · ' + ((DATA[s.key].parsed && DATA[s.key].parsed.category) || s.cat), sheet: true };
    }));
    groups.forEach(function (g) {
      var its = ITEMS.filter(function (i) { return i.group === g.k; });
      html += '<div class="grp"><h4>' + esc(g.t) + (g.sheet ? '<span class="st" data-k="' + g.k + '">…</span>' : '') + '</h4>';
      if (g.k === 'lowers' && !its.length) html += '<div class="hint">Добавьте подписи в редакторе</div>';
      if (g.sheet && its.length === 1 && !DATA[g.k].parsed) html += '';
      its.forEach(function (it) {
        var air = isOnAir(it.id);
        html += '<div class="item' + (store.selected === it.id ? ' sel' : '') + (air ? ' air' : '') + '" data-id="' + esc(it.id) + '">' +
          '<span class="nm">' + esc(it.label) + '</span>' + (it.count != null ? '<span class="cnt">' + it.count + '</span>' : '') +
          '<button class="btn" data-toggle="' + esc(it.id) + '">' + (air ? 'OUT' : 'IN') + '</button></div>';
      });
      if (g.k === 'lowers') html += '<div class="item" data-id="lowers-edit"><span class="nm" style="color:var(--blue)">✎ Редактировать список подписей</span></div>';
      html += '</div>';
    });
    $('#list').innerHTML = html;
    renderStatus();
  }
  $('#list').addEventListener('click', function (e) {
    var tg = e.target.closest('[data-toggle]');
    if (tg) { e.stopPropagation(); toggle(tg.dataset.toggle); return; }
    var it = e.target.closest('.item'); if (!it) return;
    var id = it.dataset.id;
    if (id === 'lowers-edit') id = store.lowers.length ? 'lower:0' : 'lowers';
    select(id);
  });

  function select(id) {
    store.selected = id; save();
    renderList(); renderEditor(); updatePreview(true);
    var it = itemById(id);
    if (it && it.sheet) loadSheet(sheetByKey(it.sheet));
  }

  function renderOnAir() {
    $('#oaCenter').textContent = state.center ? state.center.label || state.center.key : '—';
    $('#oaBottom').textContent = state.bottom ? state.bottom.label || state.bottom.key : '—';
    $('#pgmName').textContent = [state.center && state.center.label, state.bottom && state.bottom.label].filter(Boolean).join('  +  ') || '—';
    var sel = itemById(store.selected);
    var b = $('#btnTake');
    if (sel && isOnAir(sel.id)) { b.textContent = '■ OUT — СНЯТЬ'; b.className = 'btn danger'; }
    else { b.textContent = 'IN ▶ В ЭФИР'; b.className = 'btn take'; }
    b.disabled = !sel || sel.id === 'lowers';
  }

  /* =================================================================== */
  /* Рендер: редактор                                                    */
  /* =================================================================== */
  function field(label, key, val, ph) {
    return '<label>' + esc(label) + '<input data-f="' + key + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '"></label>';
  }
  function onEdited() { save(); refreshOnAir(); updatePreview(false); }

  function renderEditor() {
    var ed = $('#editor'), item = itemById(store.selected);
    if (store.selected === 'lowers' || (item && item.type === 'lower')) return renderLowers(ed, item);
    if (!item) { ed.innerHTML = '<div class="hint">Выберите титр слева.</div>'; renderOnAir(); return; }
    if (item.type === 'start') {
      ed.innerHTML = '<h3>Стартовый титр <small>заглушка 1440×810 по центру</small></h3><div class="fields">' +
        field('Плашка (красная)', 'tag', store.start.tag, 'Класс 75') +
        field('Строка 1 — дисциплина', 'line1', store.start.line1) +
        field('Строка 2', 'line2', store.start.line2) + '</div>' +
        '<div class="hint">Пустая плашка скрывается. Текст редактируется «на лету», в том числе в эфире.</div>';
      bindFields(ed, store.start);
    } else if (item.type === 'geo') {
      ed.innerHTML = '<h3>Геотитр <small>650×100, внизу слева</small></h3><div class="fields">' +
        field('Город', 'city', store.geo.city) + field('Дата', 'date', store.geo.date) + '</div>';
      bindFields(ed, store.geo);
    } else if (item.type === 'table') renderTableEditor(ed, item);
    renderOnAir();
  }
  function bindFields(ed, obj) {
    $$('input[data-f]', ed).forEach(function (inp) {
      inp.addEventListener('input', function () { obj[inp.dataset.f] = inp.value; onEdited(); if (obj === store.lowers[+inp.dataset.i]) renderListSoon(); });
    });
  }
  var listSoon = null;
  function renderListSoon() { clearTimeout(listSoon); listSoon = setTimeout(renderList, 400); }

  function renderLowers(ed, item) {
    var html = '<h3>Нижние подписи <small>1400×120 · «Имя ФАМИЛИЯ» — фамилия заглавными выделяется жирным</small></h3><div class="lt-list">';
    store.lowers.forEach(function (l, i) {
      var id = 'lower:' + i, air = isOnAir(id);
      html += '<div class="lt' + (air ? ' air' : '') + (store.selected === id ? ' sel' : '') + '" data-i="' + i + '">' +
        '<input data-i="' + i + '" data-k="name" value="' + esc(l.name) + '" placeholder="Имя ФАМИЛИЯ">' +
        '<input data-i="' + i + '" data-k="role" value="' + esc(l.role) + '" placeholder="Должность">' +
        '<button class="btn sm" data-pv="' + i + '">Превью</button>' +
        '<button class="btn sm ' + (air ? 'danger' : 'take') + '" data-tk="' + i + '">' + (air ? 'OUT' : 'IN') + '</button>' +
        '<button class="btn sm" data-del="' + i + '" title="Удалить">✕</button></div>';
    });
    html += '</div><div class="row"><button class="btn" id="ltAdd">+ Добавить подпись</button>' +
      '<span class="hint">Порядок можно менять: ↑ в начале строки — Alt+↑/↓ в поле имени.</span></div>';
    ed.innerHTML = html;
    $$('.lt input', ed).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = +inp.dataset.i; store.lowers[i][inp.dataset.k] = inp.value;
        if (store.selected !== 'lower:' + i) { store.selected = 'lower:' + i; }
        onEdited(); renderListSoon();
      });
      inp.addEventListener('keydown', function (e) {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        var i = +inp.dataset.i, j = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (j < 0 || j >= store.lowers.length) return;
        var t = store.lowers[i]; store.lowers[i] = store.lowers[j]; store.lowers[j] = t;
        remapLowerAir(i, j); save(); renderList(); renderEditor();
        var el = $('.lt input[data-i="' + j + '"][data-k="' + inp.dataset.k + '"]'); if (el) el.focus();
      });
      inp.addEventListener('focus', function () { var id = 'lower:' + inp.dataset.i; if (store.selected !== id) { store.selected = id; save(); updatePreview(true); renderList(); $$('.lt', ed).forEach(function (r) { r.classList.toggle('sel', r.dataset.i === inp.dataset.i); }); renderOnAir(); } });
    });
    $$('[data-pv]', ed).forEach(function (b) { b.onclick = function () { store.selected = 'lower:' + b.dataset.pv; save(); renderList(); renderEditor(); updatePreview(true); }; });
    $$('[data-tk]', ed).forEach(function (b) { b.onclick = function () { toggle('lower:' + b.dataset.tk); renderEditor(); }; });
    $$('[data-del]', ed).forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.del;
        if (isOnAir('lower:' + i)) out('bottom');
        store.lowers.splice(i, 1);
        if (state.bottom && /^lower:/.test(state.bottom.key)) { var k = +state.bottom.key.split(':')[1]; if (k > i) state.bottom.key = 'lower:' + (k - 1); }
        store.selected = store.lowers.length ? 'lower:0' : 'lowers'; save(); renderList(); renderEditor(); updatePreview(true);
      };
    });
    $('#ltAdd', ed).onclick = function () {
      store.lowers.push({ name: '', role: '' }); store.selected = 'lower:' + (store.lowers.length - 1); save(); renderList(); renderEditor(); updatePreview(true);
      var el = $('.lt:last-child input', ed); if (el) el.focus();
    };
    renderOnAir();
  }
  function remapLowerAir(i, j) {
    if (!state.bottom || !/^lower:/.test(state.bottom.key)) return;
    var k = +state.bottom.key.split(':')[1];
    if (k === i) state.bottom.key = 'lower:' + j; else if (k === j) state.bottom.key = 'lower:' + i;
  }

  function renderTableEditor(ed, item) {
    var s = sheetByKey(item.sheet), d = DATA[item.sheet], t = tcfg(item.id);
    var raw = rawTable(item);
    var head = '<h3>' + esc(s ? s.name : '') + ' · ' + esc(item.label) + ' <small>' +
      (d.err ? '⚠ ' + esc(d.err) : d.at ? 'обновлено ' + new Date(d.at).toLocaleTimeString('ru-RU') : 'загрузка…') + '</small></h3>';
    if (!raw) { ed.innerHTML = head + '<div class="hint">Данные листа ещё не загружены или блок не найден в таблице.</div>'; return; }
    var pl = tablePayload(item);
    var hiddenCols = t.hiddenCols || raw.defaultHidden;
    var html = head + '<div class="fields">' +
      '<label>Заголовок<input data-t="title" value="' + esc(t.title || '') + '" placeholder="' + esc(pl.title) + '"></label>' +
      '<label>Подзаголовок<input data-t="subtitle" value="' + esc(t.subtitle || '') + '" placeholder="' + esc(pl.subtitle) + '"></label></div>';
    html += '<div class="opts">' +
      '<div class="grpbox"><span class="lbl">Строк на стр.</span><input type="number" min="1" max="40" data-t="rpp" value="' + esc(t.rpp || (item.kind === 'quali' ? 16 : 24)) + '"></div>' +
      '<div class="grpbox"><span class="lbl">Страница</span><button class="btn sm" data-pg="-1">◀</button><b>' + (pl.page + 1) + ' / ' + pl.pages + '</b><button class="btn sm" data-pg="1">▶</button></div>' +
      '<div class="grpbox"><span class="lbl">Автолистание, сек</span><input type="number" min="0" max="120" data-t="flip" value="' + esc(t.flip || 0) + '"></div>' +
      '<div class="grpbox"><span class="lbl">Сортировка</span><select data-t="sort"><option value="">как в таблице</option>' +
      raw.columns.filter(function (c) { return c.role !== 'pilot' && c.role !== 'color'; }).map(function (c) {
        return '<option value="' + c.key + '"' + (t.sort === c.key ? ' selected' : '') + '>по «' + esc(c.label) + '»</option>';
      }).join('') + '</select></div>' +
      (item.kind === 'block' ? '<label class="chk"><input type="checkbox" data-t="hideEmpty"' + (t.hideEmpty ? ' checked' : '') + '>скрывать строки без пилота</label>' : '') +
      '</div>';
    html += '<div class="opts"><span class="lbl">Колонки в эфире:</span>' + raw.columns.map(function (c) {
      var on = !hiddenCols[c.key];
      return '<label class="chk' + (on ? '' : ' off') + '"><input type="checkbox" data-col="' + c.key + '"' + (on ? ' checked' : '') + '>' + esc(c.label) + '</label>';
    }).join('') + '<button class="btn sm" id="colsReset">по умолчанию</button></div>';

    html += '<div class="wrapdata"><table class="data"><thead><tr><th title="Показывать строку">👁</th>' +
      raw.columns.map(function (c) { return '<th class="' + (hiddenCols[c.key] ? 'hidcol' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
    raw.rows.forEach(function (r) {
      var o = t.ovr[r.id] || {}, hid = !!t.hiddenRows[r.id];
      html += '<tr class="' + (hid ? 'hid' : '') + '" data-r="' + r.id + '"><td class="vis"><input type="checkbox" data-vis="' + r.id + '"' + (hid ? '' : ' checked') + '></td>';
      raw.columns.forEach(function (c) {
        var sv = r.cells[c.key] == null ? '' : String(r.cells[c.key]);
        var has = Object.prototype.hasOwnProperty.call(o, c.key);
        var v = has ? o[c.key] : sv;
        html += '<td class="w-' + c.role + (hiddenCols[c.key] ? ' hidcol' : '') + '"><input data-r="' + r.id + '" data-c="' + c.key + '" value="' + esc(v) + '"' +
          (has ? ' class="ovr" title="В таблице: ' + esc(sv || '(пусто)') + ' · двойной клик — вернуть"' : ' title="Из таблицы"') + '></td>';
      });
      html += '</tr>';
    });
    if (!raw.rows.length) html += '<tr><td colspan="' + (raw.columns.length + 1) + '" class="hint" style="padding:12px">Строк нет — данные появятся, как только судьи заполнят таблицу.</td></tr>';
    html += '</tbody></table></div>';
    html += '<div class="row"><span class="hint">Правки подсвечены жёлтым и имеют приоритет над таблицей. Двойной клик по ячейке — вернуть значение из таблицы.</span>' +
      '<button class="btn sm danger" id="ovrReset">Сбросить все правки</button></div>';
    ed.innerHTML = html;

    // события
    $$('[data-t]', ed).forEach(function (inp) {
      var ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
      inp.addEventListener(ev, function () {
        var k = inp.dataset.t;
        if (inp.type === 'checkbox') t[k] = inp.checked;
        else if (inp.type === 'number') t[k] = inp.value === '' ? null : +inp.value;
        else t[k] = inp.value;
        if (k === 'rpp' || k === 'sort') t.page = 0;
        onEdited();
        if (k === 'flip') setupFlip();
        if (k !== 'title' && k !== 'subtitle') renderEditorKeepFocus(inp);
      });
    });
    $$('[data-pg]', ed).forEach(function (b) {
      b.onclick = function () {
        var p2 = tablePayload(item);
        t.page = (p2.page + (+b.dataset.pg) + p2.pages) % p2.pages; onEdited(); renderEditor();
      };
    });
    $$('[data-col]', ed).forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (!t.hiddenCols) t.hiddenCols = Object.assign({}, raw.defaultHidden);
        if (inp.checked) delete t.hiddenCols[inp.dataset.col]; else t.hiddenCols[inp.dataset.col] = 1;
        onEdited(); renderEditor();
      });
    });
    $('#colsReset', ed).onclick = function () { t.hiddenCols = null; onEdited(); renderEditor(); };
    $$('[data-vis]', ed).forEach(function (inp) {
      inp.addEventListener('change', function () {
        if (inp.checked) delete t.hiddenRows[inp.dataset.vis]; else t.hiddenRows[inp.dataset.vis] = 1;
        inp.closest('tr').classList.toggle('hid', !inp.checked); onEdited();
      });
    });
    $$('input[data-c]', ed).forEach(function (inp) {
      inp.addEventListener('input', function () { setOvr(item, raw, inp); onEdited(); });
      inp.addEventListener('dblclick', function () {
        var o = t.ovr[inp.dataset.r];
        if (o && Object.prototype.hasOwnProperty.call(o, inp.dataset.c)) {
          delete o[inp.dataset.c]; if (!Object.keys(o).length) delete t.ovr[inp.dataset.r];
          onEdited(); renderEditor();
        }
      });
    });
    $('#ovrReset', ed).onclick = function () { t.ovr = {}; onEdited(); renderEditor(); };
  }
  function setOvr(item, raw, inp) {
    var t = tcfg(item.id), r = inp.dataset.r, c = inp.dataset.c;
    var row = raw.rows.filter(function (x) { return x.id === r; })[0];
    var sv = row && row.cells[c] != null ? String(row.cells[c]) : '';
    t.ovr[r] = t.ovr[r] || {};
    if (inp.value === sv) { delete t.ovr[r][c]; inp.classList.remove('ovr'); }
    else { t.ovr[r][c] = inp.value; inp.classList.add('ovr'); }
    if (!Object.keys(t.ovr[r]).length) delete t.ovr[r];
  }
  function renderEditorKeepFocus(inp) {
    var sel = inp && inp.dataset && inp.dataset.t;
    renderEditor();
    if (sel) { var el = $('[data-t="' + sel + '"]', $('#editor')); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') { var n = el.value.length; el.setSelectionRange(n, n); } } }
  }

  /** обновились данные листа: обновить список/редактор аккуратно (не сбивая ввод) */
  function onDataChanged(key) {
    renderList();
    var item = itemById(store.selected);
    if (item && item.sheet === key) {
      var ae = document.activeElement, ed = $('#editor');
      if (ae && ed.contains(ae) && ae.tagName === 'INPUT') refreshEditorValues(item);
      else renderEditor();
    }
    refreshOnAir(); updatePreview(false);
  }
  function refreshEditorValues(item) {
    var raw = rawTable(item), t = tcfg(item.id); if (!raw) return;
    $$('input[data-c]', $('#editor')).forEach(function (inp) {
      if (inp === document.activeElement) return;
      var row = raw.rows.filter(function (x) { return x.id === inp.dataset.r; })[0]; if (!row) return;
      var o = t.ovr[row.id] || {};
      if (!Object.prototype.hasOwnProperty.call(o, inp.dataset.c)) inp.value = row.cells[inp.dataset.c] == null ? '' : row.cells[inp.dataset.c];
    });
  }

  /* =================================================================== */
  /* Верхняя панель, настройки                                           */
  /* =================================================================== */
  $('#btnTake').onclick = function () { var it = itemById(store.selected); if (it) toggle(it.id); };
  $$('[data-out]').forEach(function (b) { b.onclick = function () { out(b.dataset.out); }; });
  $('#btnClear').onclick = function () { state.center = null; state.bottom = null; sendState(); renderList(); setupFlip(); };
  $('#btnReload').onclick = reloadAll;
  $('#srcSel').value = cfg.source;
  $('#srcSel').onchange = function () {
    cfg.source = this.value; save();
    cfg.sheets.forEach(function (s) { DATA[s.key] = { parsed: null, at: 0, err: null, hash: '', busy: false, last: 0 }; });
    renderList(); renderEditor(); reloadAll();
  };

  var modal = $('#settings');
  $('#btnSettings').onclick = function () {
    $('#sSheetId').value = cfg.sheetId;
    $('#sPollA').value = cfg.pollActive; $('#sPollB').value = cfg.pollAll;
    $('#sGids').innerHTML = cfg.sheets.map(function (s, i) {
      return '<label>gid листа «' + esc(s.name) + '»<input data-gid="' + i + '" value="' + esc(s.gid) + '"></label>';
    }).join('');
    modal.hidden = false;
  };
  $('#sCancel').onclick = function () { modal.hidden = true; };
  $('#sSave').onclick = function () {
    var m = /\/d\/([\w-]+)/.exec($('#sSheetId').value); // можно вставить всю ссылку
    cfg.sheetId = m ? m[1] : $('#sSheetId').value.trim();
    cfg.pollActive = Math.max(1, +$('#sPollA').value || 3);
    cfg.pollAll = Math.max(5, +$('#sPollB').value || 30);
    $$('[data-gid]').forEach(function (inp) { cfg.sheets[+inp.dataset.gid].gid = inp.value.replace(/\D/g, ''); });
    save(); modal.hidden = true; reloadAll();
  };
  $('#sExport').onclick = function () {
    var blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'drone-cg-settings.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };
  $('#sImport').onchange = function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (txt) {
      var o = JSON.parse(txt);
      localStorage.setItem(LS_KEY, JSON.stringify(o)); location.reload();
    }).catch(function (e) { toast('Не удалось прочитать файл: ' + e.message, true); });
  };
  $('#sReset').onclick = function () {
    if (!confirm('Сбросить все настройки пульта (тексты, правки, подписи)?')) return;
    localStorage.removeItem(LS_KEY); location.reload();
  };

  function toast(msg, err) {
    var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 3500);
  }

  /* =================================================================== */
  /* Старт                                                               */
  /* =================================================================== */
  // Состояние эфира берём с сервера (если пульт перезагрузили во время эфира)
  bus = new CG.Bus(function (st) {
    if (!st) return;
    // принимаем только при первом подключении (пульт — источник истины)
    if (!bus._gotInitial) {
      bus._gotInitial = true;
      state.center = st.center || null; state.bottom = st.bottom || null;
      renderList(); renderOnAir(); setupFlip();
    }
  }, syncStatus);

  renderList(); renderEditor(); renderOnAir();
  reloadAll();
  setInterval(pollTick, 1000);
  setInterval(renderStatus, 5000);
  window.__cg = { store: store, DATA: DATA, state: state, tablePayload: tablePayload, itemById: itemById, take: take, out: out, select: select };
})();

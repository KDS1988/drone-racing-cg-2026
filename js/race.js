/* Live race API adapter for the main Drone Racing CG package.
   Input schema: sf.fgdrrace.ru/api, schemaVersion 1. Times are milliseconds. */
(function (root) {
  'use strict';
  var CG = root.CG;
  var STAGES = ['Симулятор', 'Баскетбол', 'Класс 75 мм'];
  var STATUS = { ready: 'ОЖИДАНИЕ СТАРТА', running: 'ГОНКА ИДЁТ', paused: 'ПАУЗА', finished: 'ГОНКА ЗАВЕРШЕНА' };

  function fmt(ms) {
    if (ms == null || ms === '' || !isFinite(+ms)) return '';
    ms = Math.max(0, Math.round(+ms));
    var whole = Math.floor(ms / 1000), milli = ms % 1000;
    var sec = whole % 60, min = Math.floor(whole / 60);
    var tail = String(milli).padStart(3, '0');
    return min ? min + ':' + String(sec).padStart(2, '0') + '.' + tail : sec + '.' + tail;
  }
  function statusText(data) { return STATUS[data && data.status] || String(data && data.status || 'НЕТ ДАННЫХ').toUpperCase(); }
  function subtitle(data) {
    if (!data) return 'Ожидание подключения к API';
    var t = data.elapsedMs == null ? '' : ' · ' + fmt(data.elapsedMs);
    return statusText(data) + t;
  }
  function stageText(stage, finished) {
    if (finished || stage === -1) return 'ФИНИШ';
    return STAGES[stage] || '—';
  }
  function byPlayer(data) {
    var out = {};
    (data && data.players || []).forEach(function (p) { out[p.id] = p; });
    return out;
  }
  function ranked(data) {
    var players = data && data.players || [], map = byPlayer(data), out = [];
    (data && data.ranking || []).forEach(function (id) { if (map[id] && out.indexOf(map[id]) < 0) out.push(map[id]); });
    players.forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    return out;
  }
  function count(p, i, target) {
    var n = p && p.counts && p.counts[i];
    if (n == null) return '';
    return target == null ? String(n) : String(n) + ' / ' + String(target);
  }
  function common(data, title) { return { title: title, subtitle: subtitle(data), defaultHidden: {}, team: false }; }

  function catalog(data) {
    var n = data && data.players ? data.players.length : null;
    return [
      { id: 'race:leaderboard', type: 'table', layer: 'center', kind: 'race', group: 'race', label: 'Текущий рейтинг', count: n },
      { id: 'race:splits', type: 'table', layer: 'center', kind: 'race', group: 'race', label: 'Время по этапам', count: n },
      { id: 'race:events', type: 'table', layer: 'center', kind: 'race', group: 'race', label: 'Последние отметки', count: data && data.events ? Math.min(12, data.events.length) : null }
    ];
  }

  function table(data, id) {
    var players = ranked(data), targets = data && data.targets || [10, 5, 3];
    if (id === 'race:leaderboard') {
      var cols = [
        { key: 'place', label: 'Место', role: 'place' },
        { key: 'color', label: 'Цвет', role: 'color' },
        { key: 'pilot', label: 'Пилот', role: 'pilot' },
        { key: 'stage', label: 'Этап', role: 'region' },
        { key: 'sim', label: 'Сим.', role: 'num' },
        { key: 'basket', label: 'Баскетбол', role: 'num' },
        { key: 'race75', label: '75 мм', role: 'num' },
        { key: 'best', label: 'Лучший круг', role: 'time' },
        { key: 'finish', label: 'Финиш', role: 'time' }
      ];
      return Object.assign(common(data, 'Текущий рейтинг'), {
        columns: cols,
        rows: players.map(function (p, i) {
          return { id: 'player-' + p.id, hl: i < 3 ? i + 1 : 0, cells: {
            place: String(i + 1), color: p.color || '', pilot: p.name || '—',
            stage: stageText(p.stage, p.finished), sim: count(p, 0, targets[0]),
            basket: count(p, 1, targets[1]), race75: count(p, 2, targets[2]),
            best: fmt(p.bestLapMs), finish: fmt(p.finishMs)
          } };
        })
      });
    }
    if (id === 'race:splits') {
      return Object.assign(common(data, 'Время по этапам'), {
        columns: [
          { key: 'place', label: 'Место', role: 'place' },
          { key: 'pilot', label: 'Пилот', role: 'pilot' },
          { key: 'sim', label: 'Симулятор', role: 'time' },
          { key: 'basket', label: 'Баскетбол', role: 'time' },
          { key: 'race75', label: 'Класс 75 мм', role: 'time' },
          { key: 'finish', label: 'Финиш', role: 'time' }
        ],
        rows: players.map(function (p, i) {
          var d = p.durationsMs || [];
          return { id: 'split-' + p.id, hl: i < 3 ? i + 1 : 0, cells: {
            place: String(i + 1), pilot: p.name || '—', sim: fmt(d[0]), basket: fmt(d[1]), race75: fmt(d[2]), finish: fmt(p.finishMs)
          } };
        })
      });
    }
    if (id === 'race:events') {
      var map = byPlayer(data), events = data && data.events || [];
      events = events.slice(-12).reverse();
      return Object.assign(common(data, 'Последние отметки'), {
        columns: [
          { key: 'time', label: 'Время', role: 'time' },
          { key: 'pilot', label: 'Пилот', role: 'pilot' },
          { key: 'event', label: 'Отметка', role: 'region' }
        ],
        rows: events.map(function (e, i) {
          var p = map[e.player] || {};
          return { id: 'event-' + (e.id || i), cells: {
            time: fmt(e.time), pilot: p.name || '—', event: STAGES[e.stage] || 'Событие'
          } };
        })
      });
    }
    return null;
  }

  CG.RACE = { catalog: catalog, table: table, fmt: fmt, statusText: statusText };
})(window);

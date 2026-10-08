/*!
 * Вход в пульт: пароль + «запомнить меня на этом ПК».
 * Это защита от случайных посетителей, а не банковская безопасность: сайт статический,
 * поэтому в коде хранится только хэш пароля (SHA-256 с «солью»), сам пароль — нигде.
 *
 * Сменить пароль: откройте login.html?hash=1, введите новый пароль — страница покажет хэш;
 * вставьте его в PASS_HASHES ниже (можно несколько паролей — по одному на человека).
 */
(function (root) {
  'use strict';
  var SALT = 'drone-cg-2026:';
  var PASS_HASHES = [
    '0b53c5f4483a76262ffbe11fd81c5764318370f1e33cb50ae09b6790ebcf9f68'  // основной пароль (Дмитрий)
  ];
  var KEY = 'drone-cg-auth';

  /* ---- SHA-256 (чистый JS, работает и по http в локальной сети) ---- */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mp = Math.pow, maxWord = mp(2, 32), result = '', words = [], i, j;
    var s = unescape(encodeURIComponent(ascii)), bitLen = s.length * 8;
    var hash = [], k = [], primeCounter = 0, isComposite = {};
    for (var cand = 2; primeCounter < 64; cand++) {
      if (!isComposite[cand]) {
        for (i = 0; i < 313; i += cand) isComposite[i] = cand;
        hash[primeCounter] = (mp(cand, .5) * maxWord) | 0;
        k[primeCounter++] = (mp(cand, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    s += '\x80';
    while (s.length % 64 - 56) s += '\x00';
    for (i = 0; i < s.length; i++) {
      j = s.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }

  function hashOf(pass) { return sha256(SALT + String(pass)); }
  function stored() {
    try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function ok() { var t = stored(); return !!t && PASS_HASHES.indexOf(t) >= 0; }

  root.CGAuth = {
    hashOf: hashOf,
    isLoggedIn: ok,
    /** вызвать в <head> защищённой страницы */
    guard: function () {
      if (ok()) return true;
      var here = location.pathname.split('/').pop() || 'control.html';
      location.replace('login.html?next=' + encodeURIComponent(here + location.search));
      return false;
    },
    login: function (pass, remember) {
      var h = hashOf(pass);
      if (PASS_HASHES.indexOf(h) < 0) return false;
      try {
        localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
        (remember ? localStorage : sessionStorage).setItem(KEY, h);
      } catch (e) {}
      return true;
    },
    logout: function () {
      try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
      location.replace('login.html');
    }
  };
})(typeof self !== 'undefined' ? self : this);

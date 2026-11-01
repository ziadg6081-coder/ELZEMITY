/* Tiny i18n engine shared by the storefront and the admin panel.
   - Loaded as a normal (blocking) script in <head> so <html lang/dir> is correct before the first paint.
   - Strings live in js/strings-store.js and js/strings-admin.js and are registered with I18N.add({ key: { en, ar } }).
   - The chosen language is remembered in localStorage and shared by the storefront and the admin. */
(function () {
  "use strict";
  var KEY = "oriantal-lang";
  var SUPPORTED = ["en", "ar"];
  var dict = {};
  var listeners = [];

  function detect() {
    try { var saved = localStorage.getItem(KEY); if (SUPPORTED.indexOf(saved) !== -1) return saved; } catch (e) { /* storage blocked */ }
    var nav = (navigator.language || "en").toLowerCase();
    return nav.indexOf("ar") === 0 ? "ar" : "en";
  }
  var lang = detect();

  function applyDocument() {
    var h = document.documentElement;
    h.lang = lang; h.dir = lang === "ar" ? "rtl" : "ltr";
    h.classList.toggle("is-ar", lang === "ar");
  }
  applyDocument();
  // Static HTML is written in English, so Arabic visitors would see a flash of English before app.js translates it.
  // Hide the body until then (a timer makes sure the page can never stay hidden if a script fails).
  if (lang === "ar") { document.documentElement.classList.add("i18n-pending"); setTimeout(function () { document.documentElement.classList.remove("i18n-pending"); }, 1500); }

  function fmt(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] === undefined ? m : vars[k]; });
  }

  var I18N = {
    get lang() { return lang; },
    get locale() { return lang === "ar" ? "ar-EG" : "en-EG"; },
    get isRtl() { return lang === "ar"; },
    add: function (entries) { for (var k in entries) dict[k] = entries[k]; },
    has: function (key) { return Object.prototype.hasOwnProperty.call(dict, key); },
    /** t("key", {name: "x"}) -> translated string; falls back to English, then to the key itself. */
    t: function (key, vars) {
      var e = dict[key];
      if (!e) return key;
      return fmt(e[lang] !== undefined ? e[lang] : (e.en !== undefined ? e.en : key), vars);
    },
    /** tp("count", 3) -> uses key_1 for exactly one, key_n otherwise ({n} is filled in). */
    tp: function (key, n, vars) {
      var k = n === 1 && dict[key + "_1"] ? key + "_1" : key + "_n";
      return I18N.t(k, Object.assign({ n: new Intl.NumberFormat(I18N.locale).format(n) }, vars || {}));
    },
    /** Translate a value coming from the database / API when we have a label for it, otherwise show it as-is. */
    label: function (prefix, value) { var k = prefix + "." + value; return I18N.has(k) ? I18N.t(k) : String(value == null ? "" : value).replace(/_/g, " "); },
    num: function (n, opts) { return new Intl.NumberFormat(I18N.locale, opts || { maximumFractionDigits: 2 }).format(n); },
    date: function (s) { return s ? new Date(s).toLocaleDateString(I18N.locale) : "—"; },
    dateTime: function (s) { return s ? new Date(s).toLocaleString(I18N.locale) : "—"; },
    /** Translate everything marked in the HTML:
     *  data-i18n="key" (text), data-i18n-html="key" (trusted markup from our own strings),
     *  data-i18n-attr="placeholder:key;aria-label:key2" (attributes). */
    apply: function (root) {
      root = root || document;
      root.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = I18N.t(el.getAttribute("data-i18n")); });
      root.querySelectorAll("[data-i18n-html]").forEach(function (el) { el.innerHTML = I18N.t(el.getAttribute("data-i18n-html")); });
      root.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
        el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
          var i = pair.indexOf(":"); if (i < 1) return;
          el.setAttribute(pair.slice(0, i).trim(), I18N.t(pair.slice(i + 1).trim()));
        });
      });
      document.documentElement.classList.remove("i18n-pending");
    },
    set: function (next) {
      if (SUPPORTED.indexOf(next) === -1 || next === lang) return;
      lang = next;
      try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
      applyDocument(); I18N.apply();
      listeners.forEach(function (fn) { try { fn(lang); } catch (e) { console.error(e); } });
    },
    toggle: function () { I18N.set(lang === "ar" ? "en" : "ar"); },
    onChange: function (fn) { listeners.push(fn); },
  };
  window.I18N = I18N;
})();

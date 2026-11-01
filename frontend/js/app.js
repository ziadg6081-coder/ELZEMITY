/* Elzemity storefront - connected to the Express/MySQL backend.
   The browser NEVER decides prices, stock, shipping or discounts: it only displays what the API returns.
   Socket.IO is a notification channel; after any event (and after every reconnect) data is re-fetched from the REST API.

   Pages: the site is a small hash-router (#/ , #/shop, #/men, #/women, #/unisex, #/about, #/care).
   Each page is a <div class="page" data-page="..."> in index.html; navigating swaps pages instead of scrolling.
   Languages: English / Arabic (RTL) through js/i18n.js + js/strings-store.js. */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const { t, tp, label } = I18N;
const money = (n) => t("money", { amount: I18N.num(n) });
const FALLBACK_IMG = "https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=800&q=80";
const CART_KEY = "oriantal-perfumes-cart"; // stores only {id, qty}; prices always come from the server
const ORDERS_KEY = "oriantal-perfumes-orders"; // sessionStorage: tracking codes of orders placed in this tab
const DEFAULT_CATEGORIES = ["Men", "Women", "Unisex"];

const state = {
  page: "home", slug: "home", category: "All", query: "", sort: "featured", searchNav: false,
  all: [], loaded: false, loadError: false, // every active product (the category pages filter this list in the browser)
  cart: loadCart(), wishlist: new Set(), config: { storeName: "ELZEMITY", categories: [], shippingZones: [] }, configLoaded: false,
  user: null, csrf: null, quote: null, quoteSeq: 0, idem: null, submitting: false, couponApplied: "", currentOrder: null,
};
let toastTimer, productsAbort, refetchTimer, socket;
let activeSuggestion = -1;

/* ------------------------------ API ------------------------------ */
class ApiError extends Error { constructor(status, body) { super(body?.error?.message || t("err.default")); this.status = status; this.code = body?.error?.code; this.details = body?.error?.details; } }
// Server messages are English. In Arabic we show our own translation for every known error code (falling back to the server text).
const errText = (e) => (I18N.lang === "ar" && I18N.has("err." + e.code) ? t("err." + e.code) : e.message);
const authErr = (e) => (I18N.lang === "ar" ? errText(e) : e.details?.[0]?.message || e.message);
async function api(path, { method = "GET", body, headers = {}, signal, form } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (state.csrf && method !== "GET") h["X-CSRF-Token"] = state.csrf;
  let payload;
  if (form) payload = form; else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(`/api${path}`, { method, headers: h, body: payload, signal, credentials: "same-origin" }); }
  catch (e) { if (e.name === "AbortError") throw e; throw new ApiError(0, { error: { code: "NETWORK", message: t("err.NETWORK") } }); }
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/* ------------------------------ cart (ids + qty only) ------------------------------ */
function loadCart() {
  try { const s = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(s) ? s.filter((i) => Number.isInteger(i.id) && Number.isInteger(i.qty) && i.qty > 0).map((i) => ({ id: i.id, ...(Number.isInteger(i.variantId) ? { variantId: i.variantId } : {}), qty: Math.min(i.qty, 10) })) : []; } catch { return []; }
}
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch { /* ignore */ } };
const productById = (id) => state.all.find((p) => p.id === id);
const selectedVariant = (p, variantId) => (p?.variants || []).find(v => v.id === variantId) || (p?.variants || [])[0] || null;
const cartLines = () => state.cart.map((i) => { const p = productById(i.id); const variant = selectedVariant(p, i.variantId); return { item: i, p: p ? { ...p, selectedVariant: variant, price: variant?.price ?? p.price, size: variant?.size ?? p.size, compareAtPrice: variant?.compareAtPrice ?? p.compareAtPrice } : null }; }).filter((l) => l.p);
const cartCount = () => cartLines().reduce((s, l) => s + l.item.qty, 0);
const cartSubtotalDisplay = () => cartLines().reduce((s, l) => s + l.p.price * l.item.qty, 0); // display only; the server recomputes everything

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ------------------------------ routing (separate pages) ------------------------------ */
const slugOf = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const categorySlugs = () => { const m = new Map(); for (const c of [...DEFAULT_CATEGORIES, ...state.config.categories]) m.set(slugOf(c), c); return m; };
function resolveRoute() {
  const seg = decodeURIComponent(location.hash.replace(/^#\/?/, "").split(/[?#]/)[0]).toLowerCase();
  if (!seg || seg === "home") return { page: "home", category: "All", slug: "home" };
  if (seg === "shop") return { page: "shop", category: "All", slug: "shop" };
  if (seg === "about" || seg === "contact" || seg === "care") return { page: seg, category: "All", slug: seg };
  const cat = categorySlugs().get(seg);
  if (cat) return { page: "shop", category: cat, slug: seg };
  return { page: "home", category: "All", slug: "home", unknown: true };
}
function showRoute(initial = false) {
  const r = resolveRoute();
  if (r.unknown && state.configLoaded) history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  const changed = r.slug !== state.slug || initial;
  state.slug = r.slug; state.page = r.page; state.category = r.category;
  if (!state.searchNav && changed) { state.query = ""; $("#searchInput").value = ""; } // a search only follows you when it started the navigation
  state.searchNav = false;
  for (const p of $$(".page")) {
    const on = p.dataset.page === r.page; p.hidden = !on;
    if (on && changed && !initial) { p.classList.remove("enter"); void p.offsetWidth; p.classList.add("enter"); }
  }
  for (const a of $$("#mainNav a[data-route]")) { if (a.dataset.route === r.slug) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
  closeMobileMenu(); renderChrome();
  if (r.page === "shop") renderProducts();
  if (r.page === "contact") renderContact();
  if (changed && !initial) { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); $("#main").focus({ preventScroll: true }); }
}
function renderChrome() {
  const c = state.category;
  const titles = { home: t("title.home"), shop: c === "All" ? t("title.shop") : t("title.cat", { name: label("cat", c) }), about: t("title.about"), contact: I18N.lang === "ar" ? "تواصل معنا" : "Contact", care: t("title.care") };
  document.title = titles[state.page];
  const meta = $('meta[name="description"]'); if (meta) meta.content = t("meta.desc");
  // shop heading
  const k = (p) => `shop.${p}.${c}`;
  $("#shopEyebrow").textContent = c === "All" ? t("shop.eyebrow.All") : I18N.has(k("eyebrow")) ? t(k("eyebrow")) : t("shop.eyebrow.other", { name: label("cat", c) });
  $("#shopTitle").innerHTML = c === "All" ? t("shop.title.All") : I18N.has(k("title")) ? t(k("title")) : t("shop.title.other", { name: esc(label("cat", c)) });
  $("#copyright").textContent = t("footer.rights", { year: new Date().getFullYear() });
  // language button shows the OTHER language
  const lb = $("#langToggle"), toAr = I18N.lang === "en";
  lb.textContent = toAr ? "العربية" : "English"; lb.lang = toAr ? "ar" : "en"; lb.setAttribute("aria-label", toAr ? "التبديل إلى العربية" : "Switch to English");
  updateAccountLabel();
}

function renderContact() {
  const root = $("#contactContent"); if (!root) return; const c = state.config.contact || {}; const socials = Array.isArray(c.socialAccounts) ? c.socialAccounts : [];
  const SOC = ["facebook", "instagram", "tiktok", "youtube", "telegram", "snapchat", "x", "whatsapp", "pinterest", "threads", "linkedin"], SOC_ALIAS = { twitter: "x", "twitter/x": "x", "x.com": "x", wa: "whatsapp", insta: "instagram", yt: "youtube", tg: "telegram", snap: "snapchat" };
  const socKey = (v) => { const k = String(v || "").trim().toLowerCase(); return SOC.includes(SOC_ALIAS[k] || k) ? (SOC_ALIAS[k] || k) : ""; };
  const links = socials.map(a => `<a class="social-contact-link" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(a.platform)}"><span class="social-icon${socKey(a.platform) ? " social-" + socKey(a.platform) : ""}" aria-hidden="true">${socKey(a.platform) ? "" : "↗"}</span><span>${esc(a.platform)}</span></a>`).join("");
  const whatsapp = c.whatsappEnabled !== false && c.whatsapp ? `<a class="button button-dark contact-whatsapp" href="https://wa.me/${esc(String(c.whatsapp).replace(/[^0-9]/g, "").replace(/^0020/, "20").replace(/^0(?=1[0125])/, "20"))}" target="_blank" rel="noopener noreferrer"><span class="social-icon social-whatsapp" aria-hidden="true"></span> ${I18N.lang === "ar" ? "تواصل معنا على واتساب" : "Chat with us on WhatsApp"}</a>` : "";
  root.innerHTML = `${whatsapp}<div class="social-contact-grid">${links}</div>${!whatsapp && !links ? `<p>${I18N.lang === "ar" ? "سيتم إضافة وسائل التواصل قريبًا." : "Contact details will be available soon."}</p>` : ""}`;
}

/* ------------------------------ products ------------------------------ */
async function loadProducts({ silent = false } = {}) {
  if (productsAbort) productsAbort.abort(); // never let two list requests overlap
  productsAbort = new AbortController(); const { signal } = productsAbort;
  if (!silent && !state.loaded) { state.loadError = false; renderProducts(); renderFeatured(); }
  try {
    let page = 1, items = [], total = 0;
    do { const d = await api(`/products?sort=featured&limit=60&page=${page}`, { signal }); items = items.concat(d.items); total = d.total; page++; } while (items.length < total && page <= 20);
    state.all = items; state.loaded = true; state.loadError = false;
    // drop cart lines whose product disappeared or sold out, and clamp quantities to current stock
    state.cart = state.cart.filter((i) => productById(i.id)?.inStock).map((i) => { const p = productById(i.id); const variant = selectedVariant(p, i.variantId); return { ...i, ...(variant?.id ? { variantId: variant.id } : {}), qty: Math.min(i.qty, p.maxQty || 1) }; });
  } catch (e) {
    if (e.name === "AbortError") return;
    if (!state.loaded) state.loadError = true; // a failed background refresh keeps showing what we already have
  }
  renderProducts(); renderFeatured(); renderCart(); renderSuggestions();
}
const scheduleRefetch = () => { clearTimeout(refetchTimer); refetchTimer = setTimeout(() => loadProducts({ silent: true }), 400); };

/* Live suggestions are local to the loaded public catalog. No API calls per keystroke. */
const searchText = (p) => [p.name, p.brand, p.category, label("cat", p.category), p.family, p.notes].join(" ").toLocaleLowerCase();
function highlightMatch(value, query) {
  const text = String(value || ""); const i = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return i < 0 || !query ? esc(text) : `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + query.length))}</mark>${esc(text.slice(i + query.length))}`;
}
function closeSuggestions() {
  const list = $("#searchSuggestions"), input = $("#searchInput");
  list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); activeSuggestion = -1;
}
function searchMatches() {
  const q = state.query.trim().toLocaleLowerCase(); if (!q) return [];
  return state.all.filter(p => searchText(p).includes(q)).sort((a,b) => {
    const rank = p => p.name.toLocaleLowerCase().startsWith(q) ? 0 : p.brand.toLocaleLowerCase().startsWith(q) ? 1 : p.name.toLocaleLowerCase().includes(q) ? 2 : 3;
    return rank(a) - rank(b);
  }).slice(0, 8);
}
function renderSuggestions() {
  const box = $("#searchSuggestions"), input = $("#searchInput"), q = state.query.trim();
  if (!q || $("#searchPanel").hidden || !state.loaded) return closeSuggestions();
  const list = searchMatches(); activeSuggestion = -1; input.removeAttribute("aria-activedescendant");
  box.innerHTML = list.length ? list.map((p,i) => `<button type="button" role="option" id="search-option-${i}" aria-selected="false" class="search-result" data-suggest="${p.id}">
    <img src="${esc(p.image || FALLBACK_IMG)}" alt="" loading="lazy"><span><strong>${highlightMatch(p.name,q)}</strong><small>${highlightMatch(p.brand,q)} · ${highlightMatch(p.family || label("cat",p.category),q)}</small></span><b>${money(p.price)}</b></button>`).join("") : `<p class="search-none" role="status">${esc(t("search.none"))}</p>`;
  box.hidden = false; input.setAttribute("aria-expanded", "true");
}
function selectSuggestion(index) {
  const opts = $$('[data-suggest]', $("#searchSuggestions"));
  if (!opts.length) return;
  activeSuggestion = (index + opts.length) % opts.length;
  opts.forEach((o,i) => { o.setAttribute("aria-selected", String(i === activeSuggestion)); o.classList.toggle("selected",i === activeSuggestion); });
  $("#searchInput").setAttribute("aria-activedescendant", opts[activeSuggestion].id);
  opts[activeSuggestion].scrollIntoView({block:"nearest"});
}
function visibleProducts() {
  let list = state.all;
  if (state.category !== "All") list = list.filter((p) => p.category === state.category);
  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter((p) => searchText(p).includes(q));
  list = [...list];
  if (state.sort === "low") list.sort((a, b) => a.price - b.price);
  else if (state.sort === "high") list.sort((a, b) => b.price - a.price);
  else if (state.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, I18N.locale));
  return list; // "featured" keeps the order the owner set in the admin (the API already returns it)
}
function productCard(p) {
  const wished = state.wishlist.has(p.id);
  const variants = p.variants || [];
  const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))];
  const old = p.compareAtPrice > p.price ? p.compareAtPrice : null;
  const discount = old ? Math.round(100 * (old - p.price) / old) : 0;
  return `
    <article class="product-card ${p.inStock ? "" : "soldout"}">
      <div class="product-image-wrap" data-view="${p.id}" tabindex="0" role="button" aria-label="${esc(t("p.view", { name: p.name }))}">
        <img class="product-image" src="${esc(p.image || FALLBACK_IMG)}" alt="${esc(t("p.alt", { name: p.name }))}" loading="lazy">
        ${p.tag ? `<span class="product-tag">${esc(p.tag)}</span>` : ""}
        ${discount > 0 ? `<span class="product-discount">${esc(t("p.discount", { n: discount }))}</span>` : ""}
        <button class="wishlist-button ${wished ? "active" : ""}" data-wish="${p.id}" aria-label="${esc(t(wished ? "p.unwish" : "p.wish", { name: p.name }))}" aria-pressed="${wished}">${wished ? "♥" : "♡"}</button>
        <button class="quick-add" data-add="${p.id}" ${p.inStock ? "" : "disabled"}>${p.inStock ? esc(t("p.add", { price: money(p.price) })) : esc(t("p.soldout"))}</button>
      </div>
      <div class="product-info"><p class="product-brand">${esc(p.brand)}</p><h3 class="product-name">${esc(p.name)}</h3>
        <p class="product-meta">${esc(label("cat", p.category))} · ${esc(p.family)}${sizes.length ? ` · ${esc(sizes.join(" / "))}` : p.size ? ` · ${esc(p.size)}` : ""}</p>
        <p class="product-availability ${p.inStock ? "" : "is-out"}">${esc(t(p.inStock ? "p.available" : "p.soldout"))}</p>
        ${p.lowStock ? `<p class="stock-note">${esc(t("p.low"))}</p>` : ""}
        <div class="price-row"><span class="product-price">${money(p.price)}</span>${old ? `<span class="old-price">${money(old)}</span>` : ""}</div></div>
    </article>`;
}
const skeletons = (n) => Array(n).fill('<div class="skeleton"></div>').join("");
function renderProducts() {
  const grid = $("#productGrid");
  $("#loadError").hidden = !state.loadError;
  if (state.loadError) { grid.hidden = true; $("#emptyState").hidden = true; $("#resultCount").textContent = t("shop.unable"); return; }
  if (!state.loaded) { grid.hidden = false; grid.setAttribute("aria-busy", "true"); grid.innerHTML = skeletons(4); $("#emptyState").hidden = true; $("#resultCount").textContent = t("shop.loading"); return; }
  const list = visibleProducts();
  grid.setAttribute("aria-busy", "false");
  $("#resultCount").textContent = tp("shop.count", list.length);
  const searching = !!state.query.trim();
  $("#emptyTitle").textContent = t(searching ? "shop.empty.search.title" : "shop.empty.coll.title");
  $("#emptyText").textContent = t(searching ? "shop.empty.search.text" : "shop.empty.coll.text");
  $("#resetFilters").hidden = !searching && state.category === "All";
  $("#emptyState").hidden = list.length > 0; grid.hidden = list.length === 0;
  grid.innerHTML = list.map(productCard).join("");
}
function renderFeatured() {
  const grid = $("#featuredGrid"); if (!grid) return;
  if (state.loadError) { grid.innerHTML = ""; return; }
  grid.innerHTML = state.loaded ? state.all.slice(0, 4).map(productCard).join("") : skeletons(4);
}

/* ------------------------------ cart UI ------------------------------ */
function renderCart() {
  const lines = cartLines();
  $("#cartCount").textContent = I18N.num(cartCount(), {}); $("#drawerCount").textContent = `(${I18N.num(cartCount(), {})})`;
  $("#cartItems").innerHTML = lines.map(({ item, p }) => `<div class="cart-line"><img src="${esc(p.image || FALLBACK_IMG)}" alt=""><div><h3>${esc(p.name)}</h3><p>${esc(p.brand)}</p>
    ${(p.variants || []).length > 1 ? `<label class="cart-variant-label">${esc(t("cart.variant"))} <select data-cart-variant="${p.id}" data-old-variant="${item.variantId || ""}">${p.variants.map(v => `<option value="${v.id}" ${v.id === item.variantId ? "selected" : ""}>${esc(v.size)} · ${money(v.price)}</option>`).join("")}</select></label>` : `<p>${esc(p.size)}</p>`}
    <strong>${money(p.price * item.qty)}</strong><div class="quantity-control"><button data-qty="${p.id}" data-variant="${item.variantId || ""}" data-delta="-1" aria-label="${esc(t("cart.dec", { name: p.name }))}">−</button><span>${I18N.num(item.qty, {})}</span><button data-qty="${p.id}" data-variant="${item.variantId || ""}" data-delta="1" aria-label="${esc(t("cart.inc", { name: p.name }))}" ${cartCountFor(p.id) >= p.maxQty ? "disabled" : ""}>+</button></div></div><button class="remove-item" data-remove="${p.id}" data-variant="${item.variantId || ""}" aria-label="${esc(t("cart.removeAria", { name: p.name }))}">${esc(t("cart.remove"))}</button></div>`).join("");
  const empty = lines.length === 0;
  $("#cartEmpty").hidden = !empty; $("#cartFooter").hidden = empty;
  $("#cartSubtotal").textContent = money(cartSubtotalDisplay()); saveCart();
  if ($("#checkoutDialog").open) { if (empty) setMsg(t("co.emptyCart"), true); refreshQuote(); }
}
const cartCountFor = id => state.cart.filter(i => i.id === id).reduce((sum, i) => sum + i.qty, 0);
function addToCart(id, variantId, requestedQty = 1) {
  const p = productById(id); if (!p) return;
  if (!p.inStock) { toast(t("toast.soldout")); return false; }
  const qty = Math.max(1, Math.min(50, Math.floor(Number(requestedQty) || 1)));
  const variant = selectedVariant(p, variantId), selectedId = variant?.id;
  const available = p.maxQty - cartCountFor(id);
  if (available < qty) { toast(t("toast.maxQty", { n: I18N.num(Math.max(available,0), {}), name: p.name })); return false; }
  const ex = state.cart.find(i => i.id === id && (i.variantId || null) === (selectedId || null));
  if (ex) ex.qty += qty; else state.cart.push({ id, ...(selectedId ? { variantId: selectedId } : {}), qty });
  renderCart(); toast(t("toast.added", { name: p.name })); return true;
}
function changeCartVariant(id, oldId, nextId) {
  const item = state.cart.find(i => i.id === id && String(i.variantId || "") === String(oldId || ""));
  const p = productById(id);
  if (!item || !p?.variants?.some(v => v.id === nextId)) return;
  const existing = state.cart.find(i => i !== item && i.id === id && i.variantId === nextId);
  if (existing) { existing.qty += item.qty; state.cart = state.cart.filter(i => i !== item); }
  else item.variantId = nextId;
  renderCart();
}
function openCart() {
  $("#overlay").hidden = false; requestAnimationFrame(() => $("#overlay").classList.add("visible"));
  $("#cartDrawer").hidden = false; requestAnimationFrame(() => $("#cartDrawer").classList.add("open"));
  document.body.classList.add("no-scroll"); $("#closeCart").focus();
}
function closeCart() {
  $("#cartDrawer").classList.remove("open"); $("#overlay").classList.remove("visible");
  setTimeout(() => { $("#cartDrawer").hidden = true; $("#overlay").hidden = true; }, 280);
  document.body.classList.remove("no-scroll"); $("#cartToggle").focus();
}
// Display-only: each size has its own optional original price; orders use the API price.
function dialogPriceHtml(price, compareAtPrice) {
  const old = compareAtPrice != null && Number.isFinite(Number(compareAtPrice)) && Number(compareAtPrice) > Number(price) ? Number(compareAtPrice) : null;
  return `<span class="dialog-current-price">${esc(money(price))}</span>${old === null ? "" : `<del class="dialog-old-price">${esc(money(old))}</del>`}`;
}
function openProduct(id) {
  const p = productById(id); if (!p) return;
  const variants = p.variants || []; const v = variants[0] || null;
  const variantOptions = variants.length ? `<label class="variant-label" for="dialogVariant">${I18N.lang === "ar" ? "الحجم" : "Size"}</label><select id="dialogVariant" data-variant-product="${p.id}">${variants.map(x => `<option value="${x.id}" data-price="${x.price}" data-old-price="${x.compareAtPrice ?? ""}" data-size="${esc(x.size)}">${esc(x.size)} — ${money(x.price)}</option>`).join("")}</select>` : "";
  $("#productDialogContent").innerHTML = `<div class="dialog-product-layout"><img class="dialog-product-image" src="${esc(p.image || FALLBACK_IMG)}" alt="${esc(t("p.alt", { name: p.name }))}"><div class="dialog-product-copy"><p class="eyebrow">${esc(label("cat", p.category).toUpperCase())}</p><p class="product-brand">${esc(p.brand)}</p><h2 id="dialogTitle">${esc(p.name)}</h2><p>${esc(p.description)}</p><p class="product-meta">${esc(p.family)}</p>${p.notes ? `<p class="product-meta"><strong>${esc(t("p.notes"))}:</strong> ${esc(p.notes)}</p>` : ""}${variantOptions}<label class="variant-label" for="dialogQuantity">${esc(t("p.qty"))}</label><input id="dialogQuantity" type="number" min="1" max="${p.maxQty}" value="1" inputmode="numeric"><div class="dialog-price-row" id="dialogVariantPrice" aria-live="polite">${dialogPriceHtml(v?.price ?? p.price, v ? v.compareAtPrice : p.compareAtPrice)}</div><p>${esc(state.config.paymentPolicy?.fullAdvanceEnabled ? t("policy.full") : t("co.policyText"))}</p><button class="button button-dark" data-dialog-add="${p.id}" ${p.inStock ? "" : "disabled"}>${p.inStock ? t("p.addBtn") : esc(t("p.soldout"))}</button></div></div>`;
  $("#productDialog").showModal();
}

/* ------------------------------ checkout ------------------------------ */
const orderPayload = () => {
  const f = $("#checkoutForm"); const v = (n) => f.elements[n].value.trim();
  return { name: v("name"), phone: v("phone"), ...(v("email") ? { email: v("email") } : {}), governorate: v("governorate"), city: v("city"), address: v("address"), ...(state.config.checkoutNotesEnabled && v("note") ? { note: v("note") } : {}), ...(state.couponApplied ? { couponCode: state.couponApplied } : {}), paymentMode: f.elements.paymentMode.value, items: state.cart.map((i) => ({ productId: i.id, ...(i.variantId ? { variantId: i.variantId } : {}), quantity: i.qty })) };
};
async function refreshQuote() {
  const seq = ++state.quoteSeq; state.quote = null; const gov = $("#governorate").value;
  const box = $("#checkoutSummary");
  if (!state.cart.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<p>${esc(t("loading"))}</p>`;
  try {
    const { quote } = await api("/quote", { method: "POST", body: { items: state.cart.map((i) => ({ productId: i.id, ...(i.variantId ? { variantId: i.variantId } : {}), quantity: i.qty })), ...(gov ? { governorate: gov } : {}), ...(state.couponApplied ? { couponCode: state.couponApplied } : {}) } });
    if (seq !== state.quoteSeq) return; state.quote = quote; renderSummary();
  } catch (e) {
    if (seq !== state.quoteSeq) return;
    state.quote = null;
    if (e.code === "INVALID_COUPON") { state.couponApplied = ""; setMsg(errText(e), true); return refreshQuote(); }
    box.innerHTML = `<p class="error-text">${esc(errText(e))}</p>`;
  }
}
function renderSummary() {
  const q = state.quote; if (!q) return;
  const items = q.items || cartLines().map(({item,p}) => ({productId:p.id, variantId:item.variantId, name:p.name, brand:p.brand, size:p.size, image:p.image, quantity:item.qty, unitPrice:p.price, lineTotal:item.qty*p.price}));
  $("#removeCoupon").hidden = !state.couponApplied;
  $("#checkoutSummary").innerHTML = `
    <h3 class="order-summary-heading">${esc(t("co.summaryTitle"))}</h3>
    <div class="checkout-lines">${items.map(i => `<div class="checkout-line">
      <img src="${esc(i.image || FALLBACK_IMG)}" alt="" loading="lazy">
      <div><strong>${esc(i.name)}</strong><small>${esc(i.brand)}</small>${(productById(i.productId)?.variants || []).length > 1 ? `<label class="checkout-size-label">${esc(t("cart.variant"))}<select data-cart-variant="${i.productId}" data-old-variant="${i.variantId || ""}">${productById(i.productId).variants.map(v => `<option value="${v.id}" ${v.id === i.variantId ? "selected" : ""}>${esc(v.size)} · ${money(v.price)}</option>`).join("")}</select></label>` : `<small>${esc(i.size)}</small>`}<small>${esc(t("co.unitPrice"))}: ${money(i.unitPrice)}</small>
      <div class="checkout-line-actions"><button type="button" data-qty="${i.productId}" data-variant="${i.variantId || ""}" data-delta="-1" aria-label="${esc(t("cart.dec",{name:i.name}))}">−</button><span>${I18N.num(i.quantity,{})}</span><button type="button" data-qty="${i.productId}" data-variant="${i.variantId || ""}" data-delta="1" aria-label="${esc(t("cart.inc",{name:i.name}))}" ${cartCountFor(i.productId) >= (productById(i.productId)?.maxQty || 50) ? "disabled" : ""}>+</button><button type="button" data-remove="${i.productId}" data-variant="${i.variantId || ""}">${esc(t("cart.remove"))}</button></div></div>
      <b>${money(i.lineTotal)}</b></div>`).join("")}</div>
    <div class="row"><span>${esc(t("sum.subtotal"))}</span><span>${money(q.subtotal)}</span></div>
    ${q.discount ? `<div class="row"><span>${esc(t("sum.discount", { code: state.couponApplied }))}</span><span>− ${money(q.discount)}</span></div>` : ""}
    ${q.additionalDiscount ? `<div class="row"><span>${esc(t("co.additionalDiscount"))}</span><span>− ${money(q.additionalDiscount)}</span></div>` : ""}
    <div class="row"><span>${esc(t("sum.shipping"))}</span><span>${q.shippingFee === null ? esc(t("sum.selectGov")) : money(q.shippingFee)}</span></div>
    <div class="row"><span>${esc(t("sum.productsTotal"))}</span><span>${money(q.productsTotal)}</span></div>
    <div class="row total"><span>${esc(t("sum.total"))}</span><span>${q.grandTotal === null ? "—" : money(q.grandTotal)}</span></div>
    <div class="row"><strong>${I18N.lang === "ar" ? "المطلوب تحويله مقدمًا" : "Pay in advance"}</strong><strong>${q.shippingFee === null ? "—" : money($("#checkoutForm").elements.paymentMode.value === "full" ? q.grandTotal : q.shippingFee)}</strong></div>`;
}
const setMsg = (text, err = false) => { const m = $("#checkoutMessage"); m.textContent = text; m.className = `form-message ${err ? "error" : "ok"}`; };

const govOptions = (selected = "") => `<option value="">${esc(t("co.govPlaceholder"))}</option>` + state.config.shippingZones.map((z) => `<option value="${esc(z.governorate)}" ${z.governorate === selected ? "selected" : ""}>${esc(label("gov", z.governorate))}</option>`).join("");
function openCheckout() {
  $("#governorate").innerHTML = govOptions();
  state.couponApplied = ""; state.quote = null; $("#couponCode").value = ""; $("#removeCoupon").hidden = true; setMsg(""); $("#checkoutDialog").showModal(); refreshQuote();
}
function validateCheckout() {
  const f = $("#checkoutForm"); let ok = true;
  for (const el of f.querySelectorAll("[required]")) { const bad = !el.value.trim() || (el.minLength > 0 && el.value.trim().length < el.minLength); el.setAttribute("aria-invalid", bad ? "true" : "false"); if (bad) ok = false; }
  const em = f.elements.email; if (em.value && !em.checkValidity()) { em.setAttribute("aria-invalid", "true"); ok = false; }
  if (!/^[0-9+()\s-]{8,20}$/.test(f.elements.phone.value.trim())) { f.elements.phone.setAttribute("aria-invalid", "true"); ok = false; }
  return ok;
}
async function submitOrder(e) {
  e.preventDefault();
  if (state.submitting) return;
  if (!state.cart.length) return setMsg(t("co.emptyCart"), true);
  if (!validateCheckout()) return setMsg(t("co.fixFields"), true);
  if (!state.quote || state.quote.grandTotal === null) return setMsg(t("co.fixFields"), true);
  const payload = orderPayload(); const sig = JSON.stringify(payload);
  // One Idempotency-Key per identical request: a retry after a network failure can never create a second order.
  if (!state.idem || state.idem.sig !== sig) state.idem = { sig, key: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8) };
  state.submitting = true; const btn = $("#placeOrder"); btn.disabled = true; btn.textContent = t("co.placing"); setMsg("");
  try {
    const { order } = await api("/orders", { method: "POST", body: payload, headers: { "Idempotency-Key": state.idem.key } });
    rememberOrder(order.orderNumber, order.trackingToken);
    state.cart = []; state.idem = null; renderCart(); $("#checkoutForm").reset(); $("#checkoutDialog").close();
    loadProducts({ silent: true });
    showOrder(order.orderNumber, order.trackingToken, order);
    toast(t("toast.orderPlaced"));
  } catch (err) {
    if (err.code === "INSUFFICIENT_STOCK" || err.code === "PRODUCT_UNAVAILABLE") { await loadProducts({ silent: true }); state.idem = null; }
    setMsg(err.status === 0 ? `${errText(err)} ${t("co.retryHint")}` : errText(err), true);
  } finally { state.submitting = false; btn.disabled = false; btn.innerHTML = t("co.place"); }
}

/* ------------------------------ orders (tracking, receipt) ------------------------------ */
const savedOrders = () => { try { return JSON.parse(sessionStorage.getItem(ORDERS_KEY) || "[]"); } catch { return []; } };
function rememberOrder(number, token) { try { const l = savedOrders().filter((o) => o.number !== number); l.unshift({ number, token }); sessionStorage.setItem(ORDERS_KEY, JSON.stringify(l.slice(0, 10))); } catch { /* ignore */ } }
const tokenFor = (n) => savedOrders().find((o) => o.number === n)?.token;

const badgeClass = (s) => (["confirmed", "delivered", "processing", "shipped"].includes(s) ? "ok" : ["cancelled", "returned", "rejected"].includes(s) ? "bad" : "warn");

function orderHtml(o, token) {
  const a = o.amounts; const canPay = o.status === "awaiting_shipping_payment" && ["unpaid", "rejected"].includes(o.shippingPaymentStatus);
  const payTo = o.instapay?.handle ? `<code>${esc(o.instapay.handle)}</code>${o.instapay.accountName ? ` (${esc(o.instapay.accountName)})` : ""}` : esc(t("order.pay.toFallback"));
  return `<div class="order-box">
    <div><p class="eyebrow">${esc(t("order.eyebrow"))}</p><h2 id="orderTitle" class="ltr">${esc(o.orderNumber)}</h2></div>
    <div class="order-head"><span class="badge ${badgeClass(o.status)}">${esc(label("status", o.status))}</span><span class="badge ${badgeClass(o.shippingPaymentStatus)}">${esc(t("order.shippingPayment", { s: label("sp", o.shippingPaymentStatus) }))}</span></div>
    <h3 class="order-summary-heading">${esc(t("order.orderItems"))}</h3>
    <div class="order-items">${o.items.map((i) => `<div><span><strong>${esc(i.brand)} · ${esc(i.name)}</strong><small>${esc(i.size)} · ${I18N.num(i.quantity, {})} × ${money(i.unitPrice)}</small></span><span>${money(i.lineTotal)}</span></div>`).join("")}</div>
    <p class="order-delivery"><strong>${esc(t("order.delivery"))}:</strong> ${esc([o.customer?.governorate, o.customer?.city, o.customer?.address].filter(Boolean).join(" — "))}</p>
    ${o.customer?.note ? `<p class="order-delivery">${esc(o.customer.note)}</p>` : ""}
    <p class="order-delivery"><strong>${esc(t("order.paymentMethod"))}:</strong> ${esc(o.paymentMode === "full" ? (I18N.lang === "ar" ? "الدفع الكامل مقدمًا عبر إنستاباي" : "Full advance via InstaPay") : (I18N.lang === "ar" ? "الشحن مقدمًا عبر إنستاباي، والمنتجات عند الاستلام" : "Shipping via InstaPay, products on delivery"))}</p>
    <div class="summary">
      <div class="row"><span>${esc(t("sum.subtotal"))}</span><span>${money(a.productsSubtotal)}</span></div>
      ${a.discount ? `<div class="row"><span>${esc(o.couponCode ? t("sum.discount", { code: o.couponCode }) : t("order.discount"))}</span><span>− ${money(a.discount)}</span></div>` : ""}
      <div class="row"><span>${esc(t("sum.shipping"))}</span><span>${money(a.shippingFee)}</span></div>
      <div class="row total"><span>${esc(t("sum.total"))}</span><span>${money(a.grandTotal)}</span></div>
      <div class="row"><span>${esc(o.paymentMode === "full" ? t("order.dueFull") : t("order.dueNow"))}</span><span>${a.paymentDueNow ? money(a.paymentDueNow) : a.shippingDueNow ? money(a.shippingDueNow) : esc(t("order.paid"))}</span></div>
      <div class="row"><span>${esc(t("order.remaining"))}</span><span>${a.codRemaining ? money(a.codRemaining) : esc(t("order.collected"))}</span></div>
    </div>
    ${o.status === "cancelled" ? `<p class="error-text">${esc(t("order.cancelled"))}</p>` : o.readyToShip ? `<p class="form-message ok">${esc(t("order.ready"))}</p>` : ""}
    ${o.lastRejectReason ? `<p class="error-text">${esc(t("order.rejected", { reason: o.lastRejectReason }))}</p>` : ""}
    ${o.paymentMode === "full" ? `<p class="form-message ok">${I18N.lang === "ar" ? "تم اختيار دفع قيمة الأوردر كاملة مقدمًا" : "Full advance payment selected"}</p>` : ""}
    ${o.shippingPaymentStatus === "submitted" ? `<p class="form-message">${esc(t("order.review"))}</p>` : ""}
    ${canPay ? `<div class="pay-box"><h3>${esc(t(o.paymentMode === "full" ? "order.pay.fullTitle" : "order.pay.title"))}</h3>
      <p>${t("order.pay.intro", { amount: `<strong>${money(a.paymentDueNow ?? a.shippingFee)}</strong>`, to: payTo })}</p>
      ${o.expiresAt ? `<p class="track-code">${esc(t("order.pay.expires", { when: I18N.dateTime(o.expiresAt) }))}</p>` : ""}
      <form id="receiptForm" class="stack" data-order="${esc(o.orderNumber)}"><div class="form-field"><label for="rcpFile">${esc(t("order.pay.file"))}</label><input id="rcpFile" type="file" name="receipt" accept="image/jpeg,image/png,image/webp"></div>
      <div class="form-field"><label for="rcpRef">${esc(t("order.pay.ref"))}</label><input id="rcpRef" name="reference" maxlength="80" autocomplete="off" dir="ltr"></div>
      <button class="button button-dark" type="submit">${t("order.pay.submit")}</button><p class="form-message" id="receiptMsg" role="alert"></p></form></div>` : ""}
    ${token ? `<p class="track-code">${esc(t("order.saveCode"))}<br><code>${esc(o.orderNumber)} · ${esc(token)}</code></p>` : ""}
  </div>`;
}
async function showOrder(number, token, preloaded) {
  const dlg = $("#orderDialog"); const box = $("#orderContent");
  if (!dlg.open) dlg.showModal();
  state.currentOrder = { number, token };
  if (preloaded) box.innerHTML = orderHtml(preloaded, token); else box.innerHTML = `<p>${esc(t("order.loading"))}</p>`;
  try {
    const { order } = await api(`/orders/${encodeURIComponent(number)}`, { headers: token ? { "X-Order-Token": token } : {} });
    if (state.currentOrder?.number === number) box.innerHTML = orderHtml(order, token);
    if (token) subscribeOrder(number, token);
  } catch (e) { box.innerHTML = `<p class="error-text">${esc(e.status === 404 ? t("order.notFound") : errText(e))}</p>`; }
}
async function submitReceipt(form) {
  const msg = $("#receiptMsg"); const btn = form.querySelector("button"); const number = form.dataset.order;
  const fd = new FormData(); const file = form.elements.receipt.files[0]; const ref = form.elements.reference.value.trim();
  if (!file && !ref) { msg.className = "form-message error"; msg.textContent = t("order.pay.needOne"); return; }
  if (file && file.size > 5 * 1024 * 1024) { msg.className = "form-message error"; msg.textContent = t("order.pay.tooBig"); return; }
  if (file) fd.append("receipt", file); if (ref) fd.append("reference", ref);
  btn.disabled = true; msg.className = "form-message"; msg.textContent = t("order.pay.uploading");
  try {
    const { order } = await api(`/orders/${encodeURIComponent(number)}/shipping-payment`, { method: "POST", form: fd, headers: { "X-Order-Token": tokenFor(number) || state.currentOrder?.token || "" } });
    $("#orderContent").innerHTML = orderHtml(order, tokenFor(number)); toast(t("toast.receipt"));
  } catch (e) { btn.disabled = false; msg.className = "form-message error"; msg.textContent = errText(e); }
}

/* ------------------------------ account ------------------------------ */
const firstName = () => state.user.name.split(" ")[0];
function updateAccountLabel() { const txt = state.user ? firstName() : t("nav.account"); $("#accountToggle").setAttribute("aria-label", txt); $("#accountToggle").title = txt; $("#accountToggleMobile").textContent = txt; }
async function loadMe() { try { const d = await api("/auth/me"); state.user = d.user; state.csrf = d.csrfToken || null; } catch { /* offline: stay guest */ } updateAccountLabel(); }
function openAccount(tab = "login") { renderAccount(tab); closeMobileMenu(); if (!$("#accountDialog").open) $("#accountDialog").showModal(); }
function renderAccount(tab = "login") {
  const c = $("#accountContent");
  if (state.user) {
    c.innerHTML = `<p class="eyebrow">${esc(t("acct.eyebrow"))}</p><h2 id="accountTitle">${t("acct.hello", { name: esc(firstName()) })}</h2>
      <div class="tabs" role="tablist"><button role="tab" aria-selected="true">${esc(t("acct.myOrders"))}</button></div><div id="myOrders" class="stack"><p>${esc(t("loading"))}</p></div>
      <p style="margin-top:20px"><button class="text-button" id="logoutBtn" type="button">${esc(t("acct.logout"))}</button>${state.user.role !== "customer" ? ` · <a class="underlined-link" href="/admin">${esc(t("acct.admin"))}</a>` : ""}</p>`;
    api("/me/orders").then((d) => { $("#myOrders").innerHTML = d.items.length ? d.items.map((o) => `<button class="order-mini" data-open-order="${esc(o.orderNumber)}"><span><span class="ltr">${esc(o.orderNumber)}</span><br><small>${esc(I18N.date(o.createdAt))}</small></span><span class="badge ${badgeClass(o.status)}">${esc(label("status", o.status))}</span></button>`).join("") : `<p>${esc(t("acct.noOrders"))}</p>`; }).catch((e) => { $("#myOrders").innerHTML = `<p class="error-text">${esc(errText(e))}</p>`; });
    return;
  }
  const local = savedOrders();
  c.innerHTML = `<p class="eyebrow">${esc(t("acct.eyebrow"))}</p><h2 id="accountTitle">${t("acct.welcome")}</h2>
    <div class="tabs" role="tablist"><button role="tab" data-tab="login" aria-selected="${tab === "login"}">${esc(t("acct.login"))}</button><button role="tab" data-tab="register" aria-selected="${tab === "register"}">${esc(t("acct.register"))}</button><button role="tab" data-tab="track" aria-selected="${tab === "track"}">${esc(t("acct.track"))}</button></div>
    ${tab === "login" ? `<form id="loginForm" class="stack"><div class="form-field"><label for="liEmail">${esc(t("acct.email"))}</label><input id="liEmail" name="email" type="email" autocomplete="email" required dir="ltr"></div><div class="form-field"><label for="liPw">${esc(t("acct.password"))}</label><input id="liPw" name="password" type="password" autocomplete="current-password" required dir="ltr"></div><button class="button button-dark" type="submit">${esc(t("acct.login"))}</button><button type="button" class="text-button" data-tab="forgot">${I18N.lang === "ar" ? "نسيت كلمة المرور؟" : "Forgot password?"}</button><p class="form-message" id="acctMsg" role="alert"></p></form>` : ""}
    ${tab === "forgot" ? `<form id="forgotForm" class="stack"><p>${I18N.lang === "ar" ? "اكتب بريدك الإلكتروني وسنرسل رابطًا لتغيير كلمة المرور إذا كان الحساب موجودًا." : "Enter your email to receive a reset link if your account exists."}</p><div class="form-field"><label for="forgotEmail">${esc(t("acct.email"))}</label><input id="forgotEmail" name="email" type="email" autocomplete="email" required dir="ltr"></div><button class="button button-dark" type="submit">${I18N.lang === "ar" ? "إرسال رابط الاستعادة" : "Send reset link"}</button><button class="text-button" type="button" data-tab="login">${I18N.lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}</button><p class="form-message" id="acctMsg" role="status"></p></form>` : ""}
    ${tab === "register" ? `<form id="registerForm" class="stack"><div class="form-field"><label for="rgName">${esc(t("acct.name"))}</label><input id="rgName" name="name" autocomplete="name" required minlength="2"></div><div class="form-field"><label for="rgEmail">${esc(t("acct.email"))}</label><input id="rgEmail" name="email" type="email" autocomplete="email" required dir="ltr"></div><div class="form-field"><label for="rgPw">${esc(t("acct.passwordNew"))}</label><input id="rgPw" name="password" type="password" autocomplete="new-password" required minlength="8" dir="ltr"></div><button class="button button-dark" type="submit">${esc(t("acct.register"))}</button><p class="form-message" id="acctMsg" role="alert"></p></form>` : ""}
    ${tab === "track" ? `${local.length ? `<div class="stack" style="margin-bottom:18px">${local.map((o) => `<button class="order-mini" data-open-order="${esc(o.number)}"><span class="ltr">${esc(o.number)}</span><span>${t("acct.view")}</span></button>`).join("")}</div>` : ""}<form id="trackForm" class="stack"><div class="form-field"><label for="trNum">${esc(t("acct.orderNo"))}</label><input id="trNum" name="number" placeholder="OP-250101-ABC123" required dir="ltr"></div><div class="form-field"><label for="trTok">${esc(t("acct.token"))}</label><input id="trTok" name="token" autocomplete="off" required dir="ltr"></div><button class="button button-dark" type="submit">${esc(t("acct.trackBtn"))}</button><p class="form-message" id="acctMsg" role="alert"></p></form>` : ""}`;
}
async function doAuth(kind, form) {
  const msg = $("#acctMsg"); const fd = Object.fromEntries(new FormData(form)); msg.className = "form-message"; msg.textContent = t("wait");
  try {
    if (kind === "register") { await api("/auth/register", { method: "POST", body: fd }); }
    const d = await api("/auth/login", { method: "POST", body: { email: fd.email, password: fd.password } });
    state.user = d.user; state.csrf = d.csrfToken; updateAccountLabel(); renderAccount(); reconnectSocket();
  } catch (e) { msg.className = "form-message error"; msg.textContent = authErr(e); }
}

/* ------------------------------ realtime ------------------------------ */
const banner = (text) => { const b = $("#connBanner"); b.hidden = !text; b.textContent = text || ""; };
function initSocket() {
  if (typeof io !== "function") return;
  socket = io({ transports: ["websocket", "polling"], reconnectionDelayMax: 10000 });
  let wasDown = false;
  socket.on("connect", () => {
    banner(""); for (const o of subscribed) socket.emit("order:subscribe", { orderNumber: o.number, token: o.token }, () => {});
    if (wasDown) { wasDown = false; loadProducts({ silent: true }); if (state.currentOrder && $("#orderDialog").open) showOrder(state.currentOrder.number, state.currentOrder.token); } // resync from MySQL via REST
  });
  socket.on("disconnect", () => { wasDown = true; banner(t("net.paused")); });
  socket.on("connect_error", () => { wasDown = true; banner(t("net.paused")); });
  socket.on("product:updated", scheduleRefetch); // payload is just an id; the data itself comes from the API
  const orderEvt = (p) => { if (state.currentOrder?.number === p.orderNumber && $("#orderDialog").open) { showOrder(p.orderNumber, state.currentOrder.token); } };
  for (const ev of ["order:statusChanged", "order:updated", "shippingPayment:confirmed", "shippingPayment:rejected"]) socket.on(ev, orderEvt);
}
const subscribed = [];
function subscribeOrder(number, token) {
  if (!socket || subscribed.some((o) => o.number === number)) return;
  subscribed.push({ number, token }); if (socket.connected) socket.emit("order:subscribe", { orderNumber: number, token }, () => {});
}
function reconnectSocket() { if (socket) { socket.disconnect(); socket.connect(); } }
addEventListener("offline", () => banner(t("net.offline")));
addEventListener("online", () => { banner(""); loadProducts({ silent: true }); });

/* ------------------------------ events ------------------------------ */
document.addEventListener("click", (event) => {
  const tg = event.target; const c = (s) => tg.closest(s);
  const suggest = c("[data-suggest]");
  if (suggest) { event.preventDefault(); state.query = ""; $("#searchInput").value = ""; closeSuggestions(); $("#searchPanel").hidden = true; openProduct(Number(suggest.dataset.suggest)); return; }
  if (!c("#searchPanel") && !c("#searchToggle")) closeSuggestions();
  const add = c("[data-add]"), wish = c("[data-wish]"), view = c("[data-view]"), qty = c("[data-qty]"), rem = c("[data-remove]"), dAdd = c("[data-dialog-add]"), openOrder = c("[data-open-order]"), tab = c("[data-tab]"), track = c("[data-open-track]");
  if (add) { event.stopPropagation(); if (!add.disabled) { const p = productById(Number(add.dataset.add)); if ((p?.variants || []).length > 1) openProduct(Number(add.dataset.add)); else addToCart(Number(add.dataset.add), p?.variants?.[0]?.id); } }
  if (wish) { event.stopPropagation(); const id = Number(wish.dataset.wish); state.wishlist.has(id) ? state.wishlist.delete(id) : state.wishlist.add(id); renderProducts(); renderFeatured(); toast(t(state.wishlist.has(id) ? "toast.wished" : "toast.unwished")); }
  if (view && !c("button")) openProduct(Number(view.dataset.view));
  if (qty) { const item = state.cart.find((i) => i.id === Number(qty.dataset.qty) && String(i.variantId || "") === String(qty.dataset.variant || "")); const p = productById(item?.id); if (item && p) { const totalForProduct = state.cart.filter(i => i.id === item.id).reduce((sum, i) => sum + i.qty, 0); const next = item.qty + Number(qty.dataset.delta); if (next > item.qty && totalForProduct >= p.maxQty) return toast(t("toast.maxQty", { n: I18N.num(p.maxQty, {}), name: p.name })); item.qty = Math.min(next, p.maxQty); if (item.qty < 1) state.cart = state.cart.filter((i) => !(i.id === item.id && String(i.variantId || "") === String(item.variantId || ""))); renderCart(); } }
  if (rem) { state.cart = state.cart.filter((i) => !(i.id === Number(rem.dataset.remove) && String(i.variantId || "") === String(rem.dataset.variant || ""))); renderCart(); toast(t("toast.removed")); }
  if (dAdd && !dAdd.disabled) { const vid = Number($("#dialogVariant")?.value) || undefined; if (addToCart(Number(dAdd.dataset.dialogAdd), vid, Number($("#dialogQuantity")?.value || 1))) { $("#productDialog").close(); openCart(); } }
  if (openOrder) { const n = openOrder.dataset.openOrder; $("#accountDialog").close(); showOrder(n, tokenFor(n)); }
  if (tab) renderAccount(tab.dataset.tab);
  if (track) openAccount("track");
  if (tg.id === "logoutBtn") api("/auth/logout", { method: "POST" }).finally(() => { state.user = null; state.csrf = null; updateAccountLabel(); renderAccount(); loadMe(); reconnectSocket(); });
});
document.addEventListener("change", (event) => { const cartVariant = event.target.closest("[data-cart-variant]"); if (cartVariant) changeCartVariant(Number(cartVariant.dataset.cartVariant), cartVariant.dataset.oldVariant, Number(cartVariant.value)); const sel = event.target.closest("#dialogVariant"); if (sel) { const option = sel.selectedOptions[0]; const price = Number(option?.dataset.price); const el = $("#dialogVariantPrice"); if (el && Number.isFinite(price)) el.innerHTML = dialogPriceHtml(price, option?.dataset.oldPrice === "" ? null : Number(option?.dataset.oldPrice)); } });
document.addEventListener("keydown", (e) => { const el = e.target.closest?.("[data-view]"); if (el && (e.key === "Enter" || e.key === " ") && !e.target.closest("button")) { e.preventDefault(); openProduct(Number(el.dataset.view)); } if (e.key === "Escape") { closeMobileMenu(); if (!$("#cartDrawer").hidden) closeCart(); } });
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (f.id === "receiptForm") { e.preventDefault(); submitReceipt(f); }
  if (f.id === "forgotForm") { e.preventDefault(); const msg = $("#acctMsg"); const email = new FormData(f).get("email"); msg.className = "form-message"; msg.textContent = t("wait"); api("/auth/forgot-password", { method: "POST", body: { email } }).then(() => { msg.textContent = I18N.lang === "ar" ? "إذا كان الحساب موجودًا، ستصلك رسالة الاستعادة قريبًا." : "If this account exists, a reset email will arrive shortly."; }).catch((err) => { msg.className = "form-message error"; msg.textContent = authErr(err); }); }
  if (f.id === "loginForm") { e.preventDefault(); doAuth("login", f); }
  if (f.id === "registerForm") { e.preventDefault(); doAuth("register", f); }
  if (f.id === "trackForm") { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); const n = d.number.trim().toUpperCase(); const tk = d.token.trim(); rememberOrder(n, tk); $("#accountDialog").close(); showOrder(n, tk); }
});

addEventListener("hashchange", () => showRoute());
$("#langToggle").addEventListener("click", () => I18N.toggle());
$("#cartToggle").addEventListener("click", openCart); $("#closeCart").addEventListener("click", closeCart); $("#overlay").addEventListener("click", closeCart); $("#continueShopping").addEventListener("click", () => { closeCart(); location.hash = "#/shop"; });
$("#checkoutButton").addEventListener("click", () => { closeCart(); setTimeout(openCheckout, 180); });
$("#closeProduct").addEventListener("click", () => $("#productDialog").close()); $("#closeCheckout").addEventListener("click", () => $("#checkoutDialog").close());
$("#closeOrder").addEventListener("click", () => { $("#orderDialog").close(); state.currentOrder = null; }); $("#closeAccount").addEventListener("click", () => $("#accountDialog").close());
$("#accountToggle").addEventListener("click", () => openAccount()); $("#accountToggleMobile").addEventListener("click", () => openAccount());
$("#checkoutForm").addEventListener("submit", submitOrder);
$("#governorate").addEventListener("change", refreshQuote);
$("#removeCoupon").addEventListener("click", () => { state.couponApplied = ""; $("#couponCode").value = ""; $("#removeCoupon").hidden = true; setMsg(""); refreshQuote(); });
$("#applyCoupon").addEventListener("click", () => { const v = $("#couponCode").value.trim().toUpperCase(); state.couponApplied = v; setMsg(""); refreshQuote().then(() => { if (state.couponApplied) setMsg(t("co.couponApplied"), false); }); });
$("#searchToggle").addEventListener("click", () => { const p = $("#searchPanel"); p.hidden = !p.hidden; if (!p.hidden) { $("#searchInput").focus(); renderSuggestions(); } else closeSuggestions(); });
$("#searchInput").addEventListener("input", (e) => {
  state.query = e.target.value;
  if (state.page !== "shop") { state.searchNav = true; location.hash = "#/shop"; } // searching from another page takes you to the shop
  else renderProducts();
  renderSuggestions();
});
$("#searchInput").addEventListener("keydown", (e) => {
  const options = $$("[data-suggest]", $("#searchSuggestions"));
  if (e.key === "ArrowDown" && options.length) { e.preventDefault(); selectSuggestion(activeSuggestion + 1); }
  else if (e.key === "ArrowUp" && options.length) { e.preventDefault(); selectSuggestion(activeSuggestion < 0 ? options.length - 1 : activeSuggestion - 1); }
  else if (e.key === "Enter") { if (activeSuggestion >= 0 && options[activeSuggestion]) { e.preventDefault(); options[activeSuggestion].click(); } else closeSuggestions(); }
  else if (e.key === "Escape") { e.preventDefault(); closeSuggestions(); }
});
$("#clearSearch").addEventListener("click", () => { $("#searchInput").value = ""; state.query = ""; renderProducts(); closeSuggestions(); $("#searchInput").focus(); });
$("#sortFilter").addEventListener("change", (e) => { state.sort = e.target.value; renderProducts(); });
$("#resetFilters").addEventListener("click", () => { $("#searchInput").value = ""; state.query = ""; if (state.category !== "All") location.hash = "#/shop"; else renderProducts(); });
$("#retryLoad").addEventListener("click", () => loadProducts());
$("#menuToggle").addEventListener("click", () => { const nav = $(".desktop-nav"), o = nav.classList.toggle("mobile-open"); $("#menuToggle").setAttribute("aria-expanded", String(o)); });
function closeMobileMenu() { $(".desktop-nav").classList.remove("mobile-open"); $("#menuToggle").setAttribute("aria-expanded", "false"); }
// images that fail to load fall back to a default (replaces the old inline onerror handler, which CSP blocks)
document.addEventListener("error", (e) => { const i = e.target; if (i.tagName === "IMG" && i.src !== FALLBACK_IMG && !i.dataset.fb) { i.dataset.fb = "1"; i.src = FALLBACK_IMG; } }, true);
$("#newsletterForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const m = $("#newsletterMessage"); m.className = "form-message"; m.textContent = t("wait");
  try { await api("/newsletter", { method: "POST", body: { email: $("#newsletterEmail").value } }); m.textContent = t("news.thanks"); e.target.reset(); }
  catch (err) { m.className = "form-message error"; m.textContent = err.details?.[0] ? t("news.invalid") : errText(err); }
});

// language switch: static text is re-translated by I18N.apply(); here we redraw everything built from JavaScript
I18N.onChange(() => {
  renderChrome(); renderProducts(); renderFeatured(); renderCart(); renderContact(); renderSuggestions(); renderPaymentPolicy();
  if (state.quote) renderSummary();
  if ($("#accountDialog").open) renderAccount();
});

(async function init() {
  I18N.apply(); renderChrome(); renderCart();
  showRoute(true);
  try { state.config = await api("/config"); } catch { /* products call below will surface the error state */ }
  state.configLoaded = true; renderPaymentPolicy(); updateFloatingWhatsapp(); renderContact(); showRoute(true); // custom categories can now be recognised in the address
  await Promise.all([loadMe(), loadProducts()]);
  initSocket();
})();

function renderPaymentPolicy() {
  const policy = state.config.paymentPolicy || {};
  const full = policy.fullAdvanceEnabled === true;
  const noteField = $("#customerNote")?.closest(".form-field");
  if (noteField) noteField.hidden = state.config.checkoutNotesEnabled !== true;
  const choice = $("#checkoutForm input[value='full']")?.closest("label");
  if (choice) choice.hidden = !full;
  const current = $("#checkoutForm input[value='full']");
  if (!full && current?.checked) $("#checkoutForm input[value='shipping_only']").checked = true;
  const textKey = full ? "policy.full" : "co.policyText";
  const careKey = full ? "policy.fullStep5" : "care.s5.p";
  for (const selector of [".payment-note p", ".cart-footer p[data-i18n='cart.note']", "#faqPaymentAnswer"]) {
    const el = $(selector); if (el) el.textContent = t(textKey);
  }
  const step = document.querySelector('[data-i18n="care.s5.p"]'); if (step) step.textContent = t(careKey);
  const step3 = document.querySelector('[data-i18n="care.s3.p"]'); if (step3) step3.textContent = t(full ? "policy.fullStep3" : "care.s3.p");
  const step3Title = document.querySelector('[data-i18n="care.s3.t"]'); if (step3Title) step3Title.textContent = t(full ? "policy.fullStep3Title" : "care.s3.t");
}

function updateFloatingWhatsapp() {
  const el = document.getElementById("floatingWhatsapp");
  if (!el) return;
  const c = state.config.contact || {};
  const phone = String(c.whatsapp || "").replace(/[^0-9]/g, "").replace(/^0020/, "20").replace(/^0(?=1[0125])/, "20");
  el.hidden = c.whatsappEnabled === false || !/^\d{8,15}$/.test(phone);
  if (!el.hidden) el.href = `https://wa.me/${phone}`;
}

$("#checkoutForm").addEventListener("change", (e) => { if (e.target.name === "paymentMode") renderSummary(); });

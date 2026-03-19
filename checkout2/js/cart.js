/* ============================================
   Cart Management System
   Shared across all pages
   ============================================ */

var Cart = {
  KEY: 'ml_cart',

  getItems: function() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY) || '[]');
    } catch (e) {
      return [];
    }
  },

  addItem: function(item) {
    var items = this.getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === item.id) {
        // Item already in cart — don't add again
        return items;
      }
    }
    items.push({
      id: item.id,
      name: item.name,
      price: item.price,
      oldPrice: item.oldPrice,
      image: item.image,
      quantity: 1
    });
    localStorage.setItem(this.KEY, JSON.stringify(items));
    return items;
  },

  removeItem: function(id) {
    var items = this.getItems();
    var filtered = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].id !== id) filtered.push(items[i]);
    }
    localStorage.setItem(this.KEY, JSON.stringify(filtered));
    return filtered;
  },

  updateQuantity: function(id, qty) {
    var items = this.getItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) {
        items[i].quantity = Math.max(1, qty);
        break;
      }
    }
    localStorage.setItem(this.KEY, JSON.stringify(items));
    return items;
  },

  getSubtotal: function() {
    var items = this.getItems();
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      sum += items[i].price * items[i].quantity;
    }
    return sum;
  },

  getCount: function() {
    var items = this.getItems();
    var count = 0;
    for (var i = 0; i < items.length; i++) {
      count += items[i].quantity;
    }
    return count;
  },

  clear: function() {
    localStorage.removeItem(this.KEY);
  }
};

var PRODUCT_IMAGE_FALLBACKS = {
  tv: '/recompensas/images/tv1.jpg',
  lavar: '/recompensas/images/lavar1.jpg',
  kitferramenta: '/recompensas/images/ferramenta.jpg',
  microo: '/recompensas/images/m1.jpg',
  ar: '/recompensas/images/ar1.webp',
  geladeira: '/recompensas/images/geladeira.jpg',
  jbl01: '/recompensas/images/poco_preto.png',
  fritadeira: '/recompensas/images/f1.jpg',
  fogao: '/recompensas/images/f1_1.jpg',
  aspirador: '/recompensas/images/as1.jpg',
  sofa: '/recompensas/images/s1_2.jpg',
  jbl02: '/recompensas/images/JBL2.webp',
  'guarda-branco': '/recompensas/images/g1_1.jpg',
  'guarda-preto': '/recompensas/images/g1.jpg',
  projetor04: '/recompensas/images/1.webp',
  lilo: '/recompensas/images/1.jpg',
  ps5: '/recompensas/images/s1_1.jpg',
  sam25: '/recompensas/images/s1.jpg',
  xiaomex7: '/recompensas/images/x1.jpg',
  xiaome: '/recompensas/images/x1_1.jpg',
  xiaomex6: '/recompensas/images/x1_2.jpg',
  'iphone16-preto': '/recompensas/images/iphon1.jpg',
  iph09: '/recompensas/images/iphone_15_pro_titanio.jpg',
  iph08: '/recompensas/images/iphone_15_pro_max_titanio_preto.jpg',
  iph07: '/recompensas/images/iphone_15_rosa.jpg',
  iph06: '/recompensas/images/iphone_15_pro_max_titanio_branco.jpg'
};

/* ============================================
   UTM Tracking - Capture & Persist
   ============================================ */

(function captureUTMs() {
  var params = new URLSearchParams(window.location.search);
  var fields = ['src', 'sck', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  var utms = {};
  for (var i = 0; i < fields.length; i++) {
    var v = params.get(fields[i]);
    if (v) utms[fields[i]] = v;
  }
  if (Object.keys(utms).length > 0) {
    localStorage.setItem('ml_utms', JSON.stringify(utms));
  }
  // fbp from Facebook Pixel cookie
  var fbpMatch = document.cookie.match(/(?:^|;\s*)_fbp=([^;]*)/);
  var fbp = fbpMatch ? fbpMatch[1] : null;
  if (fbp) localStorage.setItem('ml_fbp', fbp);
  // fbc from fbclid
  var fbclid = params.get('fbclid');
  if (fbclid) {
    localStorage.setItem('ml_fbc', 'fb.1.' + Date.now() + '.' + fbclid);
  }
})();

/* ============================================
   Helper: Parse Brazilian price string to cents
   "R$ 2.312,90" → 231290
   "R$ 187,58" → 18758
   ============================================ */

function parsePriceToCents(str) {
  if (!str) return 0;
  // Remove everything except digits, dots, commas
  var cleaned = str.replace(/[^\d,\.]/g, '');
  // Remove ALL dots (thousand separators in BR format)
  cleaned = cleaned.replace(/\./g, '');
  // Replace comma with dot (decimal separator)
  cleaned = cleaned.replace(',', '.');
  var val = parseFloat(cleaned);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

/* ============================================
   Helper: Format cents to Brazilian currency
   18758 → "R$ 187,58"
   ============================================ */

function formatPrice(cents) {
  return 'R$ ' + (cents / 100).toFixed(2).replace('.', ',');
}

/* ============================================
   Helper: Get UTM query string for navigation
   ============================================ */

function getUTMQueryString() {
  var utms = {};
  try { utms = JSON.parse(localStorage.getItem('ml_utms') || '{}'); } catch(e) {}
  var params = new URLSearchParams(window.location.search);
  var keys = Object.keys(utms);
  for (var i = 0; i < keys.length; i++) {
    if (!params.has(keys[i])) params.set(keys[i], utms[keys[i]]);
  }
  var qs = params.toString();
  return qs ? '?' + qs : '';
}

/* ============================================
   Helper: Resolve path for both file:// and http://
   From product page → checkout
   ============================================ */

function resolveUrl(absolutePath) {
  function getSiteRoot() {
    var p = window.location.pathname || '';
    var markers = ['/produtos/', '/checkout/', '/recompensas/', '/roleta/', '/up/', '/vsl/', '/questionario/', '/prevsl/'];
    var idx = -1;
    for (var i = 0; i < markers.length; i++) {
      var pos = p.indexOf(markers[i]);
      if (pos !== -1 && (idx === -1 || pos < idx)) idx = pos;
    }
    if (idx === -1) return '';
    return p.substring(0, idx);
  }

  // On file:// protocol, absolute paths don't work
  // Convert to relative based on current location
  if (window.location.protocol === 'file:') {
    // Detect depth: count how many folders deep we are from site root
    // Product pages are at /produtos/{name}/index.html → depth 2
    // Recompensas is at /recompensas/index.html → depth 1
    // Checkout is at /checkout/index.html → depth 1
    var path = window.location.pathname;
    if (path.indexOf('/produtos/') !== -1) {
      // We're 2 levels deep: /produtos/{name}/
      return '../..' + absolutePath;
    } else if (path.indexOf('/recompensas/') !== -1 ||
               path.indexOf('index-2.html') !== -1 ||
               path.indexOf('/roleta/') !== -1 ||
               path.indexOf('/up/') !== -1 ||
               path.indexOf('/vsl/') !== -1 ||
               path.indexOf('/questionario/') !== -1 ||
               path.indexOf('/prevsl/') !== -1) {
      // We're 1 level deep
      return '..' + absolutePath;
    }
    // Fallback: same level
    return '.' + absolutePath;
  }
  // On HTTP, we may be hosted under a subfolder (e.g. http://localhost/promo-ml-25anos.shop/)
  return getSiteRoot() + absolutePath;
}

/* ============================================
   Auto-detect Product Page & Override Buy Button
   ============================================ */

document.addEventListener('DOMContentLoaded', function() {
  var buyBtn = document.querySelector('.pergunta-botao');
  if (buyBtn) {
    function showToast(msg) {
      var toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
      }
      if (msg) toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2500);
    }

    function updateCartBadge() {
      var badge = document.getElementById('cartBadge');
      if (!badge) return;
      try {
        var items = JSON.parse(localStorage.getItem(Cart.KEY) || '[]');
        var count = 0;
        for (var i = 0; i < items.length; i++) count += items[i].quantity || 1;
        badge.textContent = count;
        badge.classList.toggle('visible', count > 0);
      } catch (e) {}
    }

    function goCheckout() {
      window.location.href = resolveUrl('/checkout/index.html') + getUTMQueryString() + (window.location.hash || '');
    }

    function goCheckoutIfHasItems() {
      try {
        var items = JSON.parse(localStorage.getItem(Cart.KEY) || '[]');
        if (items.length > 0) {
          goCheckout();
        } else {
          showToast('Seu carrinho esta vazio. Escolha um produto!');
        }
      } catch (e) {
        showToast('Seu carrinho esta vazio. Escolha um produto!');
      }
    }


    /* ── Extract product data (shared between ViewContent + AddToCart) ── */
    var productIdMatch = window.location.pathname.match(/\/produtos\/([^/]+)\//i);
    var productId = productIdMatch ? productIdMatch[1] : 'produto';

    var nameEl = document.querySelector('.product-title') || document.querySelector('.title');
    var priceEl = document.querySelector('.new-price') || document.querySelector('.new-price2');
    var oldPriceEl = document.querySelector('.old-price') || document.querySelector('.old-price2');
    var imgEl = document.querySelector('.main-image');

    var _pageProduct = {
      id: productId,
      name: nameEl ? nameEl.textContent.trim() : 'Produto',
      price: parsePriceToCents(priceEl ? priceEl.textContent : '0'),
      oldPrice: parsePriceToCents(oldPriceEl ? oldPriceEl.textContent : '0'),
      image: PRODUCT_IMAGE_FALLBACKS[productId] ? resolveUrl(PRODUCT_IMAGE_FALLBACKS[productId]) : (imgEl ? imgEl.src : ''),
      quantity: 1
    };

    /* ── Fire ViewContent on product page load (FB + TT + internal) ── */
    if (_pageProduct.price > 0 && typeof MLA !== 'undefined') {
      MLA.trackViewContent(_pageProduct);
    }

    // CRITICAL: Remove the inline onclick handler properly
    // removeAttribute only removes the HTML attribute, not the compiled handler
    buyBtn.onclick = null;
    buyBtn.removeAttribute('onclick');

    /* ── Shared add-to-cart + navigate logic ── */
    function addAndGo(shouldGoCheckout) {
      // Safety: never add a product with price 0 to cart
      if (_pageProduct.price <= 0) {
        console.error('Cart: product price is 0, selectors may be wrong. Name:', _pageProduct.name, 'Price element:', priceEl);
        alert('Erro ao adicionar produto. Por favor, tente novamente.');
        return;
      }

      Cart.addItem(_pageProduct);
      updateCartBadge();

      // ── Fire AddToCart via MLA (FB + TT + internal, with dedup eventID) ──
      if (typeof MLA !== 'undefined') {
        MLA.trackAddToCart(_pageProduct);
      } else {
        // Fallback: fire pixels directly (no dedup)
        if (typeof fbq === 'function') {
          fbq('track', 'AddToCart', {
            content_name: _pageProduct.name,
            content_ids: [_pageProduct.id],
            content_type: 'product',
            value: _pageProduct.price / 100,
            currency: 'BRL'
          });
        }
        if (typeof ttq !== 'undefined') {
          ttq.track('AddToCart', {
            content_id: _pageProduct.id,
            content_name: _pageProduct.name,
            content_type: 'product',
            value: _pageProduct.price / 100,
            currency: 'BRL'
          });
        }
      }

      if (shouldGoCheckout) {
        goCheckout();
      } else {
        showToast('Produto adicionado ao carrinho!');
      }
    }

    buyBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      addAndGo(true);
    }, true);

    /* ── "Adicionar ao carrinho" button: same behavior ── */
    var cartBtn = document.getElementById('cartBtn') || document.querySelector('.cart-btn');
    if (cartBtn) {
      cartBtn.onclick = null;
      cartBtn.removeAttribute('onclick');
      cartBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        addAndGo(false);
      }, true);
    }

    document.addEventListener('click', function(e) {
      if (!e.target.closest) return;
      var hit = e.target.closest('#navCart') || e.target.closest('.nav-cart') || e.target.closest('[onclick*="handleCartClick"]');
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        goCheckoutIfHasItems();
      }
    }, true);

  }
});

/* ============================================
   Fix "Voltar" button on product pages
   Uses capture-phase delegation to override
   inline onclick handlers reliably.
   Handles BOTH modern (.nav-back) and legacy
   (.menu-icon with /recompensas onclick) pages.
   ============================================ */

document.addEventListener('click', function(e) {
  if (!e.target.closest) return; // old browser guard

  var hit = e.target.closest('.nav-back')
         || e.target.closest('[onclick*="/recompensas"]');

  if (hit) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
  }
}, true);

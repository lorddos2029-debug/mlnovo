/* ============================================
   Checkout - Mercado Livre Style
   4 Steps: Carrinho → Dados → Entrega → Pagamento
   ============================================ */

(function() {
  'use strict';

  var currentStep = 1;
  var selectedFrete = 0; // in cents
  var paymentCode = null;
  var pollingInterval = null;
  var timerInterval = null;
  var pixTimerInterval = null;
  var countdownSeconds = 5 * 60 + 30; // 5 min 30 sec initial timer (overridden by timer_fix)
  var pixCountdownSeconds = 600; // 10 min PIX timer
  var cachedPixData = null; // For PIX idempotency
  var isGeneratingPix = false; // Debounce flag: prevents multiple concurrent API calls

  function fetchJson(url, options) {
    return fetch(url, options).then(function(r) {
      return r.text().then(function(text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          var err = new Error('invalid_json');
          err._status = r.status;
          err._text = text;
          throw err;
        }
        if (!r.ok) {
          var err2 = new Error('http_error');
          err2._status = r.status;
          err2._data = data;
          throw err2;
        }
        return data;
      });
    });
  }

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

  function apiUrl(fileName) {
    return getSiteRoot() + '/api/' + fileName;
  }

  /* ═══════════════════════════════════════
     INIT
     ═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', function() {
  initTimer();
  initInputMasks();
  renderCartPage();

  // If cart is empty, redirect back
  if (Cart.getCount() === 0) {
    window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
    return;
  }

  // ── Fire InitiateCheckout on checkout page load ──
  var items = Cart.getItems();
  var subtotal = Cart.getSubtotal();

  if (!window.__ml_ic_fired) {
    window.__ml_ic_fired = true;

    if (typeof MLA !== 'undefined' && typeof MLA.trackInitiateCheckout === 'function') {
      MLA.trackInitiateCheckout(items, subtotal);

      if (typeof MLA.trackCheckoutStep === 'function') {
        MLA.trackCheckoutStep(1, 'carrinho');
      }
    } else if (typeof fbq === 'function') {
      fbq('track', 'InitiateCheckout', {
        content_ids: items.map(function(i) { return i.id; }),
        content_type: 'product',
        num_items: items.length,
        value: subtotal / 100,
        currency: 'BRL'
      });
    }
  }

  // ═══ FASE 3E: Show trust signals if flag enabled ═══
  if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('trust_signals')) {
    var trustEl = document.getElementById('trustSignals');
    if (trustEl) trustEl.style.display = 'block';
  }
});
  /* ═══════════════════════════════════════
     CART PAGE (Step 1 - dedicated)
     ═══════════════════════════════════════ */
  function renderCartPage() {
    var container = document.getElementById('cart-items');
    var totalEl = document.getElementById('cart-page-total');
    if (!container) return;

    var items = Cart.getItems();
    container.innerHTML = '';

    if (items.length === 0) {
      container.innerHTML =
        '<div class="cart-empty">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="#999"><path d="M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM7.17 14.75l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A.996.996 0 0020.01 4H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 15.37 5.48 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25z"/></svg>' +
          '<p>Seu carrinho está vazio</p>' +
          '<a href="#" onclick="goToRecompensas(); return false;" class="cart-empty-btn">Ver produtos</a>' +
        '</div>';
      if (totalEl) totalEl.textContent = 'R$ 0,00';
      return;
    }

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'cart-item';

      var oldPriceHtml = '';
      if (item.oldPrice && item.oldPrice > item.price) {
        oldPriceHtml = '<span class="cart-item-old-price">' + formatPrice(item.oldPrice) + '</span>';
      }

      div.innerHTML =
        '<img class="cart-item-img" src="' + escapeHtml(item.image || '') + '" alt="' + escapeHtml(item.name) + '">' +
        '<div class="cart-item-body">' +
          '<div class="cart-item-name">' + escapeHtml(item.name) + '</div>' +
          '<div class="cart-item-prices">' +
            oldPriceHtml +
            '<span class="cart-item-price">' + formatPrice(item.price) + '</span>' +
          '</div>' +
          '<div class="cart-item-qty">Quantidade: ' + (item.quantity || 1) + '</div>' +
          '<button class="cart-item-remove" data-id="' + escapeHtml(item.id) + '">Eliminar</button>' +
        '</div>';
      container.appendChild(div);
    });

    // Bind remove buttons
    container.querySelectorAll('.cart-item-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        Cart.removeItem(this.getAttribute('data-id'));
        renderCartPage();
        if (Cart.getCount() === 0) {
          window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
        }
      });
    });

    // Update total
    if (totalEl) totalEl.textContent = formatPrice(Cart.getSubtotal());
  }

  window.goToRecompensas = function() {
    window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
  };

  // ── WhatsApp PIX code sharing (elderly can send to family for help) ──
  window.sendPixWhatsApp = function() {
    var codeEl = document.getElementById('pix-code');
    if (!codeEl || !codeEl.value) return;
    var text = 'Meu código PIX para pagamento:\n\n' + codeEl.value + '\n\nCopie o código acima e cole no app do seu banco em Pix Copia e Cola.';
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  };

  /* ═══════════════════════════════════════
     STEP NAVIGATION
     ═══════════════════════════════════════ */
  window.goToStep = function(step) {
    // Validate current step before advancing
    if (step > currentStep) {
      if (!validateStep(currentStep)) return;
    }

    currentStep = step;

    // Update stepper indicators
    var steps = document.querySelectorAll('.ml-step');
    var lines = document.querySelectorAll('.ml-step-line');

    steps.forEach(function(el) {
      var s = parseInt(el.getAttribute('data-step'));
      el.classList.remove('active', 'completed');
      if (s === currentStep) el.classList.add('active');
      else if (s < currentStep) el.classList.add('completed');
    });

    // Update connecting lines
    lines.forEach(function(line, idx) {
      if (idx < currentStep - 1) {
        line.classList.add('completed');
      } else {
        line.classList.remove('completed');
      }
    });

    // Show/hide step panels
    document.querySelectorAll('.step-panel').forEach(function(el) {
      el.classList.remove('active');
    });
    var stepEl = document.getElementById('step-' + step);
    if (stepEl) {
      stepEl.classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Save customer data for UP page
    if (step >= 3) {
      localStorage.setItem('ml_customer_data', JSON.stringify({
        email: getValue('email'),
        name: getValue('nome'),
        document: getValue('cpf'),
        phone: getValue('telefone')
      }));
    }

    // ── Track checkout step changes (4-step flow) ──
    if (typeof MLA !== 'undefined') {
      var stepNames = { 1: 'carrinho', 2: 'dados', 3: 'entrega', 4: 'pagamento' };
      MLA.trackCheckoutStep(step, stepNames[step] || 'step_' + step);
    }

    // Step 4: show REVIEW first (not PIX yet)
    if (step === 4) {
      renderReview();
      var reviewEl = document.getElementById('step-5-review');
      var pixEl = document.getElementById('step-5-pix');
      if (reviewEl) reviewEl.style.display = 'block';
      if (pixEl) pixEl.style.display = 'none';

      // ── Fire AddPaymentInfo when reaching payment step ──
      if (typeof MLA !== 'undefined') {
        MLA.trackAddPaymentInfo(Cart.getItems(), Cart.getSubtotal() + selectedFrete);
      }
    }
  };

  window.goBack = function() {
    window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
  };

  /* ═══════════════════════════════════════
     CONFIRM AND PAY (Review → PIX transition)
     ═══════════════════════════════════════ */
  window.confirmAndPay = function() {
    var reviewEl = document.getElementById('step-5-review');
    var pixEl = document.getElementById('step-5-pix');

    // Hide review, show PIX view
    if (reviewEl) reviewEl.style.display = 'none';
    if (pixEl) pixEl.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Now generate PIX
    generatePix();
  };

  /* ═══════════════════════════════════════
     REVIEW PAGE (renders billing, address, items)
     ═══════════════════════════════════════ */
  function renderReview() {
    try {
      var items = Cart.getItems();
      var subtotal = Cart.getSubtotal();

      // ── Safety net: recalculate subtotal from items if 0 but cart not empty ──
      if ((!subtotal || subtotal <= 0) && items.length > 0) {
        console.warn('Review: subtotal was', subtotal, '— recalculating from items');
        subtotal = 0;
        for (var ri = 0; ri < items.length; ri++) {
          var p = parseInt(items[ri].price) || 0;
          var q = parseInt(items[ri].quantity) || 1;
          subtotal += p * q;
        }
      }

      var total = subtotal + selectedFrete;

      // Format price as "R$ XX<sup>YY</sup>"
      function priceWithSup(cents) {
        cents = Math.round(cents) || 0;
        var reais = Math.floor(cents / 100);
        var centavos = cents % 100;
        return 'R$ ' + reais.toLocaleString('pt-BR') + '<sup>' + (centavos < 10 ? '0' : '') + centavos + '</sup>';
      }

      // Pricing
      var prodEl = document.getElementById('review-produto');
      var freteEl = document.getElementById('review-frete');
      var subEl = document.getElementById('review-subtotal');
      var totalEl = document.getElementById('review-total');

      if (prodEl) prodEl.innerHTML = priceWithSup(subtotal);
      if (freteEl) freteEl.innerHTML = selectedFrete === 0 ? '<span style="color:#00a650;font-weight:600">Grátis</span>' : priceWithSup(selectedFrete);
      if (subEl) subEl.innerHTML = priceWithSup(total);
      if (totalEl) totalEl.innerHTML = priceWithSup(total);

      // ── Show savings badge ──
      var totalOld = 0;
      items.forEach(function(item) {
        var qty = parseInt(item.quantity) || 1;
        var ip = parseInt(item.price) || 0;
        var iop = parseInt(item.oldPrice) || 0;
        totalOld += (iop > ip) ? iop * qty : ip * qty;
      });
      var savingsAmount = Math.round(totalOld - subtotal);
      var savingsDiv = document.getElementById('review-savings');
      var savingsText = document.getElementById('review-savings-text');
      if (savingsAmount >= 100 && savingsDiv && savingsText) {
        savingsText.textContent = 'Você está economizando ' + formatPrice(savingsAmount);
        savingsDiv.style.display = 'flex';
      } else if (savingsDiv) {
        savingsDiv.style.display = 'none';
      }

      // Billing info
      var nameEl = document.getElementById('review-name');
      var cpfEl = document.getElementById('review-cpf');
      if (nameEl) nameEl.textContent = getValue('nome') || '—';
      if (cpfEl) cpfEl.textContent = 'CPF ' + (getValue('cpf') || '—');

      // Address
      var addrEl = document.getElementById('review-address');
      if (addrEl) {
        var rua = getValue('rua');
        var num = getValue('numero');
        var comp = getValue('complemento');
        var bairro = getValue('bairro');
        var cidade = getValue('cidade');
        var uf = getValue('uf');
        var parts = [];
        if (rua) parts.push(rua);
        if (num) parts.push(num);
        if (comp) parts.push(comp);
        var line2 = [];
        if (bairro) line2.push(bairro);
        if (cidade) line2.push(cidade);
        if (uf) line2.push(uf);
        addrEl.innerHTML = (parts.join(' ') || '—') + (line2.length ? '<br>' + line2.join(', ') : '');
      }

      // Shipping items
      var shipContainer = document.getElementById('review-shipping-items');
      if (shipContainer) {
        var deliveryText = getSelectedFreteDelivery();
        shipContainer.innerHTML = '';
        items.forEach(function(item) {
          var div = document.createElement('div');
          div.className = 'review-ship-item';
          div.innerHTML =
            '<img src="' + escapeHtml(item.image || '') + '" alt="">' +
            '<div class="review-ship-info">' +
              '<div class="review-ship-delivery">' + deliveryText + '</div>' +
              '<div class="review-ship-name">' + escapeHtml(item.name || 'Produto') + '</div>' +
              '<div class="review-ship-qty">Quantidade: ' + (item.quantity || 1) + '</div>' +
            '</div>';
          shipContainer.appendChild(div);
        });
      }
    } catch(e) {
      console.error('renderReview error:', e);
    }
  }

  function getSelectedFreteDelivery() {
    var radio = document.querySelector('input[name="frete"]:checked');
    if (!radio) return 'Chegará em até 21 dias úteis';
    switch(radio.value) {
      case '3266': return 'Chegará em até 3 dias úteis';
      case '5922': return 'Chegará em 12 a 24 horas';
      default: return 'Chegará em até 21 dias úteis';
    }
  }


  /* ═══════════════════════════════════════
     FORM VALIDATION
     ═══════════════════════════════════════ */
  function validateStep(step) {
    clearErrors();

    if (step === 1) {
      // Cart: just ensure cart isn't empty
      return Cart.getCount() > 0;
    }

    if (step === 2) {
      // FASE 3D: Minimal validation — require at least email OR nome
      if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('form_validation')) {
        var email = getValue('email');
        var nome = getValue('nome');
        if (!email && !nome) {
          showError('email', 'Informe pelo menos seu e-mail');
          return false;
        }
      }
      return true;
    }

    if (step === 3) {
      // FASE 3D: Basic CEP validation (8 digits)
      if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('form_validation')) {
        var cep = getValue('cep').replace(/\D/g, '');
        if (cep && cep.length !== 8) {
          showError('cep', 'CEP deve ter 8 dígitos');
          return false;
        }
      }
      return true;
    }

    return true;
  }

  function getValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function showError(id, msg) {
    var el = document.getElementById(id);
    if (el) {
      el.classList.add('error');
      var errEl = el.parentNode.querySelector('.field-error');
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
      el.focus();

      // ── Track form error ──
      if (typeof MLA !== 'undefined') {
        MLA.trackFormError(id, msg);
      }
    }
  }

  function clearErrors() {
    document.querySelectorAll('.error').forEach(function(el) {
      el.classList.remove('error');
    });
    document.querySelectorAll('.field-error').forEach(function(el) {
      el.style.display = 'none';
    });
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  /* ═══════════════════════════════════════
     INPUT MASKS
     ═══════════════════════════════════════ */
  function initInputMasks() {
    var cpfEl = document.getElementById('cpf');
    if (cpfEl) {
      cpfEl.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        this.value = v;
      });
    }

    var telEl = document.getElementById('telefone');
    if (telEl) {
      telEl.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
        else if (v.length > 2) v = v.replace(/(\d{2})(\d{1,5})/, '($1) $2');
        this.value = v;
      });
    }

    var cepEl = document.getElementById('cep');
    if (cepEl) {
      cepEl.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 8);
        if (v.length > 5) v = v.replace(/(\d{5})(\d{1,3})/, '$1-$2');
        this.value = v;
      });
      // Auto-search on 8 digits
      cepEl.addEventListener('input', function() {
        if (this.value.replace(/\D/g, '').length === 8) {
          buscarCEP();
        }
      });
    }
  }

  /* ═══════════════════════════════════════
     VIACEP
     ═══════════════════════════════════════ */
  function unlockAddressFields() {
    ['rua', 'bairro', 'cidade', 'uf'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.hasAttribute('readonly')) {
        el.removeAttribute('readonly');
        el.placeholder = 'Digite aqui';
      }
    });
  }

  window.buscarCEP = function() {
    var cep = getValue('cep').replace(/\D/g, '');
    if (cep.length !== 8) return;

    var cepBtn = document.querySelector('.cep-btn');
    if (cepBtn) cepBtn.textContent = '...';

    // Use server-side proxy to avoid CORS issues with ViaCEP
    fetch(apiUrl('cep.php') + '?cep=' + cep)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.erro) {
          unlockAddressFields();
          return;
        }
        setField('rua', data.logradouro || '');
        setField('bairro', data.bairro || '');
        setField('cidade', data.localidade || '');
        setField('uf', data.uf || '');

        var numEl = document.getElementById('numero');
        if (numEl) numEl.focus();
      })
      .catch(function() {
        unlockAddressFields();
        showToast('CEP não encontrado. Digite o endereço manualmente.');
      })
      .finally(function() {
        if (cepBtn) cepBtn.textContent = 'Buscar';
      });
  };

  function setField(id, val) {
    var el = document.getElementById(id);
    if (el) {
      el.value = val;
      if (!val && el.hasAttribute('readonly')) {
        el.removeAttribute('readonly');
        el.placeholder = 'Digite aqui';
      }
    }
  }

  /* ═══════════════════════════════════════
     SHIPPING SELECTION
     ═══════════════════════════════════════ */
  window.selectFrete = function(value) {
    selectedFrete = parseInt(value);
    document.querySelectorAll('.ship-opt').forEach(function(el) {
      el.classList.remove('selected');
    });
    var radio = document.querySelector('input[name="frete"][value="' + value + '"]');
    if (radio) {
      radio.checked = true;
      radio.closest('.ship-opt').classList.add('selected');
    }
  };

  /* ═══════════════════════════════════════
     PIX GENERATION
     ═══════════════════════════════════════ */
  function generatePix() {
    // ═══ DEBOUNCE: Prevent multiple concurrent API calls ═══
    // Without this, clicking multiple times creates multiple gateway requests
    // which exhaust PHP workers and show "Não foi possível gerar QR Code"
    if (isGeneratingPix) {
      console.warn('PIX generation already in progress, ignoring duplicate click');
      return;
    }

    var loading = document.getElementById('pix-loading');
    var content = document.getElementById('pix-content');
    var confirmed = document.getElementById('pix-confirmed');

    var items = Cart.getItems();
    var subtotalCalc = Cart.getSubtotal();

    // ── Safety net: recalculate if subtotal is 0 but cart has items ──
    if ((!subtotalCalc || subtotalCalc <= 0) && items.length > 0) {
      console.warn('generatePix: subtotal was', subtotalCalc, '— recalculating from items');
      subtotalCalc = 0;
      for (var gi = 0; gi < items.length; gi++) {
        subtotalCalc += (parseInt(items[gi].price) || 0) * (parseInt(items[gi].quantity) || 1);
      }
    }

    var totalAmount = subtotalCalc + selectedFrete;

    // Safety: block payment if amount is invalid (minimum R$5,00 = 500 cents)
    if (totalAmount < 500) {
      if (loading) loading.style.display = 'none';
      alert('Erro: valor do pedido inválido (R$ ' + (totalAmount / 100).toFixed(2).replace('.', ',') + '). Volte e adicione produtos novamente.');
      window.location.href = resolveUrl('/recompensas/index.html') + getUTMQueryString() + (window.location.hash || '');
      return;
    }

    // ═══ FASE 3A: PIX Idempotency — reuse pending PIX from same session ═══
    if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('pix_idempotency')) {
      try {
        var cached = sessionStorage.getItem('ml_pending_pix');
        if (cached) {
          var pix = JSON.parse(cached);
          var ageMin = (Date.now() - pix.created_at) / 1000 / 60;
          if (pix.amount === totalAmount && ageMin < 25 && pix.pix_qrcode_text) {
            // Reuse existing PIX — skip API call
            isGeneratingPix = true; // Lock: already have a valid PIX
            showExistingPix(pix, totalAmount, items);
            return;
          }
        }
      } catch(e) {}
    }

    // Lock: prevent duplicate calls during API request
    isGeneratingPix = true;

    if (loading) {
      loading.style.display = 'block';
      loading.innerHTML = '<div class="ml-spinner" style="margin:2rem auto;width:40px;height:40px"></div><p style="text-align:center;color:#666;font-size:14px;margin-top:12px">Gerando QR Code PIX...</p>';
    }
    if (content) content.style.display = 'none';
    if (confirmed) confirmed.style.display = 'none';

    var utms = {};
    try { utms = JSON.parse(localStorage.getItem('ml_utms') || '{}'); } catch(e) {}
    var fbp = localStorage.getItem('ml_fbp') || null;
    var fbc = localStorage.getItem('ml_fbc') || null;
    var ttclid = localStorage.getItem('ml_ttclid') || null;

    var sessionId = (typeof MLA !== 'undefined') ? MLA.getSessionId() : '';

    var payload = {
      customer: {
        email: getValue('email'),
        name: getValue('nome'),
        document: getValue('cpf'),
        phone: getValue('telefone')
      },
      amount: totalAmount,
      items: items.map(function(item) {
        return {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        };
      }),
      trackingParameters: (function() {
        var tp = {};
        for (var k in utms) { if (utms.hasOwnProperty(k)) tp[k] = utms[k]; }
        tp.fbp = fbp; tp.fbc = fbc; tp.ttclid = ttclid;
        return tp;
      })(),
      metadata: {
        frete: selectedFrete,
        frete_type: getSelectedFreteType(),
        cep: getValue('cep'),
        cidade: getValue('cidade'),
        uf: getValue('uf'),
        bairro: getValue('bairro'),
        session_id: sessionId,
        experiment_id: (window.__ML_EXPERIMENT && window.__ML_EXPERIMENT.id) || null,
        variant_id: (window.__ML_EXPERIMENT && window.__ML_EXPERIMENT.variant) || null
      }
    };

    var req = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };

    fetchJson(apiUrl('payment.php'), req)
    .then(function(data) {
      if (!data.success || (!data.pix_qrcode_text && !data.pix_qrcode_base64)) {
        console.error('Gateway response:', data);
        throw new Error(data.error || 'Erro ao gerar PIX');
      }

      paymentCode = data.payment_code;

      // ═══ Affiliate: persist flag if server decided this is affiliate ═══
      if (data.affiliate) {
        localStorage.setItem('ml_affiliate', '1');
      }

      // ── A/B metric: record pix_generated for control group ──
      if (typeof recordABMetric === 'function') {
        recordABMetric('fast_checkout', 'control', 'pix_generated', { amount: totalAmount });
      }

      // ═══ FASE 3A: Cache PIX data for idempotency ═══
      try {
        sessionStorage.setItem('ml_pending_pix', JSON.stringify({
          payment_code: data.payment_code,
          pix_qrcode_text: data.pix_qrcode_text || '',
          pix_qrcode_base64: data.pix_qrcode_base64 || '',
          amount: totalAmount,
          created_at: Date.now()
        }));
      } catch(e) {}

      displayPixUI(data.pix_qrcode_text || '', totalAmount, items, data.pix_qrcode_base64 || '');
    })
    .catch(function(err) {
      // Unlock: allow retry after error
      isGeneratingPix = false;
      var msg = 'Erro ao gerar PIX. Tente novamente.';
      if (err && err._text && typeof err._text === 'string') {
        var t = err._text.trim().slice(0, 200).toLowerCase();
        if (t.indexOf('<?php') === 0 || t.indexOf('<!doctype') === 0 || t.indexOf('<html') === 0) {
          msg = 'Seu localhost está servindo PHP como arquivo (não executa). Rode com XAMPP/Laragon (Apache + PHP) ou publique no domínio.';
        }
      } else if (err && err._data && err._data.error) {
        msg = err._data.error;
      } else if (err && err.message && err.message !== 'invalid_json' && err.message !== 'http_error') {
        msg = err.message;
      } else if (err && err._status === 404) {
        msg = 'API de pagamento não encontrada (/api/payment.php).';
      } else if (err && err.message && ('' + err.message).toLowerCase().indexOf('failed to fetch') !== -1) {
        msg = 'Não foi possível acessar a API de pagamento.';
      }
      if (loading) loading.innerHTML =
        '<p style="color:#f23d4f;font-size:14px;margin-bottom:12px;">' + msg + '</p>' +
        '<button class="ml-btn-primary" onclick="generatePix()" style="max-width:260px;margin:0 auto;">Tentar novamente</button>';
      console.error('PIX Error:', err);
    });
  }

  // ═══ Show cached PIX (idempotency) ═══
  function showExistingPix(pixData, totalAmount, items) {
    paymentCode = pixData.payment_code;

    var loading = document.getElementById('pix-loading');
    if (loading) loading.style.display = 'none';

    displayPixUI(pixData.pix_qrcode_text || '', totalAmount, items, pixData.pix_qrcode_base64 || '');
  }

  // ═══ Shared PIX UI display logic (CRO Redesign) ═══
  function displayPixUI(pixQrcodeText, totalAmount, items, pixQrcodeBase64) {
    var loading = document.getElementById('pix-loading');
    var content = document.getElementById('pix-content');

    // Generate QR Code inside the details toggle
    var qrContainer = document.getElementById('qr-code');
    if (qrContainer) {
      if (pixQrcodeText && typeof qrcode !== 'undefined') {
        var qr = qrcode(0, 'M');
        qr.addData(pixQrcodeText);
        qr.make();
        qrContainer.innerHTML = qr.createImgTag(4, 8);
      } else if (pixQrcodeBase64) {
        qrContainer.innerHTML = '<img src="data:image/png;base64,' + pixQrcodeBase64 + '" alt="QR Code PIX" style="max-width:220px;width:100%;height:auto;">';
      }
    }

    // Set copy code
    var codeInput = document.getElementById('pix-code');
    if (codeInput) codeInput.value = pixQrcodeText;

    // Show content
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'block';

    // ── Populate product card with first item info ──
    var firstItem = items && items.length > 0 ? items[0] : null;
    var prodImg = document.getElementById('pix-product-img');
    var prodName = document.getElementById('pix-product-name');
    if (firstItem) {
      if (prodImg) { prodImg.src = firstItem.image || ''; prodImg.alt = firstItem.name || ''; }
      if (prodName) {
        var nameText = firstItem.name || 'Produto';
        if (items.length > 1) nameText += ' + ' + (items.length - 1) + ' item(s)';
        prodName.textContent = nameText;
      }
    }

    // ── Price anchoring: show old price and savings ──
    var pixAmountEl = document.getElementById('pix-amount');
    if (pixAmountEl) pixAmountEl.textContent = formatPrice(totalAmount);

    var totalOldPrice = 0;
    items.forEach(function(item) {
      var qty = parseInt(item.quantity) || 1;
      var ip = parseInt(item.price) || 0;
      var iop = parseInt(item.oldPrice) || 0;
      totalOldPrice += (iop > ip) ? iop * qty : ip * qty;
    });

    var oldPriceEl = document.getElementById('pix-old-price');
    var savingsEl = document.getElementById('pix-savings-text');
    var lossAmountEl = document.getElementById('pix-loss-amount');
    var savingsDiv = document.getElementById('pix-savings');
    var lossDiv = document.getElementById('pix-loss-text');
    var savings = Math.round(totalOldPrice - totalAmount);

    if (savings >= 100) {
      // Show savings (at least R$ 1,00)
      if (oldPriceEl) { oldPriceEl.textContent = formatPrice(totalOldPrice); oldPriceEl.style.display = ''; }
      if (savingsEl) savingsEl.textContent = 'Você economiza ' + formatPrice(savings);
      if (savingsDiv) savingsDiv.style.display = 'flex';
      if (lossAmountEl) lossAmountEl.textContent = formatPrice(savings);
      if (lossDiv) lossDiv.style.display = 'flex';
    } else {
      // No meaningful savings — hide all savings/loss elements
      if (oldPriceEl) oldPriceEl.style.display = 'none';
      if (savingsDiv) savingsDiv.style.display = 'none';
      if (lossDiv) lossDiv.style.display = 'none';
    }

    // ── Randomized social proof counter ──
    var buyersEl = document.getElementById('pix-buyers-count');
    if (buyersEl) {
      var count = 30 + Math.floor(Math.random() * 40); // 30-69
      buyersEl.textContent = count + ' pessoas compraram hoje';
    }

    // Auto-copy PIX code on display (reduces 1 click of friction for elderly)
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(pixQrcodeText).then(function() {
          showToast('Código PIX copiado automaticamente! Cole no app do seu banco.');
          var copyBtn = document.getElementById('copy-btn');
          if (copyBtn) {
            copyBtn.classList.add('copied');
            copyBtn.querySelector('span').textContent = '✓ CÓDIGO COPIADO!';
            setTimeout(function() {
              copyBtn.classList.remove('copied');
              copyBtn.querySelector('span').textContent = 'COPIAR CÓDIGO PIX';
            }, 5000);
          }
        });
      }
    } catch(e) {}

    // Start PIX countdown timer
    startPixCountdown();

    // Start polling for payment
    startPolling();

    // ── Fire GeneratePixCode event (FB custom + TT + internal) ──
    // Affiliate: suppress all pixel events
    if (!localStorage.getItem('ml_affiliate')) {
      if (typeof MLA !== 'undefined') {
        MLA.trackGeneratePixCode(paymentCode, totalAmount, items);
      } else {
        if (typeof fbq === 'function') {
          fbq('track', 'InitiateCheckout', {
            value: totalAmount / 100,
            currency: 'BRL',
            num_items: Cart.getCount(),
            content_ids: items.map(function(i) { return i.id; }),
            content_type: 'product'
          });
        }
        if (typeof ttq !== 'undefined') {
          ttq.track('InitiateCheckout', {
            content_type: 'product',
            content_id: items.map(function(i) { return i.id; }).join(','),
            quantity: Cart.getCount(),
            value: totalAmount / 100,
            currency: 'BRL'
          });
        }
      }
    }

    // ═══ Track page visibility changes (user switching to bank app) ═══
    if (!window._pixVisibilityTracked) {
      window._pixVisibilityTracked = true;
      document.addEventListener('visibilitychange', function() {
        if (typeof MLA !== 'undefined' && paymentCode) {
          MLA.track('pix_page_visibility', {
            payment_code: paymentCode,
            visible: !document.hidden,
            state: document.visibilityState
          });
        }
      });
    }
  }

  window.generatePix = generatePix;

  function getSelectedFreteType() {
    var radio = document.querySelector('input[name="frete"]:checked');
    if (!radio) return 'gratis';
    switch(radio.value) {
      case '3266': return 'mercado_envio';
      case '5922': return 'azul_cargo';
      default: return 'gratis';
    }
  }

  /* ═══════════════════════════════════════
     PIX COUNTDOWN
     ═══════════════════════════════════════ */
  function startPixCountdown() {
    pixCountdownSeconds = 600;
    if (pixTimerInterval) clearInterval(pixTimerInterval);

    updatePixCountdown();
    pixTimerInterval = setInterval(function() {
      pixCountdownSeconds--;
      if (pixCountdownSeconds <= 0) {
        pixCountdownSeconds = 0;
        clearInterval(pixTimerInterval);
      }
      updatePixCountdown();
    }, 1000);
  }

  function updatePixCountdown() {
    var el = document.getElementById('pix-countdown');
    var banner = document.getElementById('pix-urgency-banner');
    if (!el) return;

    var m = Math.floor(pixCountdownSeconds / 60);
    var s = pixCountdownSeconds % 60;
    el.textContent = pad(m) + ':' + pad(s);

    // Hide banner when expired
    if (pixCountdownSeconds <= 0 && banner) {
      banner.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════
     COPY PIX CODE
     ═══════════════════════════════════════ */
  window.copyPixCode = function() {
    var input = document.getElementById('pix-code');
    var btn = document.getElementById('copy-btn');
    if (!input) return;

    var copySuccess = function() {
      if (btn) {
        btn.classList.add('copied');
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><span>\u2713 CÓDIGO COPIADO!</span>';

        setTimeout(function() {
          btn.classList.remove('copied');
          btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg><span>COPIAR CÓDIGO PIX</span>';
        }, 4000);
      }
      showToast('Código PIX copiado! Cole no app do seu banco.');

      // ── Fire CopyPixCode event ──
      if (typeof MLA !== 'undefined') {
        MLA.trackCopyPixCode(paymentCode);
      }
    };

    if (navigator.clipboard) {
      navigator.clipboard.writeText(input.value).then(copySuccess);
    } else {
      input.select();
      document.execCommand('copy');
      copySuccess();
    }
  };

  /* ═══════════════════════════════════════
     PAYMENT POLLING
     ═══════════════════════════════════════ */
  function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    var maxAttempts = 200;
    var attempts = 0;

    pollingInterval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(pollingInterval);
        return;
      }
      checkPaymentStatus();
      updatePollingMessage(attempts);
    }, 2000);
  }

  function updatePollingMessage(attempts) {
    var statusEl = document.getElementById('payment-status');
    if (!statusEl) return;
    var span = statusEl.querySelector('span');
    if (!span) return;

    var messages = [
      'Aguardando pagamento...',
      'Aguardando confirmação do banco...',
      'Verificando pagamento...',
      'Ainda aguardando...',
      'O banco pode levar alguns segundos...'
    ];

    var idx = Math.floor(attempts / 3) % messages.length;
    span.textContent = messages[idx];
  }

  window.checkPayment = function() {
    var btn = document.getElementById('check-btn');
    if (btn) {
      btn.innerHTML =
        '<div class="ml-spinner" style="width:16px;height:16px;border-width:2px;margin:0;display:inline-block;vertical-align:middle;"></div>' +
        ' Verificando...';
    }

    var statusEl = document.getElementById('payment-status');
    if (statusEl) statusEl.classList.add('checking');

    checkPaymentStatus(true);
  };

  function checkPaymentStatus(manual) {
    if (!paymentCode) return;

    var pollUrl = apiUrl('check-payment.php') + '?code=' + encodeURIComponent(paymentCode);
    if (localStorage.getItem('ml_affiliate')) pollUrl += '&aff=1';

    fetch(pollUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.status === 'paid') {
          onPaymentConfirmed();
        } else if (data.status === 'failed') {
          // Payment failed at gateway level - show error and allow retry
          if (pollingInterval) clearInterval(pollingInterval);
          var statusEl = document.getElementById('payment-status');
          if (statusEl) {
            statusEl.classList.remove('checking');
            statusEl.innerHTML = '<div style="color:#ef4444;text-align:center;padding:1rem 0">' +
              '<div style="font-size:1.3rem;margin-bottom:0.5rem">⚠️ Erro no pagamento</div>' +
              '<div style="font-size:0.9rem;color:#fca5a5;margin-bottom:1rem">O banco retornou um erro ao processar o PIX. Isso pode acontecer por instabilidade momentânea.</div>' +
              '<button onclick="location.reload()" style="background:#3b82f6;color:#fff;border:none;padding:0.7rem 2rem;border-radius:8px;font-size:0.95rem;cursor:pointer;font-weight:600">Tentar novamente</button>' +
              '</div>';
          }
          var btn = document.getElementById('check-btn');
          if (btn) btn.style.display = 'none';
        } else if (manual) {
          var btn = document.getElementById('check-btn');
          if (btn) {
            btn.textContent = 'Ainda não confirmado. Aguarde...';
          }
          setTimeout(function() {
            if (btn) {
              btn.textContent = 'Já paguei - Verificar';
            }
            var statusEl = document.getElementById('payment-status');
            if (statusEl) statusEl.classList.remove('checking');
          }, 3000);
        }
      })
      .catch(function() {
        if (manual) {
          var btn = document.getElementById('check-btn');
          if (btn) {
            btn.textContent = 'Já paguei - Verificar';
          }
        }
      });
  }

  function onPaymentConfirmed() {
    if (pollingInterval) clearInterval(pollingInterval);
    if (pixTimerInterval) clearInterval(pixTimerInterval);

    var content = document.getElementById('pix-content');
    var confirmed = document.getElementById('pix-confirmed');

    if (content) content.style.display = 'none';
    if (confirmed) confirmed.style.display = 'block';

    var statusEl = document.getElementById('payment-status');
    if (statusEl) {
      statusEl.classList.remove('checking');
      statusEl.classList.add('confirmed');
    }

    // ── A/B metric: record purchase for control group ──
    if (typeof recordABMetric === 'function') {
      recordABMetric('fast_checkout', 'control', 'purchase', { amount: Cart.getSubtotal() + selectedFrete });
    }

    var cartItems = Cart.getItems();
    var purchaseTotal = Cart.getSubtotal() + selectedFrete;

    // ── Fire Purchase event via MLA (FB + TT + internal, with dedup) ──
    // Affiliate: suppress all Purchase/CompletePayment pixel events
    if (!localStorage.getItem('ml_affiliate')) {
      if (typeof MLA !== 'undefined') {
        var purchaseEventId = MLA.trackPurchase(paymentCode, purchaseTotal, cartItems);
        try { localStorage.setItem('ml_purchase_event_id', purchaseEventId); } catch(e) {}
      } else {
        // Fallback without MLA
        var purchaseEventId = 'pur_' + paymentCode + '_' + Date.now();
        try { localStorage.setItem('ml_purchase_event_id', purchaseEventId); } catch(e) {}
        var purchaseValue = purchaseTotal / 100;
        if (typeof fbq === 'function') {
          fbq('track', 'Purchase', {
            value: purchaseValue,
            currency: 'BRL',
            content_ids: cartItems.map(function(i) { return i.id; }),
            content_type: 'product',
            order_id: paymentCode
          }, { eventID: purchaseEventId });
        }
        if (typeof ttq !== 'undefined') {
          ttq.track('CompletePayment', {
            content_type: 'product',
            content_id: cartItems.map(function(i) { return i.id; }).join(','),
            quantity: cartItems.reduce(function(sum, i) { return sum + i.quantity; }, 0),
            value: purchaseValue,
            currency: 'BRL'
          });
        }
      }
    }

    // Clear cached PIX data
    try { sessionStorage.removeItem('ml_pending_pix'); } catch(e) {}

    // Save cart items before clearing (needed for /esgotou redirect)
    var savedCartItems = Cart.getItems();

    // Clear cart
    Cart.clear();

    // Redirect to /esgotou/ based on cart contents
    setTimeout(function() {
      if (savedCartItems.length === 1) {
        window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/index.html') + '?produto=' + encodeURIComponent(savedCartItems[0].id);
      } else if (savedCartItems.length >= 2) {
        var sorted = savedCartItems.slice().sort(function(a, b) { return b.price - a.price; });
        window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/carrinho.html') + '?esgotou=' + encodeURIComponent(sorted[0].id) + '&ok=' + encodeURIComponent(sorted[1].id);
      } else {
        // Fallback: no items (shouldn't happen)
        window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/index.html');
      }
    }, 2000);
  }

  /* ═══════════════════════════════════════
     COUNTDOWN TIMER (STICKY BAR)
     ═══════════════════════════════════════ */
  function initTimer() {
    // FASE 3B: Timer fix — longer duration, hide when expired instead of showing 00:00:00
    if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('timer_fix')) {
      countdownSeconds = 15 * 60; // 15 minutes
      var saved = sessionStorage.getItem('ml_timer_v2');
      if (saved) {
        var elapsed = Math.floor((Date.now() - parseInt(saved)) / 1000);
        countdownSeconds = Math.max(0, countdownSeconds - elapsed);
      } else {
        sessionStorage.setItem('ml_timer_v2', Date.now().toString());
      }
    } else {
      // Original behavior
      var saved = sessionStorage.getItem('ml_timer');
      if (saved) {
        var elapsed = Math.floor((Date.now() - parseInt(saved)) / 1000);
        countdownSeconds = Math.max(0, countdownSeconds - elapsed);
      } else {
        sessionStorage.setItem('ml_timer', Date.now().toString());
      }
    }

    updateTimerDisplay();
    timerInterval = setInterval(function() {
      countdownSeconds--;
      if (countdownSeconds <= 0) {
        countdownSeconds = 0;
        clearInterval(timerInterval);
        // FASE 3B: Hide timer instead of showing 00:00:00
        if (typeof MLFlags !== 'undefined' && MLFlags.isEnabled('timer_fix')) {
          var stickyTimer = document.getElementById('sticky-timer');
          if (stickyTimer) stickyTimer.style.display = 'none';
          return;
        }
      }
      updateTimerDisplay();
    }, 1000);
  }

  function updateTimerDisplay() {
    var h = Math.floor(countdownSeconds / 3600);
    var m = Math.floor((countdownSeconds % 3600) / 60);
    var s = countdownSeconds % 60;

    var hEl = document.getElementById('timer-hours');
    var mEl = document.getElementById('timer-mins');
    var sEl = document.getElementById('timer-secs');

    if (hEl) hEl.textContent = pad(h);
    if (mEl) mEl.textContent = pad(m);
    if (sEl) sEl.textContent = pad(s);

    var stickyTimer = document.getElementById('sticky-timer');
    if (stickyTimer) {
      if (countdownSeconds <= 120) {
        stickyTimer.classList.add('urgent');
      } else {
        stickyTimer.classList.remove('urgent');
      }
    }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ═══════════════════════════════════════
     TOAST
     ═══════════════════════════════════════ */
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3000);
  }

  /* ═══════════════════════════════════════
     SOCIAL PROOF NOTIFICATIONS
     ═══════════════════════════════════════ */
  function initSocialProof() {
    var names = [
      {n:'Roberto',s:'MG'},{n:'Luciana',s:'SP'},{n:'Carlos',s:'RJ'},
      {n:'Fernanda',s:'BA'},{n:'Marcos',s:'PR'},{n:'Juliana',s:'RS'},
      {n:'Anderson',s:'PE'},{n:'Patrícia',s:'CE'},{n:'Ricardo',s:'GO'},
      {n:'Camila',s:'SC'},{n:'Thiago',s:'MA'},{n:'Bruna',s:'PA'},
      {n:'Lucas',s:'DF'},{n:'Aline',s:'ES'},{n:'Felipe',s:'MT'},
      {n:'Vanessa',s:'RN'},{n:'Diego',s:'PB'},{n:'Renata',s:'AL'}
    ];
    var actions = [
      'acabou de confirmar o pagamento',
      'finalizou a compra agora',
      'garantiu o desconto',
      'acabou de pagar via PIX'
    ];
    function hashIndex(str, mod) {
      var h = 0;
      for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      var idx = Math.abs(h) % mod;
      return idx;
    }

    function getInitials(name) {
      var parts = (name || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return '?';
      if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }

    function buildAvatarDataUrl(label) {
      var initials = getInitials(label);
      var palette = ['#3483fa', '#00a650', '#f23d4f', '#6c2bd9', '#ff7a00', '#0ea5e9', '#111827'];
      var bg = palette[hashIndex(label || 'user', palette.length)];
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">' +
          '<rect width="72" height="72" rx="36" fill="' + bg + '"/>' +
          '<text x="36" y="42" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">' +
            initials +
          '</text>' +
        '</svg>';
      return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }

    var container = document.createElement('div');
    container.className = 'social-proof';
    container.innerHTML =
      '<img src="" alt="" class="sp-photo">' +
      '<div class="sp-body">' +
        '<p class="sp-text"></p>' +
        '<span class="sp-time"></span>' +
      '</div>' +
      '<button class="sp-close" onclick="this.parentElement.classList.remove(\'show\')">&times;</button>';
    document.body.appendChild(container);

    function showNotification() {
      var person = names[Math.floor(Math.random() * names.length)];
      var action = actions[Math.floor(Math.random() * actions.length)];
      var mins = Math.floor(Math.random() * 8) + 1;

      var img = container.querySelector('.sp-photo');
      var text = container.querySelector('.sp-text');
      var time = container.querySelector('.sp-time');

      if (img) {
        img.src = buildAvatarDataUrl(person.n);
        img.alt = person.n;
      }
      if (text) text.innerHTML = '<b>' + person.n + '</b> de ' + person.s + ' ' + action;
      if (time) time.textContent = 'há ' + mins + ' min';

      container.classList.add('show');
      setTimeout(function() { container.classList.remove('show'); }, 5000);
    }

    // First notification after 8s, then every 25-45s
    setTimeout(function() {
      showNotification();
      setInterval(function() {
        showNotification();
      }, (25 + Math.floor(Math.random() * 20)) * 1000);
    }, 8000);
  }

  // Start social proof when DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initSocialProof, 3000);
  });

  /* ═══════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════ */
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════════════════════
     FAST CHECKOUT (Variante B) — Feature Flag: fast_checkout
     Single-page PIX flow: product card + 3 fields + PIX on same page.
     Controlled by feature flag. Zero backend changes.
     ═══════════════════════════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', function() {
    // Wait for flags to load, then decide
    if (typeof MLFlags === 'undefined') return;

    MLFlags.onReady(function(flags) {
      // IMPORTANT: fast_checkout must NOT fail-open. If flags didn't load
      // or the flag doesn't exist, default to normal checkout (control).
      var fcFlagEnabled = false;
      if (flags && flags.flags && flags.flags.fast_checkout) {
        fcFlagEnabled = flags.flags.fast_checkout.enabled === true;
      }

      if (!fcFlagEnabled) {
        // Flag is OFF — everyone gets control, no A/B split
        recordABMetric('fast_checkout', 'control', 'view');
        return;
      }

      // ── URL override for manual testing ──
      // ?fc=1 → force fast checkout  |  ?fc=0 → force normal
      var urlParams = new URLSearchParams(window.location.search);
      var fcOverride = urlParams.get('fc');

      var showFast = false;

      if (fcOverride === '1') {
        // Manual override: force fast checkout
        showFast = true;
      } else if (fcOverride === '0') {
        // Manual override: force normal checkout
        showFast = false;
      } else {
        // ── 50/50 split — persisted in localStorage ──
        var assignmentKey = 'ml_fc_variant';
        var saved = localStorage.getItem(assignmentKey);
        if (saved === 'fast' || saved === 'control') {
          showFast = (saved === 'fast');
        } else {
          // First visit: random 50/50 assignment
          showFast = Math.random() < 0.5;
          localStorage.setItem(assignmentKey, showFast ? 'fast' : 'control');
        }
      }

      if (!showFast) {
        // Control group (normal 4-step checkout)
        recordABMetric('fast_checkout', 'control', 'view');
        return;
      }

      // Fast checkout variant — take over the page
      if (Cart.getCount() === 0) return;

      recordABMetric('fast_checkout', 'fast', 'view');
      initFastCheckout();
    });
  });

  function recordABMetric(experiment, variant, event, extra) {
    try {
      // Local storage accumulator for persistence
      var key = 'ml_ab_metrics';
      var metrics = JSON.parse(localStorage.getItem(key) || '{}');
      var expKey = experiment + '_' + variant;
      if (!metrics[expKey]) metrics[expKey] = { views: 0, pix_generated: 0, purchases: 0 };
      if (event === 'view') metrics[expKey].views++;
      if (event === 'pix_generated') metrics[expKey].pix_generated++;
      if (event === 'purchase') metrics[expKey].purchases++;
      localStorage.setItem(key, JSON.stringify(metrics));

      // Fire-and-forget to server
      var payload = {
        experiment: experiment,
        variant: variant,
        event: event,
        ts: Date.now(),
        session_id: (typeof MLA !== 'undefined' && MLA.getSessionId) ? MLA.getSessionId() : '',
        extra: extra || null
      };
      fetch(apiUrl('ab-metrics.php'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function() {});
    } catch(e) {}
  }

  function initFastCheckout() {
    var items = Cart.getItems();
    var subtotal = Cart.getSubtotal();
    if ((!subtotal || subtotal <= 0) && items.length > 0) {
      subtotal = 0;
      for (var i = 0; i < items.length; i++) {
        subtotal += (parseInt(items[i].price) || 0) * (parseInt(items[i].quantity) || 1);
      }
    }

    var firstItem = items[0];
    var totalOld = 0;
    items.forEach(function(item) {
      var ip = parseInt(item.price) || 0;
      var iop = parseInt(item.oldPrice) || 0;
      totalOld += (iop > ip) ? iop * (item.quantity || 1) : ip * (item.quantity || 1);
    });
    var savings = Math.round(totalOld - subtotal);
    var discountPct = 95; // Fixed 95% OFF for all products

    // ── Inject CSS ──
    var style = document.createElement('style');
    style.textContent = '\
/* ══ FAST CHECKOUT v2 ══ */\n\
.fc-wrap{max-width:480px;margin:0 auto;padding:12px}\
/* ── Progress bar ── */\
.fc-progress{display:flex;align-items:center;gap:0;margin-bottom:14px;padding:0 4px}\
.fc-progress-step{display:flex;align-items:center;gap:6px;flex:1}\
.fc-progress-step .fc-p-num{width:24px;height:24px;border-radius:50%;background:#e0e0e0;color:#999;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .3s}\
.fc-progress-step .fc-p-label{font-size:11px;color:#999;font-weight:500;transition:color .3s}\
.fc-progress-step.active .fc-p-num{background:#3483fa;color:#fff}\
.fc-progress-step.active .fc-p-label{color:#3483fa;font-weight:600}\
.fc-progress-step.done .fc-p-num{background:#00a650;color:#fff}\
.fc-progress-step.done .fc-p-label{color:#00a650}\
.fc-progress-line{flex:0 0 auto;width:32px;height:2px;background:#e0e0e0;margin:0 2px;transition:background .3s}\
.fc-progress-line.active{background:#00a650}\
.fc-badge{background:linear-gradient(135deg,#d32f2f,#b71c1c);color:#fff;text-align:center;padding:10px 16px;border-radius:8px;margin-bottom:12px;font-size:13px;font-weight:600;animation:fc-pulse 2s infinite}\
@keyframes fc-pulse{0%,100%{box-shadow:0 0 0 0 rgba(211,47,47,.4)}50%{box-shadow:0 0 0 6px rgba(211,47,47,0)}}\
.fc-badge b{font-size:16px;font-weight:800}\
.fc-card{background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.08);margin-bottom:12px}\
.fc-prod-row{display:flex;gap:12px;align-items:center;margin-bottom:10px}\
.fc-prod-img{width:72px;height:72px;border-radius:6px;object-fit:contain;background:#f9f9f9;flex-shrink:0}\
.fc-prod-info{flex:1;min-width:0}\
.fc-prod-name{font-size:13px;color:#333;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:4px}\
.fc-old-price{font-size:12px;color:#999;text-decoration:line-through;margin-right:8px}\
.fc-new-price{font-size:22px;font-weight:700;color:#333}\
.fc-savings-tag{display:inline-flex;align-items:center;gap:4px;background:#e6f7ed;color:#00a650;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;margin-top:4px}\
/* ── Frete grátis line ── */\
.fc-frete-line{display:flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;color:#00a650;font-weight:600}\
.fc-frete-line svg{flex-shrink:0}\
.fc-field{margin-bottom:10px}\
.fc-field label{display:block;font-size:12px;font-weight:500;color:#666;margin-bottom:4px}\
.fc-field input{width:100%;padding:12px;border:1px solid #e6e6e6;border-radius:6px;font-size:14px;background:#fff;outline:none;transition:border .2s}\
.fc-field input:focus{border-color:#3483fa;box-shadow:0 0 0 3px rgba(52,131,250,.12)}\
.fc-field input.fc-err{border-color:#f23d4f}\
.fc-field .fc-err-msg{font-size:11px;color:#f23d4f;margin-top:3px;display:none}\
.fc-pay-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:18px;background:#00a650;color:#fff;border:none;border-radius:8px;font-size:18px;font-weight:700;cursor:pointer;margin:16px 0 8px;box-shadow:0 4px 12px rgba(0,166,80,.3);position:relative;overflow:hidden;letter-spacing:.3px;transition:all .2s}\
.fc-pay-btn::after{content:"";position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:fc-shine 3s infinite}\
@keyframes fc-shine{0%{left:-100%}50%,100%{left:100%}}\
.fc-pay-btn:active{transform:scale(.98);background:#008f45}\
.fc-pay-btn:disabled{opacity:.7;cursor:not-allowed}\
.fc-pay-btn:disabled::after{animation:none}\
/* ── Compra Garantida badge ── */\
.fc-garantia{display:flex;align-items:center;justify-content:center;gap:8px;background:#f0f9f4;border:1px solid #c8e6d5;border-radius:8px;padding:10px 14px;margin-bottom:8px}\
.fc-garantia svg{flex-shrink:0}\
.fc-garantia-txt{font-size:12px;color:#00a650;font-weight:600;line-height:1.3}\
.fc-garantia-txt span{display:block;font-size:11px;color:#888;font-weight:400}\
.fc-trust{display:flex;align-items:center;justify-content:center;gap:6px;font-size:11px;color:#999;padding:4px 0 8px}\
.fc-trust svg{opacity:.6}\
.fc-social{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#00a650;font-weight:500;margin-bottom:8px}\
.fc-divider{border:none;border-top:1px solid #e6e6e6;margin:12px 0}\
/* ── PIX phase ── */\
.fc-pix-phase{display:none}\
.fc-pix-phase.active{display:block}\
.fc-form-phase.hidden{display:none}\
.fc-copy-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:18px 16px;background:#00a650;color:#fff;border:none;border-radius:8px;font-size:18px;font-weight:700;cursor:pointer;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,166,80,.3);position:relative;overflow:hidden}\
.fc-copy-btn::after{content:"";position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:fc-shine 3s infinite}\
.fc-copy-btn:active{transform:scale(.98);background:#008f45}\
.fc-copy-btn.copied{background:#1b5e20}\
.fc-copy-btn.copied::after{animation:none}\
.fc-loss{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#f23d4f;text-align:center;padding:4px 0 12px}\
.fc-steps{background:#fff;border-radius:8px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.08);margin-bottom:12px}\
.fc-steps h4{font-size:14px;font-weight:600;margin-bottom:10px}\
.fc-step{display:flex;align-items:center;gap:10px;margin-bottom:8px}\
.fc-step:last-child{margin-bottom:0}\
.fc-step-n{width:26px;height:26px;border-radius:50%;background:#3483fa;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}\
.fc-step span{font-size:13px;color:#666}\
.fc-code-sec{margin-bottom:12px}\
.fc-code-sec label{display:block;font-size:12px;font-weight:600;color:#999;margin-bottom:6px}\
.fc-code-row{display:flex;gap:0;border-radius:6px;overflow:hidden;border:1px solid #e6e6e6}\
.fc-code-row input{flex:1;border:none;padding:10px 12px;font-size:11px;color:#666;background:#f5f5f5;outline:none;font-family:monospace;min-width:0}\
.fc-code-copy{background:#3483fa;color:#fff;border:none;padding:10px 14px;cursor:pointer;display:flex;align-items:center;flex-shrink:0}\
.fc-code-copy:active{background:#2968c8}\
.fc-poll{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;font-size:13px;color:#999}\
.fc-poll-dot{width:8px;height:8px;border-radius:50%;background:#3483fa;animation:fc-pdot 1.5s infinite}\
@keyframes fc-pdot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}\
.fc-poll.confirmed .fc-poll-dot{background:#00a650;animation:none}\
.fc-check-btn{display:block;width:100%;text-align:center;background:none;border:none;color:#3483fa;font-size:14px;font-weight:600;cursor:pointer;padding:10px;margin-top:4px}\
/* ── Suporte link ── */\
.fc-help{display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#3483fa;text-decoration:none;padding:8px 0;margin-top:4px}\
.fc-help:active{opacity:.7}\
.fc-confirmed{padding:30px 0;text-align:center;display:none}\
.fc-confirmed.active{display:block}\
.fc-confirmed svg{animation:fc-pop .5s ease}\
@keyframes fc-pop{0%{transform:scale(0);opacity:0}50%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}\
.fc-confirmed h3{font-size:20px;font-weight:700;color:#00a650;margin:12px 0 4px}\
.fc-confirmed p{font-size:14px;color:#999}\
.fc-countdown{font-size:14px;font-weight:600;color:#fff}\
.fc-countdown b{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.5px}\
.fc-qr-toggle{background:#fff;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,.08);margin-bottom:12px;overflow:hidden}\
.fc-qr-toggle summary{padding:12px 16px;font-size:13px;font-weight:500;color:#3483fa;cursor:pointer;list-style:none;text-align:center}\
.fc-qr-toggle summary::-webkit-details-marker{display:none}\
.fc-qr-area{display:flex;justify-content:center;padding:0 16px 16px}\
/* ── Layer 1: Envio badge ── */\
.fc-envio-badge{display:flex;align-items:center;gap:8px;background:#f0f9ff;border:1px solid #d0e8ff;border-radius:8px;padding:10px 14px;margin-bottom:12px}\
.fc-envio-badge .fc-envio-icon{font-size:18px;flex-shrink:0}\
.fc-envio-badge .fc-envio-txt{font-size:12.5px;color:#333;line-height:1.4}\
.fc-envio-badge .fc-envio-txt b{color:#00a650;font-weight:700}\
.fc-envio-badge .fc-envio-txt span{color:#666;font-size:11.5px}\
/* ── Layer 2: Address during PIX ── */\
.fc-addr{background:#fff;border-radius:8px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.08);margin-bottom:12px;border:1px dashed #d0e8ff}\
.fc-addr-hdr{display:flex;align-items:center;gap:8px;margin-bottom:10px}\
.fc-addr-hdr .fc-addr-icon{font-size:18px}\
.fc-addr-hdr h4{font-size:14px;font-weight:600;color:#333;margin:0}\
.fc-addr-hdr p{font-size:11px;color:#999;margin:0}\
.fc-addr-sub{font-size:11.5px;color:#888;margin-bottom:10px;line-height:1.4}\
.fc-addr .fc-field{margin-bottom:8px}\
.fc-addr .fc-field label{display:block;font-size:12px;font-weight:500;color:#666;margin-bottom:3px}\
.fc-addr .fc-field input{width:100%;padding:10px 12px;border:1px solid #e6e6e6;border-radius:6px;font-size:14px;background:#fff;outline:none;transition:border .2s}\
.fc-addr .fc-field input:focus{border-color:#3483fa;box-shadow:0 0 0 3px rgba(52,131,250,.12)}\
.fc-addr-cep-row{display:flex;gap:8px}\
.fc-addr-cep-row input{flex:1}\
.fc-addr-cep-row button{padding:10px 16px;background:#3483fa;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0}\
.fc-addr-cep-row button:active{background:#2968c8}\
.fc-addr-cep-row button:disabled{opacity:.6;cursor:not-allowed}\
.fc-addr-result{font-size:12px;color:#00a650;padding:4px 0 2px;display:none}\
.fc-addr-result.error{color:#f23d4f}\
.fc-addr-row2{display:flex;gap:8px}\
.fc-addr-row2 .fc-field{flex:1}\
.fc-addr-row2 .fc-field:first-child{flex:0 0 40%}\
.fc-addr-saved{display:none;align-items:center;gap:6px;font-size:12px;color:#00a650;font-weight:500;padding:6px 0 0}\
.fc-addr-saved svg{flex-shrink:0}\
.fc-addr-manual{margin-bottom:8px}\
.fc-addr-manual .fc-addr-row2{display:flex;gap:8px;margin-top:8px}\
.fc-addr-manual .fc-addr-row2 .fc-field{flex:1}\
';
    document.head.appendChild(style);

    // ── Hide all normal checkout UI ──
    var stepper = document.querySelector('.ml-stepper');
    var mainEl = document.querySelector('.ml-main');
    var stickyTimer = document.getElementById('sticky-timer');

    if (stepper) stepper.style.display = 'none';
    if (stickyTimer) stickyTimer.style.display = 'none';

    // Replace main content
    if (!mainEl) return;

    var productName = firstItem ? firstItem.name : 'Produto';
    if (items.length > 1) productName += ' + ' + (items.length - 1) + ' item(s)';
    var productImg = firstItem ? (firstItem.image || '') : '';

    var savingsHtml = '';
    if (savings >= 100 && discountPct > 0) {
      savingsHtml = '<div class="fc-savings-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="#00a650"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Economia de ' + formatPrice(savings) + '</div>';
    }

    var oldPriceHtml = '';
    if (savings >= 100) {
      oldPriceHtml = '<span class="fc-old-price">' + formatPrice(totalOld) + '</span>';
    }

    var socialCount = 30 + Math.floor(Math.random() * 40);

    mainEl.innerHTML = '\
<div class="fc-wrap">\
  <!-- PROGRESS BAR -->\
  <div class="fc-progress" id="fc-progress">\
    <div class="fc-progress-step active" id="fc-p1">\
      <div class="fc-p-num">1</div>\
      <div class="fc-p-label">Dados</div>\
    </div>\
    <div class="fc-progress-line" id="fc-pline1"></div>\
    <div class="fc-progress-step" id="fc-p2">\
      <div class="fc-p-num">2</div>\
      <div class="fc-p-label">Pagamento</div>\
    </div>\
  </div>\
  <!-- FORM PHASE -->\
  <div class="fc-form-phase" id="fc-form">\
    <div class="fc-badge">\
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>\
      Últimas unidades com <b>' + discountPct + '% OFF</b> — oferta encerra em breve\
    </div>\
    <div class="fc-card">\
      <div class="fc-prod-row">\
        <img src="' + escapeHtml(productImg) + '" alt="" class="fc-prod-img">\
        <div class="fc-prod-info">\
          <div class="fc-prod-name">' + escapeHtml(productName) + '</div>\
          <div>' + oldPriceHtml + '<span class="fc-new-price">' + formatPrice(subtotal) + '</span></div>\
          ' + savingsHtml + '\
          <div class="fc-frete-line">\
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#00a650"><path d="M18 18.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm1.5-9H17V12h4.46L19.5 9.5zM6 18.5c.83 0 1.5-.67 1.5-1.5s-.67-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zM20 8l3 4v5h-2c0 1.66-1.34 3-3 3s-3-1.34-3-3H9c0 1.66-1.34 3-3 3s-3-1.34-3-3H1V6c0-1.11.89-2 2-2h14v4h3z"/></svg>\
            <span>Frete grátis</span> <span style="color:#999;font-weight:400;font-size:11px">· Chega em 3-7 dias</span>\
          </div>\
        </div>\
      </div>\
      <hr class="fc-divider">\
      <div class="fc-field">\
        <label for="fc-nome">Nome completo</label>\
        <input type="text" id="fc-nome" placeholder="Como aparece no documento" autocomplete="name">\
        <div class="fc-err-msg" id="fc-nome-err"></div>\
      </div>\
      <div class="fc-field">\
        <label for="fc-cpf">CPF</label>\
        <input type="text" id="fc-cpf" placeholder="000.000.000-00" inputmode="numeric" maxlength="14">\
        <div class="fc-err-msg" id="fc-cpf-err"></div>\
      </div>\
      <div class="fc-field">\
        <label for="fc-email">E-mail</label>\
        <input type="email" id="fc-email" placeholder="seuemail@exemplo.com" autocomplete="email">\
        <div class="fc-err-msg" id="fc-email-err"></div>\
      </div>\
    </div>\
    <div class="fc-envio-badge">\
      <span class="fc-envio-icon">📦</span>\
      <div class="fc-envio-txt"><b>Envio Full</b> · <span>Endereço de entrega na próxima etapa</span></div>\
    </div>\
    <button class="fc-pay-btn" id="fc-pay-btn" type="button">\
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>\
      <span>PAGAR COM PIX — ' + formatPrice(subtotal) + '</span>\
    </button>\
    <div class="fc-garantia">\
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="#00a650"/><path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z" fill="#fff"/></svg>\
      <div class="fc-garantia-txt">Compra Garantida<span>Receba o produto ou devolvemos seu dinheiro</span></div>\
    </div>\
    <div class="fc-trust">\
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#999"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>\
      <span>Pagamento 100% seguro · Dados criptografados</span>\
    </div>\
    <div class="fc-social">\
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#00a650"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>\
      <span>' + socialCount + ' pessoas compraram nas últimas 2 horas</span>\
    </div>\
  </div>\
  <!-- PIX PHASE -->\
  <div class="fc-pix-phase" id="fc-pix">\
    <div class="fc-badge fc-countdown" id="fc-timer">\
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>\
      Seu desconto expira em <b id="fc-countdown">15:00</b>\
    </div>\
    <div class="fc-card">\
      <div class="fc-prod-row">\
        <img src="' + escapeHtml(productImg) + '" alt="" class="fc-prod-img">\
        <div class="fc-prod-info">\
          <div class="fc-prod-name">' + escapeHtml(productName) + '</div>\
          <div>' + oldPriceHtml + '<span class="fc-new-price">' + formatPrice(subtotal) + '</span></div>\
        </div>\
      </div>\
    </div>\
    <button class="fc-copy-btn" id="fc-copy-btn" type="button">\
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>\
      <span>COPIAR CÓDIGO PIX</span>\
    </button>\
    <div class="fc-loss">\
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#f23d4f"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>\
      <span>Seu desconto será <b>perdido</b> se não pagar a tempo</span>\
    </div>\
    <button class="pix-whatsapp-btn" id="fc-whatsapp-btn" type="button" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px 16px;background:#25D366;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:12px">\
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.611.611l4.458-1.495A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.4 0-4.625-.839-6.363-2.239l-.446-.362-2.972.996.996-2.972-.362-.446A9.935 9.935 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>\
      <span>Enviar código por WhatsApp</span>\
    </button>\
    <div class="fc-steps">\
      <h4>Como pagar (é fácil!):</h4>\
      <div class="fc-step"><div class="fc-step-n">1</div><div><strong style="font-size:14px;display:block;color:#333">Aperte o botão verde acima</strong><span style="font-size:11px;color:#999">O código será copiado automaticamente</span></div></div>\
      <div class="fc-step"><div class="fc-step-n">2</div><div><strong style="font-size:14px;display:block;color:#333">Abra o app do seu banco</strong><span style="font-size:11px;color:#999">Itaú, Bradesco, Nubank, Caixa, BB, Santander...</span></div></div>\
      <div class="fc-step"><div class="fc-step-n">3</div><div><strong style="font-size:14px;display:block;color:#333">Procure "Pix" e depois "Pix Copia e Cola"</strong><span style="font-size:11px;color:#999">Também pode aparecer como "Pagar com Pix"</span></div></div>\
      <div class="fc-step"><div class="fc-step-n">4</div><div><strong style="font-size:14px;display:block;color:#333">Cole o código e confirme com sua senha</strong><span style="font-size:11px;color:#999">Segure o dedo no campo e toque em "Colar"</span></div></div>\
    </div>\
    <div class="fc-addr" id="fc-addr">\
      <div class="fc-addr-hdr">\
        <span class="fc-addr-icon">📦</span>\
        <div><h4>Agilize sua entrega</h4><p>Opcional · Informe o CEP para envio imediato após confirmação</p></div>\
      </div>\
      <div class="fc-field">\
        <label for="fc-cep">CEP</label>\
        <div class="fc-addr-cep-row">\
          <input type="text" id="fc-cep" placeholder="00000-000" inputmode="numeric" maxlength="9">\
          <button type="button" id="fc-cep-btn">Buscar</button>\
        </div>\
        <div class="fc-addr-result" id="fc-addr-result"></div>\
      </div>\
      <div class="fc-addr-manual" id="fc-addr-manual" style="display:none">\
        <div class="fc-field">\
          <label for="fc-rua">Rua</label>\
          <input type="text" id="fc-rua" placeholder="Nome da rua">\
        </div>\
        <div class="fc-addr-row2">\
          <div class="fc-field">\
            <label for="fc-bairro">Bairro</label>\
            <input type="text" id="fc-bairro" placeholder="Bairro">\
          </div>\
          <div class="fc-field">\
            <label for="fc-cidade-manual">Cidade</label>\
            <input type="text" id="fc-cidade-manual" placeholder="Cidade">\
          </div>\
        </div>\
        <div class="fc-field" style="max-width:80px">\
          <label for="fc-uf-manual">UF</label>\
          <input type="text" id="fc-uf-manual" placeholder="SP" maxlength="2" style="text-transform:uppercase">\
        </div>\
      </div>\
      <div class="fc-addr-row2" id="fc-addr-row2" style="display:none">\
        <div class="fc-field">\
          <label for="fc-numero">Número</label>\
          <input type="text" id="fc-numero" placeholder="Nº" inputmode="numeric">\
        </div>\
        <div class="fc-field">\
          <label for="fc-complemento">Complemento</label>\
          <input type="text" id="fc-complemento" placeholder="Apto, bloco...">\
        </div>\
      </div>\
      <div class="fc-addr-saved" id="fc-addr-saved">\
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#00a650"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>\
        <span>Endereço salvo — envio será agilizado!</span>\
      </div>\
    </div>\
    <div class="fc-code-sec">\
      <label>Código PIX Copia e Cola:</label>\
      <div class="fc-code-row">\
        <input type="text" id="fc-pix-code" readonly value="">\
        <button class="fc-code-copy" id="fc-code-copy-sm" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>\
      </div>\
    </div>\
    <div class="fc-poll" id="fc-poll">\
      <div class="fc-poll-dot"></div>\
      <span>Aguardando pagamento...</span>\
    </div>\
    <button class="fc-check-btn" id="fc-check-btn" type="button">Já paguei - Verificar</button>\
    <div style="background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.08);margin-bottom:12px;text-align:center">\
      <div style="font-size:14px;color:#666;margin-bottom:10px;font-weight:500">QR Code — peça para alguém escanear de outro celular:</div>\
      <div class="fc-qr-area" id="fc-qr-code" style="display:flex;justify-content:center"></div>\
    </div>\
    <div class="fc-garantia" style="margin-top:4px">\
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="#00a650"/><path d="M10 15.5l-3.5-3.5 1.41-1.41L10 12.67l5.59-5.59L17 8.5l-7 7z" fill="#fff"/></svg>\
      <div class="fc-garantia-txt">Compra Garantida<span>Receba o produto ou devolvemos seu dinheiro</span></div>\
    </div>\
    <a class="fc-help" href="#" id="fc-help-link">\
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#3483fa"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>\
      <span>Dúvidas? Fale com nosso suporte</span>\
    </a>\
  </div>\
  <!-- CONFIRMED -->\
  <div class="fc-confirmed" id="fc-confirmed">\
    <svg width="56" height="56" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#00a650"/></svg>\
    <h3>Pagamento aprovado!</h3>\
    <p>Redirecionando...</p>\
  </div>\
</div>\
<footer class="ml-footer"><div class="ml-footer-inner"><span>Mercado Livre &copy; 2026</span><span class="ml-footer-sep">&middot;</span><span>Pagamento seguro</span></div></footer>\
';

    // ── Input masks ──
    var fcCpf = document.getElementById('fc-cpf');
    if (fcCpf) {
      fcCpf.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 11);
        if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        else if (v.length > 3) v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        this.value = v;
      });
    }

    // ── Prefill from localStorage ──
    try {
      var saved = JSON.parse(localStorage.getItem('ml_customer_data') || '{}');
      if (saved.name) document.getElementById('fc-nome').value = saved.name;
      if (saved.document) document.getElementById('fc-cpf').value = saved.document;
      if (saved.email) document.getElementById('fc-email').value = saved.email;
    } catch(e) {}

    // ── PAY button ──
    var fcPayBtn = document.getElementById('fc-pay-btn');
    var fcGenerating = false;

    fcPayBtn.addEventListener('click', function() {
      if (fcGenerating) return;

      // Validate
      var nome = document.getElementById('fc-nome').value.trim();
      var cpf = document.getElementById('fc-cpf').value.trim();
      var email = document.getElementById('fc-email').value.trim();

      // Clear errors
      ['fc-nome', 'fc-cpf', 'fc-email'].forEach(function(id) {
        document.getElementById(id).classList.remove('fc-err');
        var errEl = document.getElementById(id + '-err');
        if (errEl) errEl.style.display = 'none';
      });

      var hasError = false;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        document.getElementById('fc-email').classList.add('fc-err');
        var e = document.getElementById('fc-email-err');
        if (e) { e.textContent = 'Informe um e-mail válido'; e.style.display = 'block'; }
        hasError = true;
      }
      if (!nome || nome.length < 3) {
        document.getElementById('fc-nome').classList.add('fc-err');
        var e = document.getElementById('fc-nome-err');
        if (e) { e.textContent = 'Informe seu nome completo'; e.style.display = 'block'; }
        hasError = true;
      }
      if (hasError) return;

      // Save customer data
      localStorage.setItem('ml_customer_data', JSON.stringify({
        email: email,
        name: nome,
        document: cpf,
        phone: ''
      }));

      fcGenerating = true;
      fcPayBtn.disabled = true;
      fcPayBtn.querySelector('span').textContent = 'Gerando PIX...';

      // ── Build payload (same format as normal checkout) ──
      var utms = {};
      try { utms = JSON.parse(localStorage.getItem('ml_utms') || '{}'); } catch(e) {}
      var fbp = localStorage.getItem('ml_fbp') || null;
      var fbc = localStorage.getItem('ml_fbc') || null;
      var ttclid = localStorage.getItem('ml_ttclid') || null;
      var sessionId = (typeof MLA !== 'undefined' && MLA.getSessionId) ? MLA.getSessionId() : '';

      var payload = {
        customer: {
          email: email,
          name: nome,
          document: cpf,
          phone: ''
        },
        amount: subtotal,
        items: items.map(function(item) {
          return { id: item.id, name: item.name, price: item.price, quantity: item.quantity };
        }),
        trackingParameters: (function() {
          var tp = {};
          for (var k in utms) { if (utms.hasOwnProperty(k)) tp[k] = utms[k]; }
          tp.fbp = fbp; tp.fbc = fbc; tp.ttclid = ttclid;
          return tp;
        })(),
        metadata: {
          frete: 0,
          frete_type: 'gratis',
          cep: '',
          cidade: '',
          uf: '',
          bairro: '',
          session_id: sessionId,
          experiment_id: 'fast_checkout',
          variant_id: 'fast'
        }
      };

      var req = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      };

      fetchJson(apiUrl('payment.php'), req)
      .then(function(data) {
        if (!data.success || !data.pix_qrcode_text) {
          throw new Error(data.error || 'Erro ao gerar PIX');
        }

        paymentCode = data.payment_code;

        // Affiliate flag
        if (data.affiliate) {
          localStorage.setItem('ml_affiliate', '1');
        }

        // Cache for idempotency
        try {
          sessionStorage.setItem('ml_pending_pix', JSON.stringify({
            payment_code: data.payment_code,
            pix_qrcode_text: data.pix_qrcode_text,
            amount: subtotal,
            created_at: Date.now()
          }));
        } catch(e) {}

        // Record metric
        recordABMetric('fast_checkout', 'fast', 'pix_generated', { amount: subtotal });

        // ── Show PIX phase ──
        document.getElementById('fc-form').classList.add('hidden');
        var pixPhase = document.getElementById('fc-pix');
        pixPhase.classList.add('active');

        // Update progress bar: step 1 done, step 2 active
        var p1 = document.getElementById('fc-p1');
        var p2 = document.getElementById('fc-p2');
        var pline = document.getElementById('fc-pline1');
        if (p1) { p1.classList.remove('active'); p1.classList.add('done'); p1.querySelector('.fc-p-num').textContent = '\u2713'; }
        if (pline) pline.classList.add('active');
        if (p2) p2.classList.add('active');

        // Set code
        document.getElementById('fc-pix-code').value = data.pix_qrcode_text;

        // Auto-copy PIX code (reduces 1 click of friction)
        try {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(data.pix_qrcode_text).then(function() {
              showToast('Código PIX copiado automaticamente! Cole no app do seu banco.');
              var copyBtn = document.getElementById('fc-copy-btn');
              if (copyBtn) {
                copyBtn.classList.add('copied');
                copyBtn.querySelector('span').textContent = '\u2713 CÓDIGO COPIADO!';
                setTimeout(function() {
                  copyBtn.classList.remove('copied');
                  copyBtn.querySelector('span').textContent = 'COPIAR CÓDIGO PIX';
                }, 5000);
              }
            });
          }
        } catch(e) {}

        // QR code
        var qrContainer = document.getElementById('fc-qr-code');
        if (qrContainer && typeof qrcode !== 'undefined') {
          var qr = qrcode(0, 'M');
          qr.addData(data.pix_qrcode_text);
          qr.make();
          qrContainer.innerHTML = qr.createImgTag(4, 8);
        }

        // Start countdown
        var fcCountdown = 900; // 15 minutes — more time reduces abandonment
        var countEl = document.getElementById('fc-countdown');
        var fcTimer = setInterval(function() {
          fcCountdown--;
          if (fcCountdown <= 0) { clearInterval(fcTimer); countEl.textContent = '00:00'; return; }
          var m = Math.floor(fcCountdown / 60);
          var s = fcCountdown % 60;
          countEl.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
        }, 1000);

        // Start polling
        var fcAttempts = 0;
        var fcPollInterval = setInterval(function() {
          fcAttempts++;
          if (fcAttempts > 200) { clearInterval(fcPollInterval); return; }
          fcCheckPayment(fcPollInterval, fcTimer);
        }, 2000);

        // Copy button
        document.getElementById('fc-copy-btn').addEventListener('click', function() {
          fcCopyCode(data.pix_qrcode_text);
        });
        document.getElementById('fc-code-copy-sm').addEventListener('click', function() {
          fcCopyCode(data.pix_qrcode_text);
        });

        // Manual check
        document.getElementById('fc-check-btn').addEventListener('click', function() {
          var pollEl = document.getElementById('fc-poll');
          pollEl.querySelector('span').textContent = 'Verificando...';
          fcCheckPayment(fcPollInterval, fcTimer);
          setTimeout(function() {
            if (pollEl.className.indexOf('confirmed') === -1) {
              pollEl.querySelector('span').textContent = 'Aguardando pagamento...';
            }
          }, 2000);
        });

        // WhatsApp share
        var fcWhatsBtn = document.getElementById('fc-whatsapp-btn');
        if (fcWhatsBtn) {
          fcWhatsBtn.addEventListener('click', function() {
            var code = document.getElementById('fc-pix-code').value;
            if (!code) return;
            var text = 'Meu código PIX para pagamento:\n\n' + code + '\n\nCopie o código acima e cole no app do seu banco em Pix Copia e Cola.';
            window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
          });
        }

        // Help link — opens FAQ-style toast (no real link needed, just reassurance)
        var helpLink = document.getElementById('fc-help-link');
        if (helpLink) {
          helpLink.addEventListener('click', function(e) {
            e.preventDefault();
            showToast('Pagamento PIX é processado em até 5 minutos. Se precisar de ajuda, entre em contato pelo e-mail contato@mercadolivre.com.br');
          });
        }

        // Pixel events (suppress for affiliate)
        if (!localStorage.getItem('ml_affiliate')) {
          if (typeof MLA !== 'undefined') {
            MLA.trackGeneratePixCode(paymentCode, subtotal, items);
          } else {
            if (typeof fbq === 'function') {
              fbq('track', 'InitiateCheckout', { value: subtotal / 100, currency: 'BRL', num_items: Cart.getCount() });
            }
            if (typeof ttq !== 'undefined') {
              ttq.track('InitiateCheckout', { content_type: 'product', value: subtotal / 100, currency: 'BRL' });
            }
          }
        }
      })
      .catch(function(err) {
        fcGenerating = false;
        fcPayBtn.disabled = false;
        fcPayBtn.querySelector('span').textContent = 'PAGAR COM PIX — ' + formatPrice(subtotal);
        var msg = 'Erro ao gerar PIX. Tente novamente.';
        if (err && err._data && err._data.error) msg = err._data.error;
        else if (err && err.message && err.message !== 'invalid_json' && err.message !== 'http_error') msg = err.message;
        showToast(msg);
        console.error('Fast Checkout PIX Error:', err);
      });
    });

    // ── Layer 2: Address collection during PIX dead time ──
    (function() {
      var cepInput = document.getElementById('fc-cep');
      var cepBtn = document.getElementById('fc-cep-btn');
      var resultEl = document.getElementById('fc-addr-result');
      var row2 = document.getElementById('fc-addr-row2');
      var manualEl = document.getElementById('fc-addr-manual');
      var savedEl = document.getElementById('fc-addr-saved');
      if (!cepInput || !cepBtn) return;

      // CEP mask: 00000-000
      cepInput.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 8);
        if (v.length > 5) v = v.replace(/(\d{5})(\d{1,3})/, '$1-$2');
        this.value = v;
      });

      // Auto-trigger on 8 digits
      cepInput.addEventListener('input', function() {
        var raw = this.value.replace(/\D/g, '');
        if (raw.length === 8) fcLookupCep();
      });

      cepBtn.addEventListener('click', fcLookupCep);

      function fcLookupCep() {
        var raw = cepInput.value.replace(/\D/g, '');
        if (raw.length !== 8) {
          resultEl.textContent = 'CEP deve ter 8 dígitos';
          resultEl.className = 'fc-addr-result error';
          resultEl.style.display = 'block';
          return;
        }
        cepBtn.disabled = true;
        cepBtn.textContent = '...';
        resultEl.style.display = 'none';

        fetch(apiUrl('cep.php') + '?cep=' + raw)
          .then(function(r) { return r.json(); })
          .then(function(data) {
            cepBtn.disabled = false;
            cepBtn.textContent = 'Buscar';
            if (data.erro || !data.localidade) {
              // CEP not found — show manual fields for user to fill
              resultEl.textContent = 'CEP não encontrado — preencha manualmente';
              resultEl.className = 'fc-addr-result error';
              resultEl.style.display = 'block';
              manualEl.style.display = 'block';
              row2.style.display = 'flex';
              return;
            }
            var parts = [];
            if (data.logradouro) parts.push(data.logradouro);
            if (data.bairro) parts.push(data.bairro);
            parts.push(data.localidade + '/' + data.uf);
            resultEl.textContent = parts.join(' — ');
            resultEl.className = 'fc-addr-result';
            resultEl.style.display = 'block';
            // Hide manual fields (API found everything)
            manualEl.style.display = 'none';
            row2.style.display = 'flex';

            // Pre-fill manual fields in case user switches
            if (data.logradouro) document.getElementById('fc-rua').value = data.logradouro;
            if (data.bairro) document.getElementById('fc-bairro').value = data.bairro;
            if (data.localidade) document.getElementById('fc-cidade-manual').value = data.localidade;
            if (data.uf) document.getElementById('fc-uf-manual').value = data.uf;

            // Save partial address
            fcSaveAddr({
              cep: raw,
              logradouro: data.logradouro || '',
              bairro: data.bairro || '',
              cidade: data.localidade || '',
              uf: data.uf || ''
            });
          })
          .catch(function() {
            cepBtn.disabled = false;
            cepBtn.textContent = 'Buscar';
            resultEl.textContent = 'Erro ao buscar CEP — preencha manualmente';
            resultEl.className = 'fc-addr-result error';
            resultEl.style.display = 'block';
            manualEl.style.display = 'block';
            row2.style.display = 'flex';
          });
      }

      // Save on field blur (numero, complemento, manual fields)
      var numInput = document.getElementById('fc-numero');
      var compInput = document.getElementById('fc-complemento');
      if (numInput) numInput.addEventListener('blur', function() { fcSaveAddr({}); });
      if (compInput) compInput.addEventListener('blur', function() { fcSaveAddr({}); });
      ['fc-rua', 'fc-bairro', 'fc-cidade-manual', 'fc-uf-manual'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('blur', function() { fcSaveAddr({}); });
      });

      function fcSaveAddr(viaCepData) {
        try {
          var existing = JSON.parse(localStorage.getItem('ml_customer_data') || '{}');
          if (viaCepData.cep) {
            existing.cep = viaCepData.cep;
            existing.logradouro = viaCepData.logradouro;
            existing.bairro = viaCepData.bairro;
            existing.cidade = viaCepData.cidade;
            existing.uf = viaCepData.uf;
          }
          // Override with manual fields if filled (fallback scenario)
          var ruaEl = document.getElementById('fc-rua');
          var bairroEl = document.getElementById('fc-bairro');
          var cidadeEl = document.getElementById('fc-cidade-manual');
          var ufEl = document.getElementById('fc-uf-manual');
          if (ruaEl && ruaEl.value.trim()) existing.logradouro = ruaEl.value.trim();
          if (bairroEl && bairroEl.value.trim()) existing.bairro = bairroEl.value.trim();
          if (cidadeEl && cidadeEl.value.trim()) existing.cidade = cidadeEl.value.trim();
          if (ufEl && ufEl.value.trim()) existing.uf = ufEl.value.trim().toUpperCase();
          // CEP from input if not from API
          if (!existing.cep) {
            var cepRaw = (document.getElementById('fc-cep').value || '').replace(/\D/g, '');
            if (cepRaw.length === 8) existing.cep = cepRaw;
          }
          var num = document.getElementById('fc-numero');
          var comp = document.getElementById('fc-complemento');
          if (num && num.value.trim()) existing.numero = num.value.trim();
          if (comp && comp.value.trim()) existing.complemento = comp.value.trim();
          localStorage.setItem('ml_customer_data', JSON.stringify(existing));

          // Show saved confirmation if we have cep
          if (existing.cep && savedEl) {
            savedEl.style.display = 'flex';
          }
        } catch(e) {}
      }

      // Prefill if already saved
      try {
        var saved = JSON.parse(localStorage.getItem('ml_customer_data') || '{}');
        if (saved.cep) {
          cepInput.value = saved.cep.replace(/(\d{5})(\d{3})/, '$1-$2');
          // Auto-lookup to show address
          fcLookupCep();
          if (saved.numero) document.getElementById('fc-numero').value = saved.numero;
          if (saved.complemento) document.getElementById('fc-complemento').value = saved.complemento;
        }
      } catch(e) {}
    })();

    // ── Helper: copy ──
    function fcCopyCode(code) {
      var copyBtn = document.getElementById('fc-copy-btn');
      var done = function() {
        copyBtn.classList.add('copied');
        copyBtn.querySelector('span').textContent = '\u2713 CÓDIGO COPIADO!';
        setTimeout(function() {
          copyBtn.classList.remove('copied');
          copyBtn.querySelector('span').textContent = 'COPIAR CÓDIGO PIX';
        }, 4000);
        showToast('Código PIX copiado! Cole no app do seu banco.');
        if (typeof MLA !== 'undefined') MLA.trackCopyPixCode(paymentCode);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(done);
      } else {
        var input = document.getElementById('fc-pix-code');
        input.select();
        document.execCommand('copy');
        done();
      }
    }

    // ── Helper: check payment ──
    function fcCheckPayment(pollInterval, timerInterval) {
      if (!paymentCode) return;
      var pollUrl = apiUrl('check-payment.php') + '?code=' + encodeURIComponent(paymentCode);
      if (localStorage.getItem('ml_affiliate')) pollUrl += '&aff=1';

      fetch(pollUrl)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.status === 'paid') {
            if (pollInterval) clearInterval(pollInterval);
            if (timerInterval) clearInterval(timerInterval);

            var pollEl = document.getElementById('fc-poll');
            if (pollEl) { pollEl.classList.add('confirmed'); pollEl.querySelector('span').textContent = 'Pagamento confirmado!'; }

            // Record metric
            recordABMetric('fast_checkout', 'fast', 'purchase', { amount: subtotal });

            // Purchase pixel (suppress for affiliate)
            if (!localStorage.getItem('ml_affiliate')) {
              if (typeof MLA !== 'undefined') {
                var eid = MLA.trackPurchase(paymentCode, subtotal, items);
                try { localStorage.setItem('ml_purchase_event_id', eid); } catch(e) {}
              } else {
                var eid2 = 'pur_' + paymentCode + '_' + Date.now();
                try { localStorage.setItem('ml_purchase_event_id', eid2); } catch(e) {}
                if (typeof fbq === 'function') {
                  fbq('track', 'Purchase', { value: subtotal / 100, currency: 'BRL', order_id: paymentCode }, { eventID: eid2 });
                }
                if (typeof ttq !== 'undefined') {
                  ttq.track('CompletePayment', { value: subtotal / 100, currency: 'BRL' });
                }
              }
            }

            // Show confirmed
            document.getElementById('fc-pix').classList.remove('active');
            document.getElementById('fc-confirmed').classList.add('active');

            // Clear cache
            try { sessionStorage.removeItem('ml_pending_pix'); } catch(e) {}

            var savedItems = Cart.getItems();
            Cart.clear();

            setTimeout(function() {
              if (savedItems.length === 1) {
                window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/index.html') + '?produto=' + encodeURIComponent(savedItems[0].id);
              } else if (savedItems.length >= 2) {
                var sorted = savedItems.slice().sort(function(a, b) { return b.price - a.price; });
                window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/carrinho.html') + '?esgotou=' + encodeURIComponent(sorted[0].id) + '&ok=' + encodeURIComponent(sorted[1].id);
              } else {
                window.location.href = resolveUrl('https://promo-ml-25anos.shop/esgotou/index.html');
              }
            }, 2000);
          }
        })
        .catch(function() {});
    }

    // ── Track AddPaymentInfo on load (same as step 4) ──
    if (typeof MLA !== 'undefined') {
      MLA.trackAddPaymentInfo(items, subtotal);
    }
  }

})();

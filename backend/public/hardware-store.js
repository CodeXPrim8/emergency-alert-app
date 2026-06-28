/**
 * Portable hardware mini-store widget.
 *
 * Usage:
 *   HardwareStore.mount('#hardware-panel', { api: myApiFn, getUser: () => user });
 *   store.open();
 */
(function (global) {
  const CATEGORY_LABELS = {
    all: 'All',
    airtag: 'AirTags',
    tracker: 'Trackers',
    gps: 'GPS Hardware',
  };

  function formatPrice(price, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
      }).format(price);
    } catch {
      return `$${Number(price).toFixed(2)}`;
    }
  }

  function tagClass(category) {
    if (category === 'tracker') return 'hardware-card__tag hardware-card__tag--tracker';
    if (category === 'airtag') return 'hardware-card__tag hardware-card__tag--airtag';
    return 'hardware-card__tag';
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function mount(target, { api, getUser, onMessage } = {}) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host || typeof api !== 'function') return null;

    host.innerHTML = `
      <div class="hardware-store">
        <p class="hardware-store__intro">
          Browse tracking and geolocation hardware. Select one or more items, then submit your delivery details.
        </p>
        <div class="hardware-store__filters" role="tablist"></div>
        <div class="hardware-store__grid"></div>
        <div class="hardware-store__cart" hidden>
          <div class="hardware-store__cart-head">
            <h4>Selected items</h4>
            <span class="hardware-store__cart-count"></span>
          </div>
          <ul class="hardware-store__cart-list"></ul>
          <p class="hardware-store__cart-total"></p>
        </div>
        <div class="hardware-store__form" hidden>
          <div class="hardware-store__form-card">
            <div class="hardware-store__form-header">
              <div class="hardware-store__form-icon" aria-hidden="true">📦</div>
              <div>
                <h4>Delivery details</h4>
                <p class="hardware-store__form-hint">We need your contact info and shipping address to process your hardware request.</p>
              </div>
            </div>
            <div class="hardware-store__fields">
              <div class="hardware-store__field-row">
                <div class="hardware-store__field">
                  <label class="hardware-store__label" for="hw-email">Email <span class="hardware-store__required">*</span></label>
                  <input id="hw-email" type="email" class="hardware-store__input hardware-store__email" required autocomplete="email" placeholder="you@example.com">
                </div>
                <div class="hardware-store__field">
                  <label class="hardware-store__label" for="hw-phone">Phone <span class="hardware-store__required">*</span></label>
                  <input id="hw-phone" type="tel" class="hardware-store__input hardware-store__phone" required autocomplete="tel" placeholder="+1 555 123 4567">
                </div>
              </div>
              <div class="hardware-store__field">
                <label class="hardware-store__label" for="hw-address">Delivery address <span class="hardware-store__required">*</span></label>
                <textarea id="hw-address" class="hardware-store__input hardware-store__textarea hardware-store__address" required placeholder="Street address&#10;City, state, postal code&#10;Country"></textarea>
              </div>
              <div class="hardware-store__field">
                <label class="hardware-store__label" for="hw-notes">Notes <span class="hardware-store__optional">(optional)</span></label>
                <textarea id="hw-notes" class="hardware-store__input hardware-store__textarea hardware-store__notes" placeholder="Color preference, delivery instructions, etc."></textarea>
              </div>
            </div>
            <div class="hardware-store__form-actions">
              <button type="button" class="hardware-store__submit">Submit request</button>
              <button type="button" class="hardware-store__clear secondary-btn">Clear selection</button>
            </div>
            <p class="hardware-store__success" hidden></p>
          </div>
        </div>
        <div class="hardware-store__orders">
          <h4>Your requests</h4>
          <ul class="hardware-store__list"></ul>
          <p class="hardware-store__empty" hidden>No requests yet.</p>
        </div>
      </div>
    `;

    const filtersEl = host.querySelector('.hardware-store__filters');
    const gridEl = host.querySelector('.hardware-store__grid');
    const cartEl = host.querySelector('.hardware-store__cart');
    const cartListEl = host.querySelector('.hardware-store__cart-list');
    const cartCountEl = host.querySelector('.hardware-store__cart-count');
    const cartTotalEl = host.querySelector('.hardware-store__cart-total');
    const formEl = host.querySelector('.hardware-store__form');
    const emailEl = host.querySelector('.hardware-store__email');
    const phoneEl = host.querySelector('.hardware-store__phone');
    const addressEl = host.querySelector('.hardware-store__address');
    const notesEl = host.querySelector('.hardware-store__notes');
    const successEl = host.querySelector('.hardware-store__success');
    const listEl = host.querySelector('.hardware-store__list');
    const emptyEl = host.querySelector('.hardware-store__empty');

    let products = [];
    let activeFilter = 'all';
    const cart = new Map();

    function notify(msg, isError) {
      if (typeof onMessage === 'function') onMessage(msg, isError);
    }

    function prefillContactFields() {
      const user = typeof getUser === 'function' ? getUser() : null;
      if (user?.email && !emailEl.value) emailEl.value = user.email;
      if (user?.phone && !phoneEl.value) phoneEl.value = user.phone;
    }

    function cartItems() {
      return Array.from(cart.values());
    }

    function cartTotal() {
      return cartItems().reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);
    }

    function updateCartUI() {
      const items = cartItems();
      const hasItems = items.length > 0;

      cartEl.hidden = !hasItems;
      formEl.hidden = !hasItems;

      if (!hasItems) {
        cartListEl.innerHTML = '';
        cartCountEl.textContent = '';
        cartTotalEl.textContent = '';
        successEl.hidden = true;
        return;
      }

      prefillContactFields();

      cartCountEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
      cartListEl.innerHTML = '';
      items.forEach((entry) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="hardware-store__cart-name">${entry.product.name}</span>
          <label class="hardware-store__cart-qty">
            Qty
            <input type="number" min="1" max="10" value="${entry.quantity}" data-product-id="${entry.product.id}" inputmode="numeric">
          </label>
          <span class="hardware-store__cart-line">${formatPrice(entry.product.price * entry.quantity, entry.product.currency)}</span>
          <button type="button" class="hardware-store__cart-remove link-btn" data-product-id="${entry.product.id}" aria-label="Remove ${entry.product.name}">Remove</button>
        `;
        cartListEl.appendChild(li);
      });

      cartTotalEl.textContent = `Estimated total: ${formatPrice(cartTotal(), items[0]?.product.currency || 'USD')}`;

      cartListEl.querySelectorAll('input[data-product-id]').forEach((input) => {
        input.addEventListener('change', () => {
          const entry = cart.get(input.dataset.productId);
          if (!entry) return;
          entry.quantity = Math.min(Math.max(parseInt(input.value, 10) || 1, 1), 10);
          input.value = String(entry.quantity);
          updateCartUI();
          renderProducts();
        });
      });

      cartListEl.querySelectorAll('.hardware-store__cart-remove').forEach((btn) => {
        btn.onclick = () => {
          cart.delete(btn.dataset.productId);
          updateCartUI();
          renderProducts();
        };
      });
    }

    function toggleProduct(product) {
      if (cart.has(product.id)) {
        cart.delete(product.id);
      } else {
        cart.set(product.id, { product, quantity: 1 });
      }
      updateCartUI();
      renderProducts();
    }

    function clearCart() {
      cart.clear();
      emailEl.value = '';
      phoneEl.value = '';
      addressEl.value = '';
      notesEl.value = '';
      successEl.hidden = true;
      successEl.textContent = '';
      updateCartUI();
      renderProducts();
    }

    function renderFilters() {
      filtersEl.innerHTML = '';
      Object.entries(CATEGORY_LABELS).forEach(([key, label]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `hardware-store__filter secondary-btn${activeFilter === key ? ' is-active' : ''}`;
        btn.textContent = label;
        btn.onclick = () => {
          activeFilter = key;
          renderFilters();
          renderProducts();
        };
        filtersEl.appendChild(btn);
      });
    }

    function renderProducts() {
      const filtered = activeFilter === 'all'
        ? products
        : products.filter((p) => p.category === activeFilter);

      gridEl.innerHTML = '';
      filtered.forEach((product) => {
        const selected = cart.has(product.id);
        const card = document.createElement('article');
        card.className = `hardware-card${selected ? ' hardware-card--selected' : ''}`;
        const imageHtml = product.image
          ? `<img class="hardware-card__image" src="${product.image}" alt="${product.name}" loading="lazy" width="72" height="72">`
          : `<div class="hardware-card__image hardware-card__image--fallback">${product.icon || '📦'}</div>`;
        card.innerHTML = `
          ${imageHtml}
          <div class="hardware-card__head">
            <div class="hardware-card__meta">
              <h5 class="hardware-card__name">${product.name}</h5>
              <span class="${tagClass(product.category)}">${CATEGORY_LABELS[product.category] || product.category}</span>
            </div>
          </div>
          <p class="hardware-card__desc">${product.description}</p>
          <div class="hardware-card__footer">
            <span class="hardware-card__price">${formatPrice(product.price, product.currency)}</span>
            <button type="button" class="hardware-card__toggle secondary-btn${selected ? ' is-selected' : ''}">${selected ? 'Selected' : 'Select'}</button>
          </div>
        `;
        card.querySelector('.hardware-card__toggle').onclick = () => toggleProduct(product);
        gridEl.appendChild(card);
      });
    }

    async function loadProducts() {
      const { products: list } = await api('/hardware/products');
      products = list || [];
      renderFilters();
      renderProducts();
      updateCartUI();
    }

    function groupRequests(requests) {
      const groups = new Map();
      requests.forEach((req) => {
        const key = req.batch_id || req.id;
        if (!groups.has(key)) {
          groups.set(key, {
            batchId: req.batch_id,
            createdAt: req.created_at,
            status: req.status,
            shippingAddress: req.shipping_address,
            contactEmail: req.contact_email,
            contactPhone: req.contact_phone,
            items: [],
          });
        }
        groups.get(key).items.push(req);
      });
      return Array.from(groups.values());
    }

    async function loadRequests() {
      try {
        const { requests } = await api('/hardware/requests');
        listEl.innerHTML = '';
        if (!requests?.length) {
          emptyEl.hidden = false;
          emptyEl.textContent = 'No requests yet.';
          return;
        }
        emptyEl.hidden = true;
        groupRequests(requests).forEach((group) => {
          const li = document.createElement('li');
          li.className = 'hardware-store__order-group';
          const total = group.items.reduce(
            (sum, item) => sum + (item.quantity || 1) * (item.unit_price || 0),
            0
          );
          const lines = group.items.map(
            (item) => `<li>${item.product_name} × ${item.quantity} — ${formatPrice((item.quantity || 1) * (item.unit_price || 0), item.currency)}</li>`
          ).join('');
          li.innerHTML = `
            <div class="hardware-store__order-main">
              <strong>${new Date(group.createdAt).toLocaleString()}</strong>
              <ul class="hardware-store__order-items">${lines}</ul>
              <small>${group.contactEmail || ''}${group.contactPhone ? ` · ${group.contactPhone}` : ''}</small><br>
              <small>${group.shippingAddress || ''}</small>
            </div>
            <div class="hardware-store__order-side">
              <span class="hardware-store__status">${group.status}</span><br>
              <small>${formatPrice(total, group.items[0]?.currency || 'USD')}</small>
            </div>
          `;
          listEl.appendChild(li);
        });
      } catch {
        emptyEl.hidden = false;
        emptyEl.textContent = 'Sign in to view your requests.';
      }
    }

    async function submitRequest() {
      const items = cartItems();
      if (!items.length) {
        notify('Select at least one product.', true);
        return;
      }

      const email = emailEl.value.trim();
      const phone = phoneEl.value.trim();
      const shippingAddress = addressEl.value.trim();
      const notes = notesEl.value.trim();

      if (!isValidEmail(email)) {
        notify('Enter a valid email address.', true);
        emailEl.focus();
        return;
      }
      if (phone.replace(/\D/g, '').length < 7) {
        notify('Enter a valid phone number.', true);
        phoneEl.focus();
        return;
      }
      if (shippingAddress.length < 10) {
        notify('Enter a full delivery address (street, city, country).', true);
        addressEl.focus();
        return;
      }

      const submitBtn = host.querySelector('.hardware-store__submit');
      submitBtn.disabled = true;
      try {
        const data = await api('/hardware/requests', {
          method: 'POST',
          body: JSON.stringify({
            items: items.map((entry) => ({
              productId: entry.product.id,
              quantity: entry.quantity,
            })),
            email,
            phone,
            shippingAddress,
            notes,
          }),
        });
        successEl.hidden = false;
        successEl.textContent = data.message || 'Request submitted.';
        notify(data.message || 'Hardware request submitted.', false);
        clearCart();
        await loadRequests();
      } catch (err) {
        notify(err.message || 'Failed to submit request.', true);
      } finally {
        submitBtn.disabled = false;
      }
    }

    host.querySelector('.hardware-store__submit').onclick = submitRequest;
    host.querySelector('.hardware-store__clear').onclick = clearCart;

    async function refresh() {
      await loadProducts();
      await loadRequests();
    }

    const apiObj = {
      el: host,
      refresh,
      open: refresh,
      clearCart,
      destroy() {
        host.innerHTML = '';
      },
    };

    return apiObj;
  }

  global.HardwareStore = { mount };
})(typeof window !== 'undefined' ? window : globalThis);

// BARON'S SILLAGE Admin Control Panel Application Logic (Ultra-Smooth Multi-Page)

const API_BASE = window.location.origin;
const POLL_INTERVAL_MS = 10000; // 10 Saniyede Bir Arka Plan Kontrolü (Ultra Hafif)

// Global App State
const state = {
  products: [],
  orders: [],
  rewards: [],
  knownOrderIds: new Set(),
  searchQuery: '',
  soundEnabled: true,
  isInitialLoad: true,
  isFetching: false
};

// DOM Elements
const elements = {
  // Metrics
  statTotalProducts: document.getElementById('statTotalProducts'),
  statTotalStock: document.getElementById('statTotalStock'),
  statTotalOrders: document.getElementById('statTotalOrders'),
  ordersBadgeCount: document.getElementById('ordersBadgeCount'),
  
  // Controls & Tabs
  tabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  searchInput: document.getElementById('searchInput'),
  btnRefreshData: document.getElementById('btnRefreshData'),
  btnToggleSound: document.getElementById('btnToggleSound'),
  syncStatusBadge: document.getElementById('syncStatusBadge'),
  
  // Tables
  productsTableBody: document.getElementById('productsTableBody'),
  ordersTableBody: document.getElementById('ordersTableBody'),
  rewardsTableBody: document.getElementById('rewardsTableBody'),
  productsTableCount: document.getElementById('productsTableCount'),
  ordersTableCount: document.getElementById('ordersTableCount'),
  rewardsTableCount: document.getElementById('rewardsTableCount'),
  
  // Form
  newProductForm: document.getElementById('newProductForm'),
  shortCode: document.getElementById('shortCode'),
  productCode: document.getElementById('productCode'),
  productName: document.getElementById('productName'),
  colorInput: document.getElementById('colorInput'),
  sizeInput: document.getElementById('sizeInput'),
  stockInput: document.getElementById('stockInput'),
  categoryInput: document.getElementById('categoryInput'),
  autoCodePreview: document.getElementById('autoCodePreview'),
  btnSubmitAiProduct: document.getElementById('btnSubmitAiProduct'),
  aiProductPrompt: document.getElementById('aiProductPrompt'),
  aiResultBox: document.getElementById('aiResultBox'),
  aiResultContent: document.getElementById('aiResultContent'),
  
  // Settings & Campaigns Forms
  settingsForm: document.getElementById('settingsForm'),
  settingShippingFee: document.getElementById('settingShippingFee'),
  settingFreeThreshold: document.getElementById('settingFreeThreshold'),
  campaignForm: document.getElementById('campaignForm'),
  campaignsTableBody: document.getElementById('campaignsTableBody')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchData();
  
  // Arka planda 10 saniyede bir sessiz kontrol
  setInterval(pollOrdersInBackground, POLL_INTERVAL_MS);
});

// Setup Event Listeners
function setupEventListeners() {
  if (elements.btnRefreshData) {
    elements.btnRefreshData.addEventListener('click', () => {
      showToast('🔄 Veriler tazeleme isteği gönderildi...', 'info');
      fetchData();
    });
  }

  if (elements.btnToggleSound) {
    elements.btnToggleSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      const icon = elements.btnToggleSound.querySelector('i');
      if (state.soundEnabled) {
        if (icon) icon.className = 'fa-solid fa-bell text-gold';
        showToast('🔔 Sesli sipariş bildirimleri açıldı.', 'success');
        if ('Notification' in window && Notification.permission !== 'granted') {
          Notification.requestPermission();
        }
      } else {
        if (icon) icon.className = 'fa-solid fa-bell-slash text-muted';
        showToast('🔕 Sesli sipariş bildirimleri sessize alındı.', 'info');
      }
    });
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderTables();
    });
  }

  if (elements.shortCode && elements.sizeInput && elements.autoCodePreview) {
    const updateCodePreview = () => {
      const sc = (elements.shortCode.value || 'KGMLW').toUpperCase().trim();
      const sz = (elements.sizeInput.value || 'M').toUpperCase().trim();
      const computedCode = `${sc}-${sz}`;
      elements.autoCodePreview.textContent = `Önizleme: ${computedCode}`;
      if (elements.productCode && !elements.productCode.value) {
        elements.productCode.placeholder = `Örn: ${computedCode}`;
      }
    };
    elements.shortCode.addEventListener('input', updateCodePreview);
    elements.sizeInput.addEventListener('input', updateCodePreview);
  }

  if (elements.newProductForm) {
    elements.newProductForm.addEventListener('submit', handleNewProductSubmit);
  }

  if (elements.btnSubmitAiProduct) {
    elements.btnSubmitAiProduct.addEventListener('click', handleAiProductSubmit);
  }

  if (elements.settingsForm) {
    elements.settingsForm.addEventListener('submit', handleSettingsSubmit);
    fetchSettings();
  }

  if (elements.campaignForm) {
    elements.campaignForm.addEventListener('submit', handleCampaignSubmit);
    fetchCampaigns();
  }
}

// Web Audio API Tabanlı Hoş İki Tonlu Sipariş Çanı
function playNewOrderSound() {
  if (!state.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.warn('Audio sound error:', e);
  }
}

function triggerDesktopNotification(order) {
  if (!('Notification' in window)) return;
  try {
    if (Notification.permission === 'granted') {
      new Notification('🔔 YENİ SİPARİŞ DÜŞTÜ!', {
        body: `Müşteri: ${order.customerName || 'Bilinmiyor'}\nÜrün: ${order.productCode || ''} (${order.quantity || 1} Adet)\nToplam: ${order.totalPrice || 0} TL`,
        icon: '/favicon.ico'
      });
    }
  } catch (e) {
    console.warn('Desktop notification error:', e);
  }
}

// Fetch Products & Orders from Backend API (Sessiz ve Yumuşak Senkronizasyon)
async function fetchData() {
  if (state.isFetching) return;
  state.isFetching = true;
  setSyncStatus('loading', 'Senkronize Ediliyor...');

  try {
    const [stocksRes, ordersRes, rewardsRes] = await Promise.all([
      fetch(`${API_BASE}/api/stocks`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/orders`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/rewards`).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    if (stocksRes && Array.isArray(stocksRes.stocks)) {
      state.products = stocksRes.stocks;
    }
    if (ordersRes && Array.isArray(ordersRes.orders)) {
      processIncomingOrders(ordersRes.orders);
    }
    if (rewardsRes && Array.isArray(rewardsRes.rewards)) {
      state.rewards = rewardsRes.rewards;
    }

    state.isInitialLoad = false;
    updateMetrics();
    renderTables();
    setSyncStatus('success', 'Live SQLite & Sheet Sync');

  } catch (error) {
    console.error('Fetch error:', error);
    setSyncStatus('error', 'Senkronizasyon Duraklatıldı');
  } finally {
    state.isFetching = false;
  }
}

// Arka Planda Sessiz ve Ultra Hızlı Canlı Sipariş Kontrolü (Polling)
async function pollOrdersInBackground() {
  try {
    const res = await fetch(`${API_BASE}/api/orders`);
    if (!res.ok) return;
    const data = await res.json();

    if (data && data.success && Array.isArray(data.orders)) {
      const newOrdersDetected = processIncomingOrders(data.orders);
      if (newOrdersDetected) {
        updateMetrics();
        renderTables();
      }
    }
  } catch (e) {
    // Silent background poll
  }
}

// Sipariş İşleme & Yeni Sipariş Bildirim Alarmı
function processIncomingOrders(newOrdersList) {
  let hasNew = false;

  for (const order of newOrdersList) {
    if (order.orderId && !state.knownOrderIds.has(order.orderId)) {
      state.knownOrderIds.add(order.orderId);

      if (!state.isInitialLoad) {
        hasNew = true;
        playNewOrderSound();
        triggerDesktopNotification(order);
        showToast(`🔔 YENİ SİPARİŞ DÜŞTÜ!\n👤 ${order.customerName} - 📦 ${order.productCode} (${order.quantity} Adet)`, 'success');
      }
    }
  }

  state.orders = newOrdersList;
  return hasNew;
}

// Update Top Metric Cards
function updateMetrics() {
  const totalProducts = state.products.length;
  const totalStock = state.products.reduce((acc, p) => acc + (Number(p.stock) || 0), 0);
  const totalOrders = state.orders.length;

  if (elements.statTotalProducts) elements.statTotalProducts.textContent = totalProducts.toLocaleString('tr-TR');
  if (elements.statTotalStock) elements.statTotalStock.textContent = totalStock.toLocaleString('tr-TR');
  if (elements.statTotalOrders) elements.statTotalOrders.textContent = totalOrders.toLocaleString('tr-TR');
  if (elements.ordersBadgeCount) elements.ordersBadgeCount.textContent = totalOrders;
}

// Render Products & Orders Tables (Yazım Sırasında Ekranda Glitch Olmaması İçin Odak Kontrolü)
function renderTables() {
  const activeElem = document.activeElement;
  if (activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA') && activeElem.id.startsWith('price_')) {
    return; // Kullanıcı tam fiyat kutusunda yazıyorsa tabloyu resetleme!
  }

  renderProductsTable();
  renderOrdersTable();
  renderRewardsTable();
}

// Render VIP Sadakat Ödülleri Tablosu
function renderRewardsTable() {
  if (!elements.rewardsTableBody) return;
  const rewards = state.rewards || [];
  if (elements.rewardsTableCount) elements.rewardsTableCount.textContent = `${rewards.length} Ödül Listelendi`;

  if (rewards.length === 0) {
    elements.rewardsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="loading-cell">
          <i class="fa-solid fa-gift"></i> Henüz tanımlanmış bir VIP sadakat ödülü bulunmuyor. 2000 TL üzeri ilk siparişte otomatik oluşturulur!
        </td>
      </tr>
    `;
    return;
  }

  elements.rewardsTableBody.innerHTML = rewards.map(r => {
    const isUsed = r.isUsed === 1;
    const statusBadge = isUsed 
      ? `<span class="status-badge out-stock">Kullanıldı</span>`
      : `<span class="status-badge in-stock">🚀 Aktif İndirim</span>`;

    return `
      <tr>
        <td>#${r.id}</td>
        <td><strong class="text-purple">${escapeHtml(r.senderId || '-')}</strong></td>
        <td><span class="code-tag">${escapeHtml(r.rewardCode || 'VIP20')}</span></td>
        <td><strong style="color:#4ade80;">%${r.discountPercent || 20} VIP İNDİRİM</strong></td>
        <td>${r.minQualifyingAmount || 2000} TL</td>
        <td>${statusBadge}</td>
        <td><small class="text-muted">${r.createdAt ? new Date(r.createdAt).toLocaleString('tr-TR') : '-'}</small></td>
        <td><small class="text-muted">${r.usedAt ? new Date(r.usedAt).toLocaleString('tr-TR') : '-'}</small></td>
      </tr>
    `;
  }).join('');
}

// Render Products Table
function renderProductsTable() {
  if (!elements.productsTableBody) return;
  const query = state.searchQuery;
  const filtered = state.products.filter(p => {
    const shortCode = (p.shortCode || '').toLowerCase();
    const code = (p.productCode || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    const color = (p.color || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    return shortCode.includes(query) || code.includes(query) || name.includes(query) || color.includes(query) || cat.includes(query);
  });

  if (elements.productsTableCount) elements.productsTableCount.textContent = `${filtered.length} ürün listelendi`;

  if (filtered.length === 0) {
    elements.productsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading-cell">
          <i class="fa-solid fa-box-open"></i> Hiç ürün bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  elements.productsTableBody.innerHTML = filtered.map(p => {
    const stock = Number(p.stock) || 0;
    let stockBadge = `<span class="status-badge in-stock">${stock} adet</span>`;

    if (stock <= 0) {
      stockBadge = `<span class="status-badge out-stock">${stock} (Tükendi)</span>`;
    } else if (stock <= 5) {
      stockBadge = `<span class="status-badge low-stock">${stock} (Kritik)</span>`;
    }

    return `
      <tr>
        <td><strong class="text-purple">${escapeHtml(p.shortCode || '-')}</strong></td>
        <td><span class="code-tag">${escapeHtml(p.productCode || '-')}</span></td>
        <td><strong>${escapeHtml(p.name || '-')}</strong></td>
        <td>${escapeHtml(p.color || '-')}</td>
        <td><span class="size-pill">${escapeHtml(p.size || '-')}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <input type="number" id="stock_${escapeHtml(p.productCode)}" value="${stock}" style="width:65px; padding:4px 6px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-weight:600;" />
            ${stockBadge}
          </div>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:4px;">
            <input type="number" id="price_${escapeHtml(p.productCode)}" value="${p.price || 299}" style="width:75px; padding:4px 6px; border-radius:6px; border:1px solid #475569; background:#0f172a; color:#4ade80; font-weight:700;" />
          </div>
        </td>
        <td><small class="text-muted">${escapeHtml(p.category || '-')}</small></td>
        <td>
          <div class="action-btn-group">
            <button class="btn btn-sm btn-stock" onclick="updateProductPrice('${escapeHtml(p.productCode)}')">
              <i class="fa-solid fa-floppy-disk"></i> Fiyat Kaydet
            </button>
            <button class="btn btn-sm btn-delete" onclick="deleteProduct('${escapeHtml(p.productCode)}')">
              <i class="fa-solid fa-trash-can"></i> Sil
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Tüm Ürün Fiyat ve Stoklarını Toplu Kaydet (Bulk Save)
async function saveAllPricesAndStocks() {
  const updates = [];

  for (const p of state.products) {
    if (!p.productCode) continue;
    const priceInput = document.getElementById(`price_${p.productCode}`);
    const stockInput = document.getElementById(`stock_${p.productCode}`);

    const itemUpdate = { productCode: p.productCode };
    let hasChange = false;

    if (priceInput) {
      const val = Number(priceInput.value);
      if (!isNaN(val) && val >= 0) {
        itemUpdate.price = val;
        hasChange = true;
      }
    }
    if (stockInput) {
      const val = Number(stockInput.value);
      if (!isNaN(val) && val >= 0) {
        itemUpdate.stock = val;
        hasChange = true;
      }
    }

    if (hasChange) {
      updates.push(itemUpdate);
    }
  }

  if (updates.length === 0) {
    showToast('Kaydedilecek veri bulunamadı.', 'info');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/products/bulk-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`💾 TOPLU KAYIT BAŞARILI!\n${updates.length} adet ürünün fiyat ve stok değişiklikleri kaydedildi!`, 'success');
      fetchData();
    } else {
      showToast(`❌ Hata (${res.status}): ${data.error || 'Toplu kayıt gerçekleştirilemedi.'}`, 'error');
    }
  } catch (e) {
    showToast(`❌ Bağlantı Hatası: ${e.message}`, 'error');
  }
}

// Ürün Fiyatı Güncelleme (API)
async function updateProductPrice(productCode) {
  const priceInput = document.getElementById(`price_${productCode}`);
  if (!priceInput) return;
  const newPrice = Number(priceInput.value);
  if (isNaN(newPrice) || newPrice < 0) {
    showToast('Geçersiz fiyat girdiniz.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/products/price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productCode, price: newPrice })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ ${productCode} fiyatı ${newPrice} TL olarak kaydedildi.`, 'success');
      fetchData();
    } else {
      showToast(data.error || 'Fiyat güncellenemedi.', 'error');
    }
  } catch (e) {
    showToast('Fiyat güncellenirken sunucu hatası oluştu.', 'error');
  }
}

// Render Orders Table
function renderOrdersTable() {
  if (!elements.ordersTableBody) return;
  const query = state.searchQuery;
  const filtered = state.orders.filter(o => {
    const id = (o.orderId || '').toLowerCase();
    const sender = (o.senderId || '').toLowerCase();
    const name = (o.customerName || '').toLowerCase();
    const phone = (o.customerPhone || '').toLowerCase();
    const code = (o.productCode || '').toLowerCase();
    return id.includes(query) || sender.includes(query) || name.includes(query) || phone.includes(query) || code.includes(query);
  });

  if (elements.ordersTableCount) elements.ordersTableCount.textContent = `${filtered.length} sipariş listelendi`;

  if (filtered.length === 0) {
    elements.ordersTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="loading-cell">
          <i class="fa-solid fa-inbox"></i> Sipariş bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  elements.ordersTableBody.innerHTML = filtered.map(o => {
    const status = (o.status || 'BEKLEMEDE').toUpperCase();
    let statusBadge = `<span class="status-badge pending">${status}</span>`;

    if (status === 'OK' || status === 'ONAYLANDI') {
      statusBadge = `<span class="status-badge success"><i class="fa-solid fa-check"></i> ONAYLANDI</span>`;
    } else if (status === 'DEC' || status === 'REDDEDİLMEDİ') {
      statusBadge = `<span class="status-badge danger"><i class="fa-solid fa-xmark"></i> REDDEDİLDİ</span>`;
    }

    const priceDisplay = o.totalPrice 
      ? `<strong class="text-green">${Number(o.totalPrice).toFixed(2)} TL</strong>` 
      : `<span class="text-muted">Hesaplanıyor</span>`;

    return `
      <tr>
        <td><strong class="text-purple">${escapeHtml(o.orderId || '-')}</strong></td>
        <td><strong>${escapeHtml(o.customerName || '-')}</strong></td>
        <td><span class="code-tag">${escapeHtml(o.customerPhone || '-')}</span></td>
        <td><small class="text-muted">${escapeHtml(o.address || '-')}</small></td>
        <td><span class="size-pill">${escapeHtml(o.productCode || '-')}</span></td>
        <td><strong>${o.quantity || 1}</strong></td>
        <td>${priceDisplay}</td>
        <td>${statusBadge}</td>
        <td><small class="text-muted">${escapeHtml(o.createdAt || '-')}</small></td>
        <td>
          <div class="action-btn-group">
            <button class="btn btn-sm btn-success" onclick="updateOrderStatus('${escapeHtml(o.orderId)}', 'OK')">
              <i class="fa-solid fa-check"></i> Onayla
            </button>
            <button class="btn btn-sm btn-delete" onclick="updateOrderStatus('${escapeHtml(o.orderId)}', 'DEC')">
              <i class="fa-solid fa-xmark"></i> Reddet
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Handle New Product Submit
async function handleNewProductSubmit(e) {
  e.preventDefault();

  const shortCodeVal = (elements.shortCode.value || '').toUpperCase().trim();
  const sizeVal = (elements.sizeInput.value || '').toUpperCase().trim();
  let computedProductCode = (elements.productCode.value || '').toUpperCase().trim();

  if (!computedProductCode && shortCodeVal && sizeVal) {
    computedProductCode = `${shortCodeVal}-${sizeVal}`;
  }

  const payload = {
    shortCode: shortCodeVal,
    productCode: computedProductCode,
    name: elements.productName.value.trim(),
    color: elements.colorInput.value.trim(),
    size: sizeVal,
    stock: Number(elements.stockInput.value) || 0,
    category: elements.categoryInput.value.trim()
  };

  const submitBtn = document.getElementById('btnSubmitProduct');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✅ ${payload.name} (${payload.productCode}) kaydedildi!`, 'success');
      elements.newProductForm.reset();
      fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Kaydedilemedi'}`, 'error');
    }
  } catch (err) {
    showToast('Sunucu hatası oluştu.', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Handle Gemini AI Product Submit
async function handleAiProductSubmit() {
  const promptText = (elements.aiProductPrompt.value || '').trim();
  if (!promptText) {
    showToast('Lütfen yapay zekaya bir ürün açıklaması yazın.', 'error');
    return;
  }

  elements.btnSubmitAiProduct.disabled = true;
  elements.btnSubmitAiProduct.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gemini AI Analiz Ediyor...`;

  try {
    const res = await fetch(`${API_BASE}/api/ai/create-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✨ ${data.message || 'Ürünler AI tarafından kaydedildi!'}`, 'success');
      elements.aiResultBox.style.display = 'block';
      elements.aiResultContent.textContent = JSON.stringify(data, null, 2);
      elements.aiProductPrompt.value = '';
      fetchData();
    } else {
      showToast(`❌ AI Hatası: ${data.error || 'İşlem başarısız'}`, 'error');
    }
  } catch (err) {
    showToast('Gemini AI bağlantı hatası.', 'error');
  } finally {
    elements.btnSubmitAiProduct.disabled = false;
    elements.btnSubmitAiProduct.innerHTML = `<i class="fa-solid fa-robot"></i> Yapay Zeka İle Oluştur ve Kaydet`;
  }
}

// Sipariş Durumu Güncelleme (OK veya DEC)
async function updateOrderStatus(orderId, status) {
  try {
    const res = await fetch(`${API_BASE}/api/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status })
    });
    const data = await res.json();

    if (data.success) {
      const statusText = status === 'OK' ? 'ONAYLANDI' : 'REDDEDİLDİ';
      showToast(`✅ Sipariş ${orderId} durumu '${statusText}' olarak güncellendi.`, 'success');
      fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Sipariş durumu güncellenemedi.'}`, 'error');
    }
  } catch (err) {
    showToast('Sipariş güncellenirken sunucu hatası oluştu.', 'error');
  }
}

// Ürün Silme
async function deleteProduct(productCode) {
  if (!confirm(`${productCode} kodlu ürünü silmek istediğinize emin misiniz?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/products/${productCode}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ ${productCode} silindi.`, 'success');
      fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Silinemedi'}`, 'error');
    }
  } catch (err) {
    showToast('Silme işlemi başarısız oldu.', 'error');
  }
}

// Fetch and Handle Settings
async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.settings) {
      if (elements.settingShippingFee) elements.settingShippingFee.value = data.settings.shipping_fee || '49';
      if (elements.settingFreeThreshold) elements.settingFreeThreshold.value = data.settings.free_shipping_threshold || '1500';
    }
  } catch (e) {}
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const shippingFee = elements.settingShippingFee.value;
  const freeThreshold = elements.settingFreeThreshold.value;

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { shipping_fee: shippingFee, free_shipping_threshold: freeThreshold } })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Kargo fiyat ayarları kaydedildi!', 'success');
    } else {
      showToast('❌ Ayarlar kaydedilemedi.', 'error');
    }
  } catch (e) {
    showToast('Ayarlar kaydedilirken hata oluştu.', 'error');
  }
}

// Fetch and Handle Campaigns
async function fetchCampaigns() {
  try {
    const res = await fetch(`${API_BASE}/api/campaigns`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.campaigns) && elements.campaignsTableBody) {
      if (data.campaigns.length === 0) {
        elements.campaignsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Aktif kampanya bulunmuyor.</td></tr>`;
        return;
      }
      elements.campaignsTableBody.innerHTML = data.campaigns.map(c => `
        <tr>
          <td>#${c.id}</td>
          <td><strong>${escapeHtml(c.title)}</strong></td>
          <td>${escapeHtml(c.description)}</td>
          <td><span class="code-tag">${escapeHtml(c.code || '-')}</span></td>
          <td><strong class="text-green">%${c.discount_percent || 0}</strong></td>
          <td>
            <button class="btn btn-sm btn-delete" onclick="deleteCampaign(${c.id})"><i class="fa-solid fa-trash-can"></i> Sil</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (e) {}
}

async function handleCampaignSubmit(e) {
  e.preventDefault();
  const payload = {
    title: document.getElementById('campTitle').value,
    code: document.getElementById('campCode').value,
    discountPercent: Number(document.getElementById('campPercent').value) || 0,
    description: document.getElementById('campDesc').value
  };

  try {
    const res = await fetch(`${API_BASE}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('🎉 Yeni kampanya başarıyla başlatıldı!', 'success');
      elements.campaignForm.reset();
      fetchCampaigns();
      fetchData();
    } else {
      showToast('❌ Kampanya oluşturulamadı.', 'error');
    }
  } catch (e) {
    showToast('Kampanya oluşturulurken hata oluştu.', 'error');
  }
}

async function deleteCampaign(id) {
  if (!confirm('Kampanyayı silmek istediğinize emin misiniz?')) return;
  try {
    const res = await fetch(`${API_BASE}/api/campaigns/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('✅ Kampanya silindi.', 'success');
      fetchCampaigns();
      fetchData();
    }
  } catch (e) {
    showToast('Kampanya silinirken hata oluştu.', 'error');
  }
}

// UI Status Badge Helper
function setSyncStatus(type, message) {
  if (!elements.syncStatusBadge) return;
  elements.syncStatusBadge.className = `sync-badge ${type}`;
  const span = elements.syncStatusBadge.querySelector('span:not(.pulse-dot)');
  if (span) span.textContent = message;
}

// Toast Notification Engine
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon} toast-icon"></i>
    <div class="toast-message">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// HTML Escape Utility
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

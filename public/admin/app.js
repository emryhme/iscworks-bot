// BARON'S SILLAGE Admin Control Panel Application Logic (Ultra-Smooth Multi-Page)

const API_BASE = '';
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

// Initialize Application Robustly (Supports readyState interactive & complete)
function initApp() {
  setupEventListeners();
  fetchData();
  fetchCampaigns();
  fetchSettings();
  setInterval(pollOrdersInBackground, POLL_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Setup Event Listeners (Dinamik DOM Seçiciler)
function setupEventListeners() {
  const btnRefreshData = document.getElementById('btnRefreshData');
  const btnToggleSound = document.getElementById('btnToggleSound');
  const searchInput = document.getElementById('searchInput');
  const shortCode = document.getElementById('shortCode');
  const sizeInput = document.getElementById('sizeInput');
  const autoCodePreview = document.getElementById('autoCodePreview');
  const productCode = document.getElementById('productCode');
  const newProductForm = document.getElementById('newProductForm');
  const btnSubmitAiProduct = document.getElementById('btnSubmitAiProduct');
  const settingsForm = document.getElementById('settingsForm');
  const campaignForm = document.getElementById('campaignForm');

  if (btnRefreshData) {
    btnRefreshData.addEventListener('click', () => {
      showToast('🔄 Veriler tazeleniyor...', 'info');
      fetchData();
      fetchCampaigns();
      fetchSettings();
    });
  }

  if (btnToggleSound) {
    btnToggleSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      const icon = btnToggleSound.querySelector('i');
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

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderTables();
    });
  }

  if (shortCode && sizeInput && autoCodePreview) {
    const updateCodePreview = () => {
      const sc = (shortCode.value || 'KGMLW').toUpperCase().trim();
      const sz = (sizeInput.value || 'M').toUpperCase().trim();
      const computedCode = `${sc}-${sz}`;
      autoCodePreview.textContent = `Önizleme: ${computedCode}`;
      if (productCode && !productCode.value) {
        productCode.placeholder = `Örn: ${computedCode}`;
      }
    };

    shortCode.addEventListener('input', updateCodePreview);
    sizeInput.addEventListener('input', updateCodePreview);
  }

  if (newProductForm) {
    newProductForm.addEventListener('submit', handleNewProductSubmit);
  }

  if (btnSubmitAiProduct) {
    btnSubmitAiProduct.addEventListener('click', handleAiProductSubmit);
  }

  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSettingsSubmit);
  }

  if (campaignForm) {
    campaignForm.addEventListener('submit', handleCampaignSubmit);
  }

  const rewardForm = document.getElementById('rewardForm');
  if (rewardForm) {
    rewardForm.addEventListener('submit', handleRewardSubmit);
  }

  const btnSendAdminChat = document.getElementById('btnSendAdminChat');
  const aiAdminChatInput = document.getElementById('aiAdminChatInput');

  if (btnSendAdminChat) {
    btnSendAdminChat.addEventListener('click', sendAdminChatMessage);
  }

  if (aiAdminChatInput) {
    aiAdminChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAdminChatMessage();
      }
    });
  }

  const btnToggleAutoReward = document.getElementById('btnToggleAutoReward');
  if (btnToggleAutoReward) {
    btnToggleAutoReward.addEventListener('click', toggleAutoRewardSetting);
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

// Fetch Products & Orders from Backend API
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
    loadAutoRewardSetting();
    setSyncStatus('success', 'Live SQLite & Sheet Sync');

  } catch (error) {
    console.error('Fetch error:', error);
    setSyncStatus('error', 'Senkronizasyon Duraklatıldı');
    renderTables();
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

  const statTotalProducts = document.getElementById('statTotalProducts');
  const statTotalStock = document.getElementById('statTotalStock');
  const statTotalOrders = document.getElementById('statTotalOrders');
  const ordersBadgeCount = document.getElementById('ordersBadgeCount');

  if (statTotalProducts) statTotalProducts.textContent = totalProducts.toLocaleString('tr-TR');
  if (statTotalStock) statTotalStock.textContent = totalStock.toLocaleString('tr-TR');
  if (statTotalOrders) statTotalOrders.textContent = totalOrders.toLocaleString('tr-TR');
  if (ordersBadgeCount) ordersBadgeCount.textContent = totalOrders;
}

// Render Products & Orders Tables
function renderTables() {
  const activeElem = document.activeElement;
  if (activeElem && (activeElem.tagName === 'INPUT' || activeElem.tagName === 'TEXTAREA') && activeElem.id.startsWith('price_')) {
    return;
  }

  renderProductsTable();
  renderOrdersTable();
  renderRewardsTable();
  renderRewardOrdersTable();
}

// Render VIP Sadakat Ödülleri Tablosu
function renderRewardsTable() {
  const rewardsTableBody = document.getElementById('rewardsTableBody');
  const rewardsTableCount = document.getElementById('rewardsTableCount');
  if (!rewardsTableBody) return;

  const rewards = state.rewards || [];
  if (rewardsTableCount) rewardsTableCount.textContent = `${rewards.length} Ödül Listelendi`;

  if (rewards.length === 0) {
    rewardsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="loading-cell">
          <i class="fa-solid fa-gift"></i> Henüz tanımlanmış bir VIP sadakat ödülü bulunmuyor. 2000 TL üzeri ilk siparişte otomatik oluşturulur!
        </td>
      </tr>
    `;
    return;
  }

  rewardsTableBody.innerHTML = rewards.map(r => {
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
        <td>
          <button class="btn btn-sm btn-delete" onclick="deleteReward(${r.id})">
            <i class="fa-solid fa-trash-can"></i> Sil
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Render VIP Sadakat Ekranındaki Sipariş Seçici Tablosu
function renderRewardOrdersTable() {
  const tableBody = document.getElementById('rewardOrdersTableBody');
  if (!tableBody) return;

  const orders = state.orders || [];
  if (orders.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-cell">
          <i class="fa-solid fa-inbox"></i> Henüz verilmiş bir sipariş bulunmuyor.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = orders.map(o => {
    const senderId = o.senderId || 'Bilinmiyor';
    const totalPriceNum = Number(o.totalPrice);
    const qty = Number(o.quantity) || 1;
    const fallbackPrice = qty * 299;

    let priceDisplay = `<strong class="text-green">${fallbackPrice.toFixed(2)} TL</strong>`;
    if (!isNaN(totalPriceNum) && totalPriceNum > 0) {
      priceDisplay = `<strong class="text-green">${totalPriceNum.toFixed(2)} TL</strong>`;
    }

    return `
      <tr style="cursor:pointer;" onclick="selectOrderForReward('${escapeHtml(senderId)}')">
        <td><strong class="text-purple">${escapeHtml(o.orderId || '-')}</strong></td>
        <td><span class="code-tag">${escapeHtml(senderId)}</span></td>
        <td><strong>${escapeHtml(o.customerName || '-')}</strong></td>
        <td>${escapeHtml(o.customerPhone || '-')}</td>
        <td>${priceDisplay}</td>
        <td><small class="text-muted">${escapeHtml(o.createdAt || '-')}</small></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); selectOrderForReward('${escapeHtml(senderId)}')">
              <i class="fa-solid fa-hand-pointer"></i> Form'a Aktar
            </button>
            <button class="btn btn-sm btn-delete" onclick="event.stopPropagation(); deleteOrder('${escapeHtml(o.orderId)}')">
              <i class="fa-solid fa-trash"></i> Sil
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Sipariş Tıklandığında Müşteri ID'sini Sadakat Ödül Formuna Otomatik Doldur
function selectOrderForReward(senderId) {
  const senderInput = document.getElementById('rewardSenderId');
  const percentInput = document.getElementById('rewardPercent');
  const rewardForm = document.getElementById('rewardForm');

  if (!senderInput) return;

  senderInput.value = senderId;
  showToast(`✨ Müşteri Instagram ID (${senderId}) ödül formuna kopyalandı!`, 'success');

  if (rewardForm) {
    rewardForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (percentInput) {
    setTimeout(() => percentInput.focus(), 300);
  }
}

// Render Products Table
function renderProductsTable() {
  const productsTableBody = document.getElementById('productsTableBody');
  const productsTableCount = document.getElementById('productsTableCount');
  if (!productsTableBody) return;

  const query = state.searchQuery;
  const filtered = state.products.filter(p => {
    const shortCode = (p.shortCode || '').toLowerCase();
    const code = (p.productCode || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    const color = (p.color || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    return shortCode.includes(query) || code.includes(query) || name.includes(query) || color.includes(query) || cat.includes(query);
  });

  if (productsTableCount) productsTableCount.textContent = `${filtered.length} ürün listelendi`;

  if (filtered.length === 0) {
    productsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading-cell">
          <i class="fa-solid fa-box-open"></i> Hiç ürün bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  productsTableBody.innerHTML = filtered.map(p => {
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
  const ordersTableBody = document.getElementById('ordersTableBody');
  const ordersTableCount = document.getElementById('ordersTableCount');
  if (!ordersTableBody) return;

  const query = state.searchQuery;
  const filtered = state.orders.filter(o => {
    const id = (o.orderId || '').toLowerCase();
    const sender = (o.senderId || '').toLowerCase();
    const name = (o.customerName || '').toLowerCase();
    const phone = (o.customerPhone || '').toLowerCase();
    const code = (o.productCode || '').toLowerCase();
    return id.includes(query) || sender.includes(query) || name.includes(query) || phone.includes(query) || code.includes(query);
  });

  if (ordersTableCount) ordersTableCount.textContent = `${filtered.length} sipariş listelendi`;

  if (filtered.length === 0) {
    ordersTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="loading-cell">
          <i class="fa-solid fa-inbox"></i> Sipariş bulunamadı.
        </td>
      </tr>
    `;
    return;
  }

  ordersTableBody.innerHTML = filtered.map(o => {
    const status = (o.status || 'BEKLEMEDE').toUpperCase();
    let statusBadge = `<span class="status-badge pending">${status}</span>`;

    if (status === 'OK' || status === 'ONAYLANDI') {
      statusBadge = `<span class="status-badge success"><i class="fa-solid fa-check"></i> ONAYLANDI</span>`;
    } else if (status === 'DEC' || status === 'REDDEDİLMEDİ') {
      statusBadge = `<span class="status-badge danger"><i class="fa-solid fa-xmark"></i> REDDEDİLDİ</span>`;
    }

    const totalPriceNum = Number(o.totalPrice);
    const qty = Number(o.quantity) || 1;
    const fallbackPrice = qty * 299;

    let priceDisplay = `<strong class="text-green">${fallbackPrice.toFixed(2)} TL</strong>`;
    if (!isNaN(totalPriceNum) && totalPriceNum > 0) {
      priceDisplay = `<strong class="text-green">${totalPriceNum.toFixed(2)} TL</strong>`;
    }

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

  const shortCode = document.getElementById('shortCode');
  const sizeInput = document.getElementById('sizeInput');
  const productCode = document.getElementById('productCode');
  const productName = document.getElementById('productName');
  const colorInput = document.getElementById('colorInput');
  const stockInput = document.getElementById('stockInput');
  const categoryInput = document.getElementById('categoryInput');

  const shortCodeVal = (shortCode?.value || '').toUpperCase().trim();
  const sizeVal = (sizeInput?.value || '').toUpperCase().trim();
  let computedProductCode = (productCode?.value || '').toUpperCase().trim();

  if (!computedProductCode && shortCodeVal && sizeVal) {
    computedProductCode = `${shortCodeVal}-${sizeVal}`;
  }

  const payload = {
    shortCode: shortCodeVal,
    productCode: computedProductCode,
    name: productName?.value.trim() || '',
    color: colorInput?.value.trim() || '',
    size: sizeVal,
    stock: Number(stockInput?.value) || 0,
    category: categoryInput?.value.trim() || ''
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
      const form = document.getElementById('newProductForm');
      if (form) form.reset();
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
  const promptInput = document.getElementById('aiProductPrompt');
  const submitBtn = document.getElementById('btnSubmitAiProduct');
  const aiResultBox = document.getElementById('aiResultBox');
  const aiResultContent = document.getElementById('aiResultContent');

  const promptText = (promptInput?.value || '').trim();
  if (!promptText) {
    showToast('Lütfen yapay zekaya bir ürün açıklaması yazın.', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gemini AI Analiz Ediyor...`;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ai/create-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✨ ${data.message || 'Ürünler AI tarafından kaydedildi!'}`, 'success');
      if (aiResultBox && aiResultContent) {
        aiResultBox.style.display = 'block';
        aiResultContent.textContent = JSON.stringify(data, null, 2);
      }
      if (promptInput) promptInput.value = '';
      fetchData();
    } else {
      showToast(`❌ AI Hatası: ${data.error || 'İşlem başarısız'}`, 'error');
    }
  } catch (err) {
    showToast('Gemini AI bağlantı hatası.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-robot"></i> Yapay Zeka İle Oluştur ve Kaydet`;
    }
  }
}

// Sipariş Durumu Güncelleme (OK veya DEC)
async function updateOrderStatus(orderId, status) {
  if (status === 'DEC') {
    openRejectionModal(orderId);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status: 'OK' })
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✅ Sipariş ${orderId} onaylandı! Müşteriye bildirim gönderildi.`, 'success');
      fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Sipariş durumu güncellenemedi.'}`, 'error');
    }
  } catch (err) {
    showToast('Sipariş güncellenirken sunucu hatası oluştu.', 'error');
  }
}

// Rejection Modal Dynamic Engine
function getOrCreateRejectionModal() {
  let modal = document.getElementById('rejectionModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'rejectionModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(10px);
    display: none; align-items: center; justify-content: center; z-index: 9999;
  `;

  modal.innerHTML = `
    <div style="background: linear-gradient(135deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 16px; width: 90%; max-width: 520px; padding: 2rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); animation: modalFadeIn 0.3s ease;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; border-bottom:1px solid #334155; padding-bottom:1rem;">
        <h3 style="color:#f43f5e; margin:0; font-size:1.25rem; display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-circle-xmark"></i> Siparişi Reddet & Müşteriye Bildir
        </h3>
        <button id="btnCloseRejectionModal" style="background:none; border:none; color:#94a3b8; font-size:1.5rem; cursor:pointer;">&times;</button>
      </div>

      <p style="color:#cbd5e1; font-size:0.9rem; margin-bottom:1.2rem;" id="rejectionModalSubtitle">
        Siparişi reddetme nedeninizi seçin. Müşterinin Instagram hesabına doğrudan DM mesajı olarak gönderilecektir.
      </p>

      <div style="margin-bottom:1.2rem;">
        <label style="display:block; color:#94a3b8; font-size:0.85rem; font-weight:600; margin-bottom:0.5rem;">
          📋 İptal / Red Sebebi Şablonu Seçin:
        </label>
        <select id="rejectionReasonSelect" style="width:100%; padding:0.75rem; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:0.9rem; font-weight:500;">
          <option value="stok">📦 Stok Tükenmesi (Ürün / Beden Tükendi)</option>
          <option value="adres">📍 Eksik / Anlaşılmayan Teslimat Adresi</option>
          <option value="odeme">💳 Ödeme / Dekont Doğrulaması Başarısız</option>
          <option value="iletisim">📞 Müşteri ile İletişim Kurulamadı</option>
          <option value="ozel">✏️ Özel Nedeni Kendim Yazacağım</option>
        </select>
      </div>

      <div style="margin-bottom:1.5rem;">
        <label style="display:block; color:#94a3b8; font-size:0.85rem; font-weight:600; margin-bottom:0.5rem;">
          💬 Müşteriye Gidecek Mesaj Önizlemesi:
        </label>
        <textarea id="rejectionReasonText" rows="4" style="width:100%; padding:0.75rem; border-radius:8px; border:1px solid #475569; background:#0f172a; color:#f8fafc; font-size:0.88rem; font-family:inherit; resize:vertical;"></textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px;">
        <button id="btnCancelRejection" class="btn btn-sm" style="background:#334155; color:#f8fafc; padding:0.6rem 1.2rem; border-radius:8px; border:none; cursor:pointer;">Vazgeç</button>
        <button id="btnConfirmRejection" class="btn btn-sm btn-delete" style="padding:0.6rem 1.2rem; border-radius:8px; cursor:pointer;">
          <i class="fa-solid fa-paper-plane"></i> Reddet & DM Yolla
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const reasonTemplates = {
    stok: 'Üzülerek bildiririz ki sipariş ettiğiniz ürün/beden stoklarımızda kalmadığı için siparişiniz onaylanamamıştır. Anlayışınız için teşekkür ederiz.',
    adres: 'Girdiğiniz teslimat adresi veya iletişim bilgileri eksik/anlaşılmasız olduğu için siparişiniz işleme alınamamıştır. Lütfen güncel bilgilerinizle tekrar iletişime geçiniz.',
    odeme: 'Siparişinize ait ödeme doğrulaması gerçekleştirilemediği için siparişiniz işleme alınamamıştır.',
    iletisim: 'Sipariş teyidi için sizinle iletişim kurulamadığından siparişiniz iptal edilmiştir.',
    ozel: ''
  };

  const select = document.getElementById('rejectionReasonSelect');
  const textarea = document.getElementById('rejectionReasonText');
  const btnClose = document.getElementById('btnCloseRejectionModal');
  const btnCancel = document.getElementById('btnCancelRejection');

  if (select && textarea) {
    textarea.value = reasonTemplates.stok;
    select.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'ozel') {
        textarea.value = '';
        textarea.focus();
      } else {
        textarea.value = reasonTemplates[val] || '';
      }
    });
  }

  const closeModal = () => { modal.style.display = 'none'; };
  if (btnClose) btnClose.onclick = closeModal;
  if (btnCancel) btnCancel.onclick = closeModal;

  return modal;
}

function openRejectionModal(orderId) {
  const modal = getOrCreateRejectionModal();
  const subtitle = document.getElementById('rejectionModalSubtitle');
  const btnConfirm = document.getElementById('btnConfirmRejection');
  const textarea = document.getElementById('rejectionReasonText');

  if (subtitle) subtitle.textContent = `Sipariş #${orderId} için red sebebi seçin. Müşterinin Instagram hesabına doğrudan DM mesajı olarak gönderilecektir.`;
  modal.style.display = 'flex';

  if (btnConfirm) {
    btnConfirm.onclick = async () => {
      const reason = textarea ? textarea.value.trim() : '';
      if (!reason) {
        showToast('Lütfen müşteriye gönderilecek red nedenini yazın veya seçin.', 'error');
        return;
      }

      btnConfirm.disabled = true;
      btnConfirm.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gönderiliyor...`;

      try {
        const res = await fetch(`${API_BASE}/api/orders/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, status: 'DEC', reason })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ Sipariş ${orderId} reddedildi ve müşteriye DM bildirimi yollandı.`, 'success');
          modal.style.display = 'none';
          fetchData();
        } else {
          showToast(`❌ Hata: ${data.error || 'Sipariş reddedilemedi'}`, 'error');
        }
      } catch (e) {
        showToast('Sunucu bağlantı hatası oluştu.', 'error');
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Reddet & DM Yolla`;
      }
    };
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
  const settingShippingFee = document.getElementById('settingShippingFee');
  const settingFreeThreshold = document.getElementById('settingFreeThreshold');
  if (!settingShippingFee && !settingFreeThreshold) return;

  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.settings) {
      if (settingShippingFee) settingShippingFee.value = data.settings.shipping_fee || '49';
      if (settingFreeThreshold) settingFreeThreshold.value = data.settings.free_shipping_threshold || '1500';
    }
  } catch (e) {}
}

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const settingShippingFee = document.getElementById('settingShippingFee');
  const settingFreeThreshold = document.getElementById('settingFreeThreshold');

  const shippingFee = settingShippingFee ? settingShippingFee.value : '49';
  const freeThreshold = settingFreeThreshold ? settingFreeThreshold.value : '1500';

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
  const tableBody = document.getElementById('campaignsTableBody');
  if (!tableBody) return;

  try {
    const res = await fetch(`${API_BASE}/api/campaigns`);
    if (!res.ok) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 1.5rem; color: #ef4444;">Kampanyalar alınamadı (${res.status}).</td></tr>`;
      return;
    }
    const data = await res.json();
    if (data && data.success && Array.isArray(data.campaigns)) {
      if (data.campaigns.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 1.5rem; color: #94a3b8;">Henüz aktif bir kampanya eklenmemiş. Yeni kampanya ekleyebilirsiniz.</td></tr>`;
        return;
      }
      tableBody.innerHTML = data.campaigns.map(c => {
        let endDateBadge = '<span class="status-badge in-stock">Süresiz</span>';
        if (c.end_date) {
          const isExpired = new Date(c.end_date) < new Date(new Date().setHours(0,0,0,0));
          if (isExpired) {
            endDateBadge = `<span class="status-badge out-stock">⏳ ${c.end_date} (Süresi Doldu)</span>`;
          } else {
            endDateBadge = `<span class="status-badge low-stock">📅 Son: ${c.end_date}</span>`;
          }
        }

        return `
          <tr>
            <td>#${c.id}</td>
            <td><strong>${escapeHtml(c.title)}</strong></td>
            <td>${escapeHtml(c.description)}</td>
            <td><span class="code-tag">${escapeHtml(c.code || '-')}</span></td>
            <td><strong class="text-green">%${c.discount_percent || 0}</strong></td>
            <td>${endDateBadge}</td>
            <td>
              <button class="btn btn-sm btn-delete" onclick="deleteCampaign(${c.id})"><i class="fa-solid fa-trash-can"></i> Sil</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (e) {
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 1.5rem; color: #ef4444;">Bağlantı hatası: ${escapeHtml(e.message)}</td></tr>`;
  }
}

async function handleCampaignSubmit(e) {
  e.preventDefault();

  const titleElem = document.getElementById('campTitle');
  const codeElem = document.getElementById('campCode');
  const percentElem = document.getElementById('campPercent');
  const descElem = document.getElementById('campDesc');
  const startDateElem = document.getElementById('campStartDate');
  const endDateElem = document.getElementById('campEndDate');

  if (!titleElem || !descElem) {
    showToast('Lütfen başlık ve açıklama alanlarını doldurun.', 'error');
    return;
  }

  const payload = {
    title: titleElem.value.trim(),
    code: codeElem ? codeElem.value.trim().toUpperCase() : '',
    discountPercent: percentElem ? (Number(percentElem.value) || 0) : 0,
    description: descElem.value.trim(),
    startDate: startDateElem ? startDateElem.value : null,
    endDate: endDateElem ? endDateElem.value : null
  };

  if (!payload.title || !payload.description) {
    showToast('Başlık ve Açıklama zorunludur.', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🎉 Yeni kampanya başarıyla başlatıldı ve kaydedildi!', 'success');
      const form = document.getElementById('campaignForm');
      if (form) form.reset();
      fetchCampaigns();
    } else {
      showToast(`❌ Kampanya kaydedilemedi: ${data.error || 'Bilinmeyen sunucu hatası'}`, 'error');
    }
  } catch (e) {
    showToast(`❌ Sunucu Bağlantı Hatası: ${e.message}`, 'error');
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
    }
  } catch (e) {
    showToast('Kampanya silinirken hata oluştu.', 'error');
  }
}

// Handle Custom VIP Reward Submit
async function handleRewardSubmit(e) {
  e.preventDefault();

  const senderIdElem = document.getElementById('rewardSenderId');
  const codeElem = document.getElementById('rewardCode');
  const percentElem = document.getElementById('rewardPercent');
  const minAmountElem = document.getElementById('rewardMinAmount');

  if (!senderIdElem || !percentElem) return;

  const payload = {
    senderId: senderIdElem.value.trim(),
    rewardCode: codeElem ? (codeElem.value.trim().toUpperCase() || 'VIP20') : 'VIP20',
    discountPercent: Number(percentElem.value) || 20,
    minQualifyingAmount: minAmountElem ? (Number(minAmountElem.value) || 2000) : 2000
  };

  try {
    const res = await fetch(`${API_BASE}/api/rewards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('💎 VIP Sadakat Ödülü başarıyla eklendi!', 'success');
      const form = document.getElementById('rewardForm');
      if (form) form.reset();
      fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Eklenemedi'}`, 'error');
    }
  } catch (e) {
    showToast('Ödül eklenirken sunucu hatası oluştu.', 'error');
  }
}

async function deleteReward(id) {
  if (!confirm('Bu VIP ödülünü silmek istediğinize emin misiniz?')) return;
  try {
    const res = await fetch(`${API_BASE}/api/rewards/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('✅ VIP Ödülü silindi.', 'success');
      fetchData();
    }
  } catch (e) {
    showToast('Silme hatası oluştu.', 'error');
  }
}

// UI Status Badge Helper
function setSyncStatus(type, message) {
  const syncBadge = document.getElementById('syncStatusBadge');
  if (!syncBadge) return;
  syncBadge.className = `sync-badge ${type}`;
  const span = syncBadge.querySelector('span:not(.pulse-dot)');
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

// Quick Action Helper for AI Copilot
function setAiPrompt(text) {
  const input = document.getElementById('aiAdminChatInput');
  if (input) {
    input.value = text;
    input.focus();
  }
}

// Admin Copilot Chat Logic
async function sendAdminChatMessage() {
  const input = document.getElementById('aiAdminChatInput');
  const chatWindow = document.getElementById('aiAdminChatWindow');
  const sendBtn = document.getElementById('btnSendAdminChat');

  if (!input || !chatWindow) return;
  const prompt = input.value.trim();
  if (!prompt) return;

  // Append User Message Bubble (Patron)
  const userBubble = document.createElement('div');
  userBubble.style.cssText = 'display:flex; gap:10px; justify-content:flex-end; align-items:flex-start; margin-top:6px;';
  userBubble.innerHTML = `
    <div style="background:linear-gradient(135deg, #2563eb, #1d4ed8); color:#ffffff; padding:0.85rem 1.1rem; border-radius:12px; border-top-right-radius:2px; max-width:80%; font-size:0.92rem; line-height:1.5;">
      ${escapeHtml(prompt).replace(/\n/g, '<br>')}
    </div>
    <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #fbbf24, #f59e0b); display:flex; align-items:center; justify-content:center; color:#000; font-size:16px; font-weight:bold;">
      <i class="fa-solid fa-crown"></i>
    </div>
  `;
  chatWindow.appendChild(userBubble);

  input.value = '';
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Loading Indicator Bubble
  const loadingBubble = document.createElement('div');
  loadingBubble.id = 'aiLoadingBubble';
  loadingBubble.style.cssText = 'display:flex; gap:10px; align-items:flex-start; margin-top:6px;';
  loadingBubble.innerHTML = `
    <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #a855f7, #6366f1); display:flex; align-items:center; justify-content:center; color:#fff; font-size:16px;">
      <i class="fa-solid fa-robot"></i>
    </div>
    <div style="background:#1e293b; color:#94a3b8; padding:0.85rem 1.1rem; border-radius:12px; border-top-left-radius:2px; font-size:0.92rem; border:1px solid #334155;">
      <i class="fa-solid fa-spinner fa-spin"></i> F.R.I.D.A.Y. emrinizi işliyor...
    </div>
  `;
  chatWindow.appendChild(loadingBubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/ai/admin-copilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    const data = await res.json();
    loadingBubble.remove();

    const replyText = (data && data.reply) ? data.reply : '❌ Bir hata oluştu.';

    // Append AI Response Bubble
    const aiBubble = document.createElement('div');
    aiBubble.style.cssText = 'display:flex; gap:10px; align-items:flex-start; margin-top:6px;';
    aiBubble.innerHTML = `
      <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg, #a855f7, #6366f1); display:flex; align-items:center; justify-content:center; color:#fff; font-size:16px;">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div style="background:#1e293b; color:#f8fafc; padding:0.85rem 1.1rem; border-radius:12px; border-top-left-radius:2px; max-width:80%; font-size:0.92rem; line-height:1.5; border:1px solid #334155;">
        ${escapeHtml(replyText).replace(/\n/g, '<br>')}
      </div>
    `;
    chatWindow.appendChild(aiBubble);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Tazeleme
    fetchData();

  } catch (err) {
    if (loadingBubble) loadingBubble.remove();
    showToast('AI Asistan bağlantı hatası.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Sipariş Silme (Tüm Panellerden)
async function deleteOrder(orderId) {
  if (!confirm(`Sipariş #${orderId} kaydını veritabanından silmek istediğinize emin misiniz?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/orders/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🗑️ Sipariş #${orderId} başarıyla silindi.`, 'success');
      fetchData();
    } else {
      showToast(`❌ Sipariş silinemedi: ${data.error || ''}`, 'error');
    }
  } catch (err) {
    showToast('Sunucu hatası oluştu.', 'error');
  }
}

// Auto VIP Reward Setting Toggle Engine
async function loadAutoRewardSetting() {
  const badge = document.getElementById('autoRewardStatusBadge');
  const btn = document.getElementById('btnToggleAutoReward');
  if (!badge || !btn) return;

  try {
    const res = await fetch(`${API_BASE}/api/settings`);
    const data = await res.json();
    if (data.success && data.settings) {
      const val = data.settings.auto_vip_reward_enabled;
      const isEnabled = val === '1' || val === 'true';

      if (isEnabled) {
        badge.className = 'status-badge in-stock';
        badge.innerHTML = '<i class="fa-solid fa-circle text-green" style="font-size:8px;"></i> AÇIK (Yapay Zeka Verir)';
        btn.innerHTML = '<i class="fa-solid fa-toggle-on text-green"></i> Kapat (Manuel Yap)';
      } else {
        badge.className = 'status-badge out-of-stock';
        badge.textContent = 'KAPALI (Sadece Manuel)';
        btn.innerHTML = '<i class="fa-solid fa-toggle-off"></i> Aç (Yapay Zekaya Ver)';
      }
    }
  } catch (e) {}
}

async function toggleAutoRewardSetting() {
  const badge = document.getElementById('autoRewardStatusBadge');
  if (!badge) return;

  const currentlyEnabled = badge.textContent.includes('AÇIK');
  const newValue = currentlyEnabled ? '0' : '1';

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'auto_vip_reward_enabled', value: newValue })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✅ Otomatik VIP Ödülü ayarı ${newValue === '1' ? 'AÇILDI' : 'KAPATILDI (Sadece Satıcı Manuel Ekler)'}`, 'success');
      loadAutoRewardSetting();
    }
  } catch (e) {
    showToast('Ayar değiştirilemedi.', 'error');
  }
}

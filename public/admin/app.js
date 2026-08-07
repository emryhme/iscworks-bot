// BARON'S SILLAGE Admin Control Panel Application Logic

const API_BASE = window.location.origin.includes('3000') || window.location.origin.includes('localhost') 
  ? window.location.origin 
  : 'http://localhost:3000';

const POLL_INTERVAL_MS = 3000; // 3 Saniyede Bir Canlı Arka Plan Kontrolü

// Global App State
const state = {
  products: [],
  orders: [],
  knownOrderIds: new Set(),
  activeTab: 'productsTab',
  searchQuery: '',
  soundEnabled: true,
  isInitialLoad: true
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
  openNewProductBtn: document.getElementById('openNewProductBtn'),
  syncStatusBadge: document.getElementById('syncStatusBadge'),
  
  // Tables
  productsTableBody: document.getElementById('productsTableBody'),
  ordersTableBody: document.getElementById('ordersTableBody'),
  productsTableCount: document.getElementById('productsTableCount'),
  ordersTableCount: document.getElementById('ordersTableCount'),
  
  // Form (7 Headers: KISA KOD, ÜRÜN KODU, ÜRÜN İSMİ, RENK, NUMARA, STOK, KATEGORİ)
  newProductForm: document.getElementById('newProductForm'),
  shortCode: document.getElementById('shortCode'),
  productCode: document.getElementById('productCode'),
  productName: document.getElementById('productName'),
  colorInput: document.getElementById('colorInput'),
  sizeInput: document.getElementById('sizeInput'),
  stockQuantity: document.getElementById('stockQuantity'),
  categoryInput: document.getElementById('categoryInput'),
  autoCodePreview: document.getElementById('autoCodePreview'),
  btnSubmitProduct: document.getElementById('btnSubmitProduct'),

  // Gemini AI Tab
  openAiTabBtn: document.getElementById('openAiTabBtn'),
  aiPromptInput: document.getElementById('aiPromptInput'),
  btnSubmitAiProduct: document.getElementById('btnSubmitAiProduct'),
  aiResultCard: document.getElementById('aiResultCard'),
  aiResultMessage: document.getElementById('aiResultMessage'),
  aiParsedGrid: document.getElementById('aiParsedGrid'),

  // Toast Container
  toastContainer: document.getElementById('toastContainer')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchData();

  // Otomatik Canlı Sipariş Takip Polling (Saniyeler İçinde Yenilemesiz Otomatik Düşer)
  setInterval(pollOrdersInBackground, POLL_INTERVAL_MS);
});

// Event Listeners Registration
function setupEventListeners() {
  // Tab Switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabTarget = tab.getAttribute('data-tab');
      switchTab(tabTarget);
    });
  });

  // Open New Product Tab from Quick Action
  if (elements.openNewProductBtn) {
    elements.openNewProductBtn.addEventListener('click', () => {
      switchTab('newProductTab');
    });
  }

  // Open AI Tab from Quick Action Card
  if (elements.openAiTabBtn) {
    elements.openAiTabBtn.addEventListener('click', () => {
      switchTab('aiProductTab');
    });
  }

  // Refresh Button
  if (elements.btnRefreshData) {
    elements.btnRefreshData.addEventListener('click', () => {
      const icon = elements.btnRefreshData.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      fetchData().finally(() => {
        if (icon) icon.classList.remove('fa-spin');
      });
    });
  }

  // Notification Sound Toggle & Permission
  if (elements.btnToggleSound) {
    elements.btnToggleSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      const icon = elements.btnToggleSound.querySelector('i');
      
      if (state.soundEnabled) {
        if (icon) icon.className = 'fa-solid fa-bell text-green';
        showToast('🔔 Sesli sipariş bildirimleri açıldı.', 'info');
        playNewOrderSound(); // Test sesi
        
        // Masaüstü Bildirim İzni İste
        if ('Notification' in window && Notification.permission !== 'granted') {
          Notification.requestPermission();
        }
      } else {
        if (icon) icon.className = 'fa-solid fa-bell-slash text-muted';
        showToast('🔕 Sesli sipariş bildirimleri sessize alındı.', 'info');
      }
    });
  }

  // Search Input
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderTables();
    });
  }

  // Auto Product Code Preview Listener
  const updateCodePreview = () => {
    const sc = (elements.shortCode.value || 'KGMLW').toUpperCase().trim();
    const sz = (elements.sizeInput.value || 'M').toUpperCase().trim();
    const computedCode = `${sc}-${sz}`;
    elements.autoCodePreview.textContent = `Önizleme: ${computedCode}`;
    if (!elements.productCode.value) {
      elements.productCode.placeholder = `Örn: ${computedCode}`;
    }
  };

  elements.shortCode.addEventListener('input', updateCodePreview);
  elements.sizeInput.addEventListener('input', updateCodePreview);

  // New Product Form Submission (Google Sheet Sync)
  elements.newProductForm.addEventListener('submit', handleNewProductSubmit);

  // Gemini AI Submission
  if (elements.btnSubmitAiProduct) {
    elements.btnSubmitAiProduct.addEventListener('click', handleAiProductSubmit);
  }
}

// Web Audio API Tabanlı Hoş İki Tonlu Sipariş Çanı (Ses Dosyası Gerektirmeyen Dahili Sentezleyici)
function playNewOrderSound() {
  if (!state.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 (Re)
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5 (La)

    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {
    console.warn('Audio synthesis error:', e);
  }
}

// Masaüstü (Tarayıcı) Bildirim Gönderimi
function triggerDesktopNotification(order) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification('🔔 YENİ SİPARİŞ GELDİ!', {
      body: `Müşteri: ${order.customerName}\nÜrün: ${order.productCode} (${order.quantity} Adet)`,
      icon: 'https://cdn-icons-png.flaticon.com/512/3144/3144456.png'
    });
  } catch (e) {
    console.warn('Desktop notification error:', e);
  }
}

// Switch Active Tab
function switchTab(tabId) {
  state.activeTab = tabId;

  elements.tabs.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  elements.tabContents.forEach(content => {
    if (content.id === tabId) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// Fetch Products & Orders from Backend API
async function fetchData() {
  setSyncStatus('loading', 'Senkronize Ediliyor...');

  try {
    const [stocksRes, ordersRes] = await Promise.all([
      fetch(`${API_BASE}/api/stocks`).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/orders`).then(r => r.json()).catch(() => null)
    ]);

    if (stocksRes && stocksRes.stocks) {
      state.products = stocksRes.stocks;
    } else {
      state.products = [];
    }

    if (ordersRes && ordersRes.orders) {
      processIncomingOrders(ordersRes.orders);
    } else {
      state.orders = [];
    }

    state.isInitialLoad = false;
    updateMetrics();
    renderTables();
    setSyncStatus('success', 'Live SQLite & Sheet Sync');

  } catch (error) {
    console.error('Fetch error:', error);
    setSyncStatus('error', 'Senkronizasyon Hatası');
    showToast('Backend sunucusuna bağlanılamadı.', 'error');
  }
}

// Arka Planda Sessiz ve Ultra Hızlı Canlı Sipariş Kontrolü (Polling)
async function pollOrdersInBackground() {
  try {
    const res = await fetch(`${API_BASE}/api/orders`);
    const data = await res.json();

    if (data && data.success && data.orders) {
      const newOrdersDetected = processIncomingOrders(data.orders);
      if (newOrdersDetected) {
        updateMetrics();
        renderTables();
      }
    }
  } catch (e) {
    // Arka plan kontrol hataları konsolu kirletmesin
  }
}

// Sipariş İşleme & Yeni Sipariş Bildirim Alarmı
function processIncomingOrders(newOrdersList) {
  let hasNew = false;

  for (const order of newOrdersList) {
    if (order.orderId && !state.knownOrderIds.has(order.orderId)) {
      state.knownOrderIds.add(order.orderId);

      // Sayfa ilk açılışta eski tüm siparişler için ses çalmasın
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

  elements.statTotalProducts.textContent = totalProducts.toLocaleString('tr-TR');
  elements.statTotalStock.textContent = totalStock.toLocaleString('tr-TR');
  elements.statTotalOrders.textContent = totalOrders.toLocaleString('tr-TR');
  elements.ordersBadgeCount.textContent = totalOrders;
}

// Render Products & Orders Tables
function renderTables() {
  renderProductsTable();
  renderOrdersTable();
}

// Render Products Table
function renderProductsTable() {
  const query = state.searchQuery;
  const filtered = state.products.filter(p => {
    const shortCode = (p.shortCode || '').toLowerCase();
    const code = (p.productCode || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    const color = (p.color || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    return shortCode.includes(query) || code.includes(query) || name.includes(query) || color.includes(query) || cat.includes(query);
  });

  elements.productsTableCount.textContent = `${filtered.length} ürün listelendi`;

  if (filtered.length === 0) {
    elements.productsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="loading-cell">
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
        <td>${stockBadge}</td>
        <td><small class="text-muted">${escapeHtml(p.category || '-')}</small></td>
        <td>
          <div class="action-btn-group">
            <button class="btn btn-sm btn-stock" onclick="updateProductStock('${escapeHtml(p.productCode)}', ${stock})">
              <i class="fa-solid fa-pen-to-square"></i> Stok Güncelle
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

// Render Orders Table
function renderOrdersTable() {
  const query = state.searchQuery;
  const filtered = state.orders.filter(o => {
    const id = (o.orderId || '').toLowerCase();
    const sender = (o.senderId || '').toLowerCase();
    const name = (o.customerName || '').toLowerCase();
    const phone = (o.customerPhone || '').toLowerCase();
    const code = (o.productCode || '').toLowerCase();
    const status = (o.status || '').toLowerCase();
    return id.includes(query) || sender.includes(query) || name.includes(query) || phone.includes(query) || code.includes(query) || status.includes(query);
  });

  elements.ordersTableCount.textContent = `${filtered.length} sipariş listelendi`;

  if (filtered.length === 0) {
    elements.ordersTableBody.innerHTML = `
      <tr>
        <td colspan="10" class="loading-cell">
          <i class="fa-solid fa-clipboard-list"></i> Henüz kayıtlı sipariş bulunmuyor.
        </td>
      </tr>
    `;
    return;
  }

  elements.ordersTableBody.innerHTML = filtered.map(o => {
    const rawStatus = (o.status || 'BEKLEMEDE').toUpperCase();
    let statusBadge = `<span class="status-badge pending"><i class="fa-solid fa-clock"></i> BEKLEMEDE</span>`;
    
    if (rawStatus === 'OK') {
      statusBadge = `<span class="status-badge ok"><i class="fa-solid fa-check-double"></i> OK</span>`;
    } else if (rawStatus === 'DEC') {
      statusBadge = `<span class="status-badge dec"><i class="fa-solid fa-xmark"></i> DEC</span>`;
    }

    const senderTag = o.senderId 
      ? `<span class="code-tag" style="font-size: 11px; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border-color: rgba(59, 130, 246, 0.3);"><i class="fa-solid fa-user-astronaut"></i> ${escapeHtml(o.senderId)}</span>`
      : `<span class="text-muted" style="font-size: 11px;">-</span>`;

    return `
      <tr>
        <td><span class="order-id-tag">${escapeHtml(o.orderId)}</span></td>
        <td>${senderTag}</td>
        <td><small class="text-muted">${escapeHtml(o.createdAt || 'Bugün')}</small></td>
        <td><strong>${escapeHtml(o.customerName)}</strong></td>
        <td><i class="fa-solid fa-phone text-muted" style="font-size: 11px;"></i> ${escapeHtml(o.customerPhone)}</td>
        <td><span class="code-tag">${escapeHtml(o.productCode)}</span></td>
        <td><strong>${o.quantity || 1}</strong> adet</td>
        <td><small class="text-muted">${escapeHtml(o.address || 'Belirtilmedi')}</small></td>
        <td>${statusBadge}</td>
        <td>
          <div class="action-btn-group">
            <button class="btn btn-sm btn-approve" onclick="updateOrderStatus('${escapeHtml(o.orderId)}', 'OK')" ${rawStatus === 'OK' ? 'disabled' : ''}>
              <i class="fa-solid fa-check"></i> Onayla (OK)
            </button>
            <button class="btn btn-sm btn-reject" onclick="updateOrderStatus('${escapeHtml(o.orderId)}', 'DEC')" ${rawStatus === 'DEC' ? 'disabled' : ''}>
              <i class="fa-solid fa-xmark"></i> Reddet (DEC)
            </button>
            <button class="btn btn-sm btn-delete" onclick="deleteOrder('${escapeHtml(o.orderId)}')">
              <i class="fa-solid fa-trash-can"></i> Sil
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Global Order Status Update Handler (OK / DEC)
window.updateOrderStatus = async function(orderId, status) {
  if (status === 'OK') {
    openConfirmModal(orderId);
    return;
  }

  await executeOrderStatusUpdate(orderId, status);
};

// Open Custom Order Approval Confirmation Modal (Emin Misin?)
function openConfirmModal(orderId) {
  const order = state.orders.find(o => o.orderId === orderId);
  const modal = document.getElementById('confirmModal');
  const body = document.getElementById('confirmModalBody');
  const btnAccept = document.getElementById('btnAcceptConfirm');
  const btnCancel = document.getElementById('btnCancelConfirm');

  if (!modal || !body || !btnAccept || !btnCancel) return;

  const custName = order ? order.customerName : 'Müşteri';
  const prodCode = order ? order.productCode : 'Ürün';
  const phone = order ? order.customerPhone : '-';
  const qty = order ? (order.quantity || 1) : 1;
  const address = order ? (order.address || 'Belirtilmedi') : 'Belirtilmedi';

  body.innerHTML = `
    <div style="margin-bottom: 8px;"><strong>Müşteri Adı:</strong> ${escapeHtml(custName)}</div>
    <div style="margin-bottom: 8px;"><strong>Sipariş Numarası:</strong> <span class="order-id-tag">${escapeHtml(orderId)}</span></div>
    <div style="margin-bottom: 8px;"><strong>Ürün Kodu:</strong> <span class="code-tag">${escapeHtml(prodCode)}</span> (${qty} Adet)</div>
    <div style="margin-bottom: 8px;"><strong>Müşteri Telefon:</strong> ${escapeHtml(phone)}</div>
    <div><strong>Teslimat Adresi:</strong> ${escapeHtml(address)}</div>
  `;

  modal.style.display = 'flex';

  const closeModal = () => {
    modal.style.display = 'none';
    btnAccept.onclick = null;
    btnCancel.onclick = null;
  };

  btnCancel.onclick = () => closeModal();

  btnAccept.onclick = async () => {
    closeModal();
    await executeOrderStatusUpdate(orderId, 'OK');
  };
}

// Execute Order Status Update API Call
async function executeOrderStatusUpdate(orderId, status) {
  setSyncStatus('loading', `Sipariş ${status} Yapılıyor...`);
  try {
    const res = await fetch(`${API_BASE}/api/orders/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status })
    });
    const data = await res.json();
    if (data.success) {
      if (status === 'OK') {
        showToast(`🎉 Sipariş (${orderId}) onaylandı ve alıcıya "Siparişiniz Onaylandı" mesajı yollandı!`, 'success');
      } else {
        showToast(`✅ Sipariş (${orderId}) '${status}' (Reddedildi) olarak güncellendi ve stok +1 iade edildi!`, 'info');
      }
      await fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Güncelleme başarısız'}`, 'error');
    }
  } catch (err) {
    console.error('Update status error:', err);
    showToast('Sunucu hatası.', 'error');
  } finally {
    setSyncStatus('success', 'Live SQLite & Sheet Sync');
  }
}

// Global Product Stock Update Handler
window.updateProductStock = async function(productCode, currentStock) {
  const input = prompt(`'${productCode}' ürünü için yeni stok miktarını giriniz:`, currentStock);
  if (input === null) return;

  const newStock = Number(input.trim());
  if (isNaN(newStock) || newStock < 0) {
    showToast('Geçerli bir stok miktarı giriniz.', 'error');
    return;
  }

  setSyncStatus('loading', 'Stok Güncelleniyor...');
  try {
    const res = await fetch(`${API_BASE}/api/products/update-stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productCode, newStock })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`📦 ${productCode} stoğu ${newStock} olarak güncellendi!`, 'success');
      await fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Stok güncelleme başarısız'}`, 'error');
    }
  } catch (err) {
    console.error('Update stock error:', err);
    showToast('Sunucu hatası.', 'error');
  } finally {
    setSyncStatus('success', 'Live SQLite & Sheet Sync');
  }
};

// Global Product Delete Handler
window.deleteProduct = async function(productCode) {
  if (!confirm(`'${productCode}' ürününü silmek istediğinize emin misiniz?`)) {
    return;
  }

  setSyncStatus('loading', 'Ürün Siliniyor...');
  try {
    const res = await fetch(`${API_BASE}/api/products/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productCode })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🗑️ ${productCode} ürünü silindi!`, 'success');
      await fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Silme işlemi başarısız'}`, 'error');
    }
  } catch (err) {
    console.error('Delete product error:', err);
    showToast('Sunucu hatası.', 'error');
  } finally {
    setSyncStatus('success', 'Live SQLite & Sheet Sync');
  }
};

// Global Order Delete Handler
window.deleteOrder = async function(orderId) {
  if (!confirm(`'${orderId}' numaralı siparişi silmek istediğinize emin misiniz?`)) {
    return;
  }

  setSyncStatus('loading', 'Sipariş Siliniyor...');
  try {
    const res = await fetch(`${API_BASE}/api/orders/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🗑️ Sipariş (${orderId}) silindi!`, 'success');
      await fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Silme işlemi başarısız'}`, 'error');
    }
  } catch (err) {
    console.error('Delete order error:', err);
    showToast('Sunucu hatası.', 'error');
  } finally {
    setSyncStatus('success', 'Live SQLite & Sheet Sync');
  }
};

// Handle Form Submission
async function handleNewProductSubmit(e) {
  e.preventDefault();

  const shortCode = elements.shortCode.value.trim().toUpperCase();
  const customCode = elements.productCode.value.trim().toUpperCase();
  const productName = elements.productName.value.trim();
  const color = elements.colorInput.value.trim();
  const size = elements.sizeInput.value.trim().toUpperCase();
  const stock = Number(elements.stockQuantity.value) || 0;
  const category = elements.categoryInput.value.trim();

  if (!shortCode || !productName || !size) {
    showToast('Lütfen KISA KOD, ÜRÜN İSMİ ve NUMARA alanlarını doldurunuz.', 'error');
    return;
  }

  const btn = elements.btnSubmitProduct;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...`;

  try {
    const payload = {
      shortCode,
      productCode: customCode || `${shortCode}-${size}`,
      name: productName,
      color,
      size,
      stock,
      category
    };

    const res = await fetch(`${API_BASE}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
      showToast(`✅ ${data.productCode} ürünü kaydedildi!`, 'success');
      elements.newProductForm.reset();
      elements.autoCodePreview.textContent = 'Önizleme: KGMLW-M';
      
      await fetchData();
      switchTab('productsTab');
    } else {
      showToast(`❌ Hata: ${data.error || 'Ürün ekleme başarısız.'}`, 'error');
    }

  } catch (error) {
    console.error('Submit error:', error);
    showToast('Sunucuya erişilirken hata oluştu.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Quick AI Prompt Setter
window.setAiPrompt = function(promptText) {
  if (elements.aiPromptInput) {
    elements.aiPromptInput.value = promptText;
  }
};

// Handle Gemini AI Product Generation Submit
async function handleAiProductSubmit() {
  const prompt = elements.aiPromptInput.value.trim();
  if (!prompt) {
    showToast('Lütfen yapay zekanın ayrıştırması için bir ürün tanım metni giriniz.', 'error');
    return;
  }

  const btn = elements.btnSubmitAiProduct;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Gemini AI Ürün Bilgilerini Çıkarıyor...`;

  setSyncStatus('loading', 'Gemini AI Çalışıyor...');
  if (elements.aiResultCard) elements.aiResultCard.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/ai/create-product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();
    if (data.success && data.products && data.products.length > 0) {
      const productsList = data.products;
      showToast(`✨ ${productsList.length} adet beden varyantı Gemini AI tarafından kaydedildi!`, 'success');
      
      if (elements.aiResultMessage) elements.aiResultMessage.textContent = data.message || `${productsList.length} ürün başarıyla eklendi.`;
      
      if (elements.aiParsedGrid) {
        elements.aiParsedGrid.innerHTML = productsList.map(p => `
          <div class="ai-field-chip" style="margin-bottom: 8px;">
            <span class="ai-field-label">ÜRÜN KODU: <strong class="text-purple">${escapeHtml(p.productCode)}</strong> | BEDEN: <strong class="size-pill">${escapeHtml(p.size)}</strong> | STOK: <strong class="text-green">${p.stock} adet</strong></span>
            <div style="font-size: 12px; margin-top: 4px;">
              <strong>${escapeHtml(p.name)}</strong> (Kısa Kod: ${escapeHtml(p.shortCode)}, Renk: ${escapeHtml(p.color)}, Kategori: ${escapeHtml(p.category)})
            </div>
          </div>
        `).join('');
      }
      if (elements.aiResultCard) elements.aiResultCard.style.display = 'block';

      await fetchData();
    } else {
      showToast(`❌ Hata: ${data.error || 'Gemini AI ürün oluşturamadı'}`, 'error');
    }
  } catch (err) {
    console.error('AI submit error:', err);
    showToast('Sunucu hatası.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    setSyncStatus('success', 'Live SQLite & Sheet Sync');
  }
}

// Sync Badge Helper
function setSyncStatus(type, text) {
  if (!elements.syncStatusBadge) return;
  const badge = elements.syncStatusBadge;
  const textSpan = badge.querySelector('span:not(.pulse-dot)');

  if (textSpan) textSpan.textContent = text;

  if (type === 'loading') {
    badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    badge.style.color = '#fbbf24';
  } else if (type === 'success') {
    badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    badge.style.color = '#34d399';
  } else {
    badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    badge.style.color = '#f87171';
  }
}

// Toast System Helper
function showToast(message, type = 'info') {
  if (!elements.toastContainer) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${escapeHtml(message).replace(/\n/g, '<br>')}</span>
  `;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Security HTML Sanitizer
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

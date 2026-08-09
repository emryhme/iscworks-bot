import express from 'express';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';
import { env } from './config/env';
import { WebhookController } from './controllers/webhook.controller';
import { OrderService } from './services/order.service';
import { StockService } from './services/stock.service';
import { AIService } from './services/ai.service';
import { GeminiService } from './services/gemini.service';
import { AdminCopilotService } from './services/admin-copilot.service';
import { FacebookService } from './services/facebook.service';
import { extractProductCode } from './utils/regex.util';
import { db, initDatabase, hashPassword, verifyPassword } from './database/db';
import { AuthMiddleware, AuthenticatedRequest } from './middleware/auth.middleware';

// Initialize Database & Migrations
initDatabase();

const app = express();

// Apply Global CORS Middleware
app.use(AuthMiddleware.cors);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 1. PUBLIC AUTHENTICATION ROUTES
// ==========================================

// Merchant User Registration
app.post('/api/auth/register', (req, res) => {
  try {
    const { fullName, tcNo, phone, email, storeName, plan, password } = req.body || {};
    if (!fullName || !tcNo || !phone || !email || !storeName || !password) {
      return res.status(400).json({ success: false, error: 'Lütfen tüm zorunlu alanları doldurun.' });
    }

    if (String(tcNo).length !== 11) {
      return res.status(400).json({ success: false, error: 'T.C. Kimlik Numarası 11 haneli olmalıdır.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanStoreName = String(storeName).trim();
    const storeSlug = cleanStoreName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `store-${Date.now()}`;

    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Bu E-Posta adresi ile zaten bir hesap veya başvuru mevcuttur.' });
    }

    const hashedPassword = hashPassword(String(password).trim());

    // Atomic transaction for Registration: user -> store -> membership -> merchant_applications
    let resultUser: any = null;
    let resultStore: any = null;

    db.transaction(() => {
      const userRes = db.prepare(`
        INSERT INTO users (full_name, email, phone, tc_no, password_hash, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(fullName, cleanEmail, phone, tcNo, hashedPassword);
      const userId = Number(userRes.lastInsertRowid);

      const storeRes = db.prepare(`
        INSERT INTO stores (owner_id, name, slug, status)
        VALUES (?, ?, ?, 'active')
      `).run(userId, cleanStoreName, storeSlug);
      const storeId = Number(storeRes.lastInsertRowid);

      db.prepare(`
        INSERT INTO memberships (user_id, store_id, role, status)
        VALUES (?, ?, 'OWNER', 'active')
      `).run(userId, storeId);

      db.prepare(`
        INSERT INTO merchant_applications (full_name, tc_no, phone, email, store_name, plan, password, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
      `).run(fullName, tcNo, phone, cleanEmail, cleanStoreName, plan || 'Pro Store', hashedPassword);

      resultUser = { id: userId, email: cleanEmail, name: fullName };
      resultStore = { id: storeId, name: cleanStoreName, slug: storeSlug };
      
      AuthMiddleware.logAudit(storeId, userId, 'REGISTER', 'users', String(userId), '', cleanEmail);
    })();

    const token = AuthMiddleware.generateToken({
      userId: resultUser.id,
      storeId: resultStore.id,
      role: 'OWNER',
      email: resultUser.email
    });

    return res.json({
      success: true,
      message: 'Kayıt ve mağaza kurulumu başarıyla tamamlandı.',
      token,
      user: {
        id: resultUser.id,
        email: resultUser.email,
        name: resultUser.name,
        storeId: resultStore.id,
        storeSlug: resultStore.slug,
        role: 'OWNER'
      }
    });
  } catch (err: any) {
    console.error('[Register Error]:', err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: 'Bu E-Posta veya mağaza adı kullanılmaktadır.' });
    }
    return res.status(500).json({ success: false, error: 'Kayıt esnasında sunucu hatası oluştu.' });
  }
});

// Merchant User Login
app.post('/api/auth/login', (req, res) => {
  const { username, email, password } = req.body || {};
  const cleanEmail = (email || username || '').trim().toLowerCase();
  const cleanPass = (password || '').trim();

  if (!cleanEmail || !cleanPass) {
    return res.status(400).json({ success: false, error: 'Kullanıcı adı/E-Posta ve şifre zorunludur.' });
  }

  // 1. Fetch user by email
  const user = db.prepare('SELECT id, full_name, email, password_hash, status FROM users WHERE LOWER(email) = ?').get(cleanEmail) as any;

  if (!user || !verifyPassword(cleanPass, user.password_hash)) {
    return res.status(401).json({ success: false, error: 'Geçersiz kullanıcı adı veya şifre.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ success: false, error: 'Hesabınız pasif durumdadır.' });
  }

  // 2. Fetch active memberships
  const memberships = db.prepare(`
    SELECT m.store_id, m.role, s.name as store_name, s.slug as store_slug, s.status as store_status
    FROM memberships m
    JOIN stores s ON s.id = m.store_id
    WHERE m.user_id = ? AND m.status = 'active' AND s.status = 'active'
    ORDER BY m.id ASC
  `).all(user.id) as any[];

  if (!memberships || memberships.length === 0) {
    return res.status(403).json({ success: false, error: 'Aktif bir mağaza üyeliğiniz bulunmamaktadır.' });
  }

  // Pick target store (or requested storeId if valid)
  const reqStoreId = Number(req.body?.storeId);
  let activeMem = memberships[0];
  if (reqStoreId) {
    const found = memberships.find(m => m.store_id === reqStoreId);
    if (found) activeMem = found;
  }

  const token = AuthMiddleware.generateToken({
    userId: user.id,
    storeId: activeMem.store_id,
    role: activeMem.role,
    email: user.email
  });

  AuthMiddleware.logAudit(activeMem.store_id, user.id, 'LOGIN', 'users', String(user.id), '', user.email);

  return res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name,
      storeId: activeMem.store_id,
      storeName: activeMem.store_name,
      storeSlug: activeMem.store_slug,
      role: activeMem.role
    }
  });
});

// Verify Auth Token Endpoint
app.get('/api/auth/verify', AuthMiddleware.authenticate, (req: AuthenticatedRequest, res) => {
  return res.json({ success: true, valid: true, user: req.auth });
});

// ==========================================
// 2. WEBHOOK ENDPOINTS (Stage 5 Security Rules)
// ==========================================
app.get('/webhook/instagram', WebhookController.verifyWebhook);
app.post('/webhook/instagram', WebhookController.handleWebhook);
app.get('/api/webhook/:storeSlug', WebhookController.verifyStoreWebhook);
app.post('/api/webhook/:storeSlug', WebhookController.handleStoreWebhook);

// Static Admin UI Server
app.use('/admin', express.static(path.join(__dirname, '../public/admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

app.use('/', (req, res, next) => {
  if (req.path === '/webhook/instagram' || req.path.startsWith('/webhook') || req.path.startsWith('/api')) {
    return next();
  }
  return next();
}, express.static(path.join(__dirname, '../public')));

// ==========================================
// 3. PROTECTED MERCHANT API ENDPOINTS (Authenticated & Scoped by req.auth.storeId)
// ==========================================

// --- PRODUCTS & STOCKS ---
app.get('/api/stocks', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req: AuthenticatedRequest, res) => {
  const storeId = req.auth!.storeId;
  const stocks = await StockService.getAllProducts(storeId);
  res.json({ success: true, stocks });
});

app.get('/api/stock/:code', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req: AuthenticatedRequest, res) => {
  const storeId = req.auth!.storeId;
  const result = await StockService.checkStock(storeId, String(req.params.code));
  res.json(result);
});

app.post('/api/products', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { shortCode, productCode, name, color, size, stock, price, category, storeName } = req.body || {};
    if (!shortCode || !name || !size) {
      return res.status(400).json({ success: false, error: 'Kısa kod, ürün ismi ve beden/numara alanları zorunludur.' });
    }

    const result = await StockService.addProduct({
      storeId,
      shortCode,
      productCode,
      name,
      color: color || 'Standart',
      size,
      stock: stock ? Number(stock) : 0,
      price: price ? Number(price) : 299,
      category: category || 'Genel',
      storeName: storeName || ''
    });

    if (result.success) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'ADD_PRODUCT', 'products', result.productCode || '');
      res.json({
        success: true,
        message: 'Ürün mağaza stok veritabanınıza başarıyla eklendi!',
        productCode: result.productCode
      });
    } else {
      res.status(500).json({ success: false, error: 'Ürün veritabanına kaydedilemedi.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

app.post('/api/products/price', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { productCode, price } = req.body;
    if (!productCode || price === undefined) {
      return res.status(400).json({ success: false, error: 'productCode ve price zorunludur.' });
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ success: false, error: 'Geçersiz fiyat.' });
    }

    const stmt = db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND (product_code = ? OR short_code = ?)');
    const result = stmt.run(numPrice, storeId, productCode, productCode);

    if (result.changes > 0) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'UPDATE_PRICE', 'products', productCode, '', String(numPrice));
      res.json({ success: true, message: `Ürün (${productCode}) fiyatı ${numPrice} TL olarak güncellendi.` });
    } else {
      res.status(404).json({ success: false, error: 'Ürün bu mağazada bulunamadı.' });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/products/bulk-update', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Güncellenecek veri listesi boş veya geçersiz.' });
    }

    const updatePriceStmt = db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND (product_code = ? OR short_code = ?)');
    const updateStockStmt = db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND (product_code = ? OR short_code = ?)');

    let updatedCount = 0;
    const bulkTransaction = db.transaction((items: any[]) => {
      for (const item of items) {
        if (item.productCode) {
          if (item.price !== undefined && !isNaN(Number(item.price))) {
            updatePriceStmt.run(Number(item.price), storeId, item.productCode, item.productCode);
            updatedCount++;
          }
          if (item.stock !== undefined && !isNaN(Number(item.stock))) {
            updateStockStmt.run(Number(item.stock), storeId, item.productCode, item.productCode);
            updatedCount++;
          }
        }
      }
    });

    bulkTransaction(updates);
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'BULK_UPDATE_PRODUCTS', 'products', `${updates.length} items`);

    res.json({ success: true, message: `${updates.length} adet ürünün fiyat ve stok verileri başarıyla kaydedildi!`, updatedCount });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/products/delete', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { productCode } = req.body;
    if (!productCode) {
      return res.status(400).json({ success: false, error: 'productCode parametresi gereklidir' });
    }

    const success = await StockService.deleteProduct(storeId, productCode);
    if (success) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'DELETE_PRODUCT', 'products', productCode);
      res.json({ success: true, message: `Ürün (${productCode}) silindi.` });
    } else {
      res.status(500).json({ success: false, error: 'Ürün silinemedi veya bulunamadı.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

app.post('/api/products/update-stock', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { productCode, newStock } = req.body;
    if (!productCode || newStock === undefined || newStock === null) {
      return res.status(400).json({ success: false, error: 'productCode ve newStock parametreleri gereklidir' });
    }

    const success = await StockService.updateStock(storeId, productCode, Number(newStock));
    if (success) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'UPDATE_STOCK', 'products', productCode, '', String(newStock));
      res.json({ success: true, message: `Ürün (${productCode}) stoğu ${newStock} olarak güncellendi.`, productCode, newStock: Number(newStock) });
    } else {
      res.status(500).json({ success: false, error: 'Ürün stoğu güncellenemedi.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// --- ORDERS ---
app.get('/api/orders', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req: AuthenticatedRequest, res) => {
  const storeId = req.auth!.storeId;
  const orders = await OrderService.getOrders(storeId);
  res.json({ success: true, count: orders.length, orders });
});

app.post('/api/orders/status', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { orderId, status, reason } = req.body;
    if (!orderId || !status || (status !== 'OK' && status !== 'DEC')) {
      return res.status(400).json({ success: false, error: 'orderId ve geçerli bir status (OK veya DEC) gereklidir' });
    }

    const success = await OrderService.updateOrderStatus(storeId, orderId, status, reason);
    if (success) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'UPDATE_ORDER_STATUS', 'orders', orderId, '', status);
      res.json({
        success: true,
        message: `Sipariş ${orderId} durumu '${status}' olarak güncellendi.`,
        orderId,
        status
      });
    } else {
      res.status(500).json({ success: false, error: 'Sipariş durumu güncellenemedi.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

app.post('/api/orders/delete', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId parametresi gereklidir' });
    }

    const success = await OrderService.deleteOrder(storeId, orderId);
    if (success) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'DELETE_ORDER', 'orders', orderId);
      res.json({ success: true, message: `Sipariş (${orderId}) silindi.` });
    } else {
      res.status(500).json({ success: false, error: 'Sipariş silinemedi.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// --- CAMPAIGNS ---
app.get('/api/campaigns', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const campaigns = db.prepare('SELECT * FROM campaigns WHERE store_id = ? ORDER BY id DESC').all(storeId);
    res.json({ success: true, campaigns });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/campaigns', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { title, description, code, discountPercent, discountAmount, minOrderAmount, startDate, endDate } = req.body;
    const stmt = db.prepare(`
      INSERT INTO campaigns (store_id, title, description, code, discount_percent, discount_amount, min_order_amount, start_date, end_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
      storeId,
      title, 
      description, 
      code || '', 
      discountPercent || 0, 
      discountAmount || 0, 
      minOrderAmount || 0,
      startDate || null,
      endDate || null
    );
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'CREATE_CAMPAIGN', 'campaigns', code || title);
    res.json({ success: true, message: 'Kampanya başarıyla oluşturuldu.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/campaigns/:id', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    db.prepare('DELETE FROM campaigns WHERE store_id = ? AND id = ?').run(storeId, String(req.params.id));
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'DELETE_CAMPAIGN', 'campaigns', String(req.params.id));
    res.json({ success: true, message: 'Kampanya silindi.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- SETTINGS ---
app.get('/api/settings', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const rows = db.prepare('SELECT * FROM settings WHERE store_id = ?').all(storeId) as any[];
    const settingsObj: Record<string, string> = {};
    for (const r of rows) {
      if (r && r.key) {
        settingsObj[r.key] = r.value || '';
      }
    }
    res.json({ success: true, settings: settingsObj, settingsList: rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message, settings: {} });
  }
});

app.post('/api/settings', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { key, value, settings, shippingFee, freeShippingThreshold } = req.body;
    
    if (key && value !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, ?, ?)').run(storeId, String(key), String(value));
    }
    if (shippingFee !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, "shipping_fee", ?)').run(storeId, String(shippingFee));
    }
    if (freeShippingThreshold !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, "free_shipping_threshold", ?)').run(storeId, String(freeShippingThreshold));
    }
    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) {
        db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, ?, ?)').run(storeId, String(k), String(v));
      }
    }

    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'UPDATE_SETTINGS', 'settings', 'all');
    res.json({ success: true, message: 'Ayarlar güncellendi.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- VIP REWARDS ---
app.get('/api/rewards', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const rewards = db.prepare(`
      SELECT id, sender_id as senderId, reward_code as rewardCode, discount_percent as discountPercent, min_qualifying_amount as minQualifyingAmount, is_used as isUsed, created_at as createdAt, used_at as usedAt
      FROM user_rewards
      WHERE store_id = ?
      ORDER BY id DESC
    `).all(storeId);
    res.json({ success: true, rewards });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/rewards', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { senderId, rewardCode, discountPercent, minQualifyingAmount } = req.body;
    if (!senderId || !discountPercent) {
      return res.status(400).json({ success: false, error: 'Müşteri ID ve İndirim Oranı zorunludur.' });
    }

    const sId = senderId.trim();
    const code = (rewardCode || 'YINEBEKLERIZ').trim().toUpperCase();
    const percent = Number(discountPercent) || 20;
    const minAmt = Number(minQualifyingAmount) || 2000;

    const stmt = db.prepare(`
      INSERT INTO user_rewards (store_id, sender_id, reward_code, discount_percent, min_qualifying_amount, is_used)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
    stmt.run(storeId, sId, code, percent, minAmt);

    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'CREATE_REWARD', 'user_rewards', sId);
    res.json({ success: true, message: `Müşteri (${sId}) için %${percent} VIP indirim tanımlandı.` });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/rewards/:id', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    db.prepare('DELETE FROM user_rewards WHERE store_id = ? AND id = ?').run(storeId, String(req.params.id));
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'DELETE_REWARD', 'user_rewards', String(req.params.id));
    res.json({ success: true, message: 'VIP Ödülü silindi.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- ADMIN COPILOT & AI PRODUCT CREATION ---
app.post('/api/ai/admin-copilot', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'Lütfen bir yönetim komutu yazınız.' });
    }

    const reply = await AdminCopilotService.processAdminCommand(prompt.trim(), storeId);
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'ADMIN_COPILOT_CMD', 'ai', prompt.substring(0, 50));
    res.json({ success: true, reply });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

app.post('/api/ai/create-product', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({ success: false, error: 'Lütfen ürün komut metni giriniz.' });
    }

    const result = await GeminiService.createProductFromPrompt(prompt.trim(), storeId);
    if (result.success && result.products && result.products.length > 0) {
      AuthMiddleware.logAudit(storeId, req.auth!.userId, 'AI_CREATE_PRODUCT', 'products', result.products[0]?.productCode || '');
      res.json({
        success: true,
        message: result.aiMessage || 'Ürün(ler) Gemini AI tarafından başarıyla oluşturuldu ve kaydedildi.',
        products: result.products,
        product: result.products[0]
      });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Gemini AI ile ürün oluşturulamadı.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Yapay zeka sunucu hatası' });
  }
});

// --- API KEYS MANAGEMENT (OWNER ONLY) ---
app.get('/api/api-keys', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const keys = db.prepare('SELECT id, name, permissions, created_at, last_used_at FROM api_keys WHERE store_id = ? ORDER BY id DESC').all(storeId);
    res.json({ success: true, keys });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/api-keys', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    const { name, permissions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'API key ismi zorunludur.' });
    }

    const rawKey = `isc_live_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    db.prepare(`
      INSERT INTO api_keys (store_id, name, key_hash, permissions, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(storeId, name.trim(), keyHash, permissions || 'read_write');

    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'CREATE_API_KEY', 'api_keys', name);
    res.json({ success: true, apiKey: rawKey, message: 'API Key oluşturuldu. Anahtarı güvenli yerde saklayın.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/api-keys/:id', AuthMiddleware.authenticate, AuthMiddleware.requireRole(['OWNER']), (req: AuthenticatedRequest, res) => {
  try {
    const storeId = req.auth!.storeId;
    db.prepare('DELETE FROM api_keys WHERE store_id = ? AND id = ?').run(storeId, String(req.params.id));
    AuthMiddleware.logAudit(storeId, req.auth!.userId, 'DELETE_API_KEY', 'api_keys', String(req.params.id));
    res.json({ success: true, message: 'API Key silindi.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Start Express Application Server
app.listen(env.port, () => {
  console.log(`
  🚀 iscworks bot - Enterprise Multi-Tenant RBAC Backend SUNUCUSU BAŞLATILDI!
  -----------------------------------------------------------------------
  🤖 Sistem Adı: iscworks bot (Stage 6 RBAC Secured)
  🌐 Port: ${env.port}
  🗄️ Database: SQLite (barons.db)
  🔐 Authentication: JWT HMAC-SHA256 & API Key DB Isolation
  📊 Admin API: http://localhost:${env.port}/api/orders
  -----------------------------------------------------------------------
  `);
});

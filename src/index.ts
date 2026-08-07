import express from 'express';
import path from 'path';
import axios from 'axios';
import { env } from './config/env';
import { WebhookController } from './controllers/webhook.controller';
import { OrderService } from './services/order.service';
import { StockService } from './services/stock.service';
import { AIService } from './services/ai.service';
import { GeminiService } from './services/gemini.service';
import { extractProductCode } from './utils/regex.util';
import { db, initDatabase } from './database/db';

// Veritabanını Uygulama Başlarken Anında Teyit Et
initDatabase();

const app = express();

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, bypass-tunnel-reminder');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Bypass-Tunnel-Reminder', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Basic Auth Middleware (Yönetim Koruması)
const ADMIN_USER = process.env.ADMIN_USER || 'tonystark';
const ADMIN_PASS = process.env.ADMIN_PASS || 'cintonik!';

const basicAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="iscworks bot Admin Panel"');
    return res.status(401).send('🔒 Yetkisiz Erişim: Lütfen patron kullanıcı adı ve şifrenizi girin.');
  }

  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];

  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="iscworks bot Admin Panel"');
    return res.status(401).send('❌ Hatalı kullanıcı adı veya şifre.');
  }
};

// Yönetim Paneli ve Dashboard (Şifreli)
app.use('/admin', basicAuth, express.static(path.join(__dirname, '../public/admin')));
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

app.use('/', (req, res, next) => {
  if (req.path === '/webhook/instagram' || req.path.startsWith('/webhook') || req.path.startsWith('/api')) {
    return next();
  }
  return basicAuth(req, res, next);
}, express.static(path.join(__dirname, '../public')));

// Müşteri Sadakat Ödülleri API (user_rewards)
app.get('/api/rewards', (req, res) => {
  try {
    const rewards = db.prepare(`
      SELECT id, sender_id as senderId, reward_code as rewardCode, discount_percent as discountPercent, min_qualifying_amount as minQualifyingAmount, is_used as isUsed, created_at as createdAt, used_at as usedAt
      FROM user_rewards
      ORDER BY id DESC
    `).all();
    res.json({ success: true, rewards });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

import { FacebookService } from './services/facebook.service';

app.post('/api/rewards', (req, res) => {
  try {
    const { senderId, rewardCode, discountPercent, minQualifyingAmount } = req.body;
    if (!senderId || !discountPercent) {
      return res.status(400).json({ success: false, error: 'Instagram/Müşteri ID ve İndirim Oranı zorunludur.' });
    }

    const sId = senderId.trim();
    const code = (rewardCode || 'YINEBEKLERIZ').trim().toUpperCase();
    const percent = Number(discountPercent) || 20;
    const minAmt = Number(minQualifyingAmount) || 2000;

    // Müşteri Adını Veritabanındaki Son Siparişinden Çek
    const lastOrder = db.prepare('SELECT first_name, last_name FROM orders WHERE sender_id = ? ORDER BY id DESC LIMIT 1').get(sId) as any;
    const customerNameDisplay = lastOrder ? `${lastOrder.first_name || ''} ${lastOrder.last_name || ''}`.trim() || 'Müşterimiz' : 'Müşterimiz';

    const stmt = db.prepare(`
      INSERT INTO user_rewards (sender_id, reward_code, discount_percent, min_qualifying_amount, is_used)
      VALUES (?, ?, ?, ?, 0)
    `);
    stmt.run(sId, code, percent, minAmt);

    const dmNotice = `🎉 TEBRİKLER / VIP ÖDÜL KAZANDINIZ!\nSayın ${customerNameDisplay}, instagram profilinize özel %${percent} VIP İNDİRİM tanımlanmıştır! (Ödül Kodu: ${code})\nBir sonraki siparişinizde bu indirim otomatik olarak uygulanacaktır. Keyifli alışverişler dileriz! 🎁✨`;

    // Müşteriye Instagram DM Bildirimi Gönder
    FacebookService.sendMessage(sId, dmNotice).catch(err => {
      console.error('[Manual Reward DM Error]:', err.message);
    });

    res.json({ success: true, message: `Müşteri (${sId}) için %${percent} VIP indirim tanımlandı.` });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/rewards/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM user_rewards WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'VIP Ödülü silindi.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Kampanyalar GET API
app.get('/api/campaigns', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
    res.json({ success: true, campaigns });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/campaigns', (req, res) => {
  try {
    const { title, description, code, discountPercent, discountAmount, minOrderAmount, startDate, endDate } = req.body;
    const stmt = db.prepare(`
      INSERT INTO campaigns (title, description, code, discount_percent, discount_amount, min_order_amount, start_date, end_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
      title, 
      description, 
      code || '', 
      discountPercent || 0, 
      discountAmount || 0, 
      minOrderAmount || 0,
      startDate || null,
      endDate || null
    );
    res.json({ success: true, message: 'Kampanya başarıyla oluşturuldu.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/campaigns/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Kampanya silindi.' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Sistem Ayarları & Kargo Fiyatı API
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all() as any[];
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

app.post('/api/settings', (req, res) => {
  try {
    const { key, value, settings, shippingFee, freeShippingThreshold } = req.body;
    
    if (key && value !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(String(key), String(value));
    }
    if (shippingFee !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES ("shipping_fee", ?)').run(String(shippingFee));
    }
    if (freeShippingThreshold !== undefined) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES ("free_shipping_threshold", ?)').run(String(freeShippingThreshold));
    }
    if (settings && typeof settings === 'object') {
      for (const [k, v] of Object.entries(settings)) {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(String(k), String(v));
      }
    }

    res.json({ success: true, message: 'Ayarlar güncellendi.' });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

import { AdminCopilotService } from './services/admin-copilot.service';

// Admin Copilot Chat Endpoint
app.post('/api/ai/admin-copilot', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'Lütfen bir yönetim komutu yazınız.' });
    }

    const reply = await AdminCopilotService.processAdminCommand(prompt.trim());
    res.json({ success: true, reply });
  } catch (err: any) {
    console.error('[API /api/ai/admin-copilot Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Web Chat & Simulator API End-point'i
app.post('/api/chat', async (req, res) => {
  const { senderId, message } = req.body;
  if (!senderId || !message) {
    return res.status(400).json({ error: 'senderId and message required' });
  }

  const result = await AIService.processMessage(senderId, message);
  res.json({ success: true, reply: result.reply, tokens: result.tokens });
});

// n8n Entegrasyon Uç Noktası (Instagram Meta -> n8n -> Backend)
app.post('/api/n8n/chat', async (req, res) => {
  try {
    const { senderId, message, attachmentTitle, callbackUrl } = req.body;
    if (!senderId) {
      return res.status(400).json({ success: false, error: 'senderId parametresi zorunludur' });
    }

    let finalMessage = message || '';
    if (attachmentTitle) {
      const extractedCode = extractProductCode(attachmentTitle);
      if (extractedCode) {
        finalMessage = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen ürünün stok durumunu, beden seçeneklerini kontrol ederek müşteriye yardımcı ol.`;
      }
    }

    if (!finalMessage) {
      return res.status(400).json({ success: false, error: 'message veya attachmentTitle parametresi zorunludur' });
    }

    // Eğer callbackUrl verilmişse (Asenkron Webhook Modu)
    if (callbackUrl) {
      res.json({ success: true, status: 'processing', message: 'Yanıt hazırlanıyor, Webhook adresine yollanacak.' });

      // Arka planda AI yanıtını üretip Webhook'a yolla
      AIService.processMessage(senderId, finalMessage).then(result => {
        axios.post(callbackUrl, {
          success: true,
          senderId,
          reply: result.reply,
          tokens: result.tokens
        }).catch((err: any) => console.error('[Webhook Callback Error]:', err.message));
      }).catch((err: any) => console.error('[AI Processing Error]:', err.message));

      return;
    }

    // Senkron Yanıt Modu (Standart)
    const result = await AIService.processMessage(senderId, finalMessage);
    res.json({
      success: true,
      senderId,
      reply: result.reply,
      tokens: result.tokens
    });
  } catch (err: any) {
    console.error('[API /api/n8n/chat Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Webhook End-point'leri
app.get('/webhook/instagram', WebhookController.verifyWebhook);
app.post('/webhook/instagram', WebhookController.handleWebhook);

// Admin API End-point'leri (Siparişleri Görme & Stok Listesi)
app.get('/api/orders', async (req, res) => {
  const orders = await OrderService.getOrders();
  res.json({ success: true, count: orders.length, orders });
});

app.get('/api/stocks', async (req, res) => {
  const stocks = await StockService.getAllProducts();
  res.json({ success: true, stocks });
});

app.get('/api/stock/:code', async (req, res) => {
  const result = await StockService.checkStock(req.params.code);
  res.json(result);
});

// Yeni Ürün Ekleme (Google Sheet Senkronizasyonu)
app.post('/api/products', async (req, res) => {
  try {
    const { shortCode, productCode, name, color, size, stock, category } = req.body;
    if (!shortCode || !name || !size) {
      return res.status(400).json({ success: false, error: 'Kısa kod, ürün ismi ve numara alanları zorunludur' });
    }

    const result = await StockService.addProduct({
      shortCode,
      productCode,
      name,
      color,
      size,
      stock: stock ? Number(stock) : 0,
      category
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Ürün Google Sheets stok tablosuna başarıyla kaydedildi!',
        productCode: result.productCode
      });
    } else {
      res.status(500).json({ success: false, error: 'Google Sheets stok tablosuna kaydedilemedi' });
    }
  } catch (err: any) {
    console.error('[API /api/products Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Ürün Fiyatı Güncelleme (SQLite & Admin Panel)
app.post('/api/products/price', (req, res) => {
  try {
    const { productCode, price } = req.body;
    if (!productCode || price === undefined) {
      return res.status(400).json({ success: false, error: 'productCode ve price zorunludur.' });
    }

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 0) {
      return res.status(400).json({ success: false, error: 'Geçersiz fiyat.' });
    }

    const stmt = db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');
    const result = stmt.run(numPrice, productCode, productCode);

    if (result.changes > 0) {
      res.json({ success: true, message: `Ürün (${productCode}) fiyatı ${numPrice} TL olarak güncellendi.` });
    } else {
      res.status(404).json({ success: false, error: 'Ürün bulunamadı.' });
    }
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
// Toplu Fiyat ve Stok Güncelleme (Bulk Save API)
app.post('/api/products/bulk-update', (req, res) => {
  try {
    const { updates } = req.body; // Array<{ productCode: string, stock?: number, price?: number }>
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'Güncellenecek veri listesi boş veya geçersiz.' });
    }

    const updatePriceStmt = db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');
    const updateStockStmt = db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');

    let updatedCount = 0;
    const bulkTransaction = db.transaction((items: any[]) => {
      for (const item of items) {
        if (item.productCode) {
          if (item.price !== undefined && !isNaN(Number(item.price))) {
            updatePriceStmt.run(Number(item.price), item.productCode, item.productCode);
            updatedCount++;
          }
          if (item.stock !== undefined && !isNaN(Number(item.stock))) {
            updateStockStmt.run(Number(item.stock), item.productCode, item.productCode);
            updatedCount++;
          }
        }
      }
    });

    bulkTransaction(updates);

    res.json({ success: true, message: `${updates.length} adet ürünün fiyat ve stok verileri başarıyla kaydedildi!`, updatedCount });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Sipariş Onay / Red İşlemi (Google Sheet DURUM = OK veya DEC güncellemesi)
app.post('/api/orders/status', async (req, res) => {
  try {
    const { orderId, status, reason } = req.body;
    if (!orderId || !status || (status !== 'OK' && status !== 'DEC')) {
      return res.status(400).json({ success: false, error: 'orderId ve geçerli bir status (OK veya DEC) gereklidir' });
    }

    const success = await OrderService.updateOrderStatus(orderId, status, reason);
    if (success) {
      res.json({
        success: true,
        message: `Sipariş ${orderId} durumu '${status}' olarak güncellendi.`,
        orderId,
        status
      });
    } else {
      res.status(500).json({ success: false, error: 'Sipariş durumu veritabanında güncellenemedi.' });
    }
  } catch (err: any) {
    console.error('[API /api/orders/status Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Ürün Silme API
app.post('/api/products/delete', async (req, res) => {
  try {
    const { productCode } = req.body;
    if (!productCode) {
      return res.status(400).json({ success: false, error: 'productCode parametresi gereklidir' });
    }

    const success = await StockService.deleteProduct(productCode);
    if (success) {
      res.json({ success: true, message: `Ürün (${productCode}) Google Sheets stok tablosundan silindi.` });
    } else {
      res.status(500).json({ success: false, error: 'Ürün Google Sheets stok tablosundan silinemedi.' });
    }
  } catch (err: any) {
    console.error('[API /api/products/delete Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Sipariş Silme API
app.post('/api/orders/delete', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'orderId parametresi gereklidir' });
    }

    const success = await OrderService.deleteOrder(orderId);
    if (success) {
      res.json({ success: true, message: `Sipariş (${orderId}) Google Sheets siparişler tablosundan silindi.` });
    } else {
      res.status(500).json({ success: false, error: 'Sipariş Google Sheets siparişler tablosundan silinemedi.' });
    }
  } catch (err: any) {
    console.error('[API /api/orders/delete Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Ürün Stok Güncelleme API
app.post('/api/products/update-stock', async (req, res) => {
  try {
    const { productCode, newStock } = req.body;
    if (!productCode || newStock === undefined || newStock === null) {
      return res.status(400).json({ success: false, error: 'productCode ve newStock parametreleri gereklidir' });
    }

    const success = await StockService.updateStock(productCode, Number(newStock));
    if (success) {
      res.json({ success: true, message: `Ürün (${productCode}) stoğu ${newStock} olarak güncellendi.`, productCode, newStock: Number(newStock) });
    } else {
      res.status(500).json({ success: false, error: 'Ürün stoğu Google Sheets üzerinde güncellenemedi.' });
    }
  } catch (err: any) {
    console.error('[API /api/products/update-stock Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
  }
});

// Google Gemini AI İle Akıllı Ürün Ekleme API (Çoklu Beden / Batch Destekli)
app.post('/api/ai/create-product', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({ success: false, error: 'Lütfen ürün komut metni giriniz.' });
    }

    const result = await GeminiService.createProductFromPrompt(prompt.trim());
    if (result.success && result.products && result.products.length > 0) {
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
    console.error('[API /api/ai/create-product Error]:', err);
    res.status(500).json({ success: false, error: err.message || 'Yapay zeka sunucu hatası' });
  }
});

// Sunucuyu Başlat
app.listen(env.port, () => {
  console.log(`
  🚀 iscworks bot - Enterprise AI Backend Sunucusu Başlatıldı!
  -------------------------------------------------------------
  🤖 Sistem Adı: iscworks bot
  🌐 Port: ${env.port}
  🗄️ Database: SQLite (barons.db)
  📩 n8n Cloud API: http://localhost:${env.port}/api/n8n/chat
  📊 Admin API: http://localhost:${env.port}/api/orders
  🎛️ Admin Panel: http://localhost:${env.port}/admin
  -------------------------------------------------------------
  `);
});

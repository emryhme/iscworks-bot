"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const env_1 = require("./config/env");
const webhook_controller_1 = require("./controllers/webhook.controller");
const order_service_1 = require("./services/order.service");
const stock_service_1 = require("./services/stock.service");
const ai_service_1 = require("./services/ai.service");
const gemini_service_1 = require("./services/gemini.service");
const regex_util_1 = require("./utils/regex.util");
const db_1 = require("./database/db");
// Veritabanını Uygulama Başlarken Anında Teyit Et
(0, db_1.initDatabase)();
const app = (0, express_1.default)();
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
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
const db_2 = require("./database/db");
// AUTH API REST ENDPOINTS (SQLite Database Persistence)
app.post('/api/auth/register', (req, res) => {
    try {
        const { fullName, tcNo, phone, email, storeName, plan, password } = req.body || {};
        if (!fullName || !tcNo || !phone || !email || !storeName || !password) {
            return res.status(400).json({ success: false, error: 'Lütfen tüm zorunlu alanları doldurun.' });
        }
        if (tcNo.length !== 11) {
            return res.status(400).json({ success: false, error: 'T.C. Kimlik Numarası 11 haneli olmalıdır.' });
        }
        const hashedPassword = (0, db_2.hashPassword)(password);
        (0, db_2.createMerchantApplication)({ fullName, tcNo, phone, email, storeName, plan, password: hashedPassword });
        return res.json({ success: true, message: 'Başvuru veritabanına başarıyla kaydedildi.' });
    }
    catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, error: 'Bu E-Posta adresi ile zaten bir başvuru mevcut.' });
        }
        return res.status(500).json({ success: false, error: 'Veritabanı kayıt hatası oluştu.' });
    }
});
app.get('/api/admin/applications', (req, res) => {
    try {
        const applications = (0, db_2.getAllMerchantApplications)();
        return res.json({ success: true, applications });
    }
    catch (err) {
        return res.status(500).json({ success: false, applications: [] });
    }
});
app.post('/api/admin/applications/:id/approve', (req, res) => {
    try {
        const target = req.body?.email || req.body?.storeName || req.params.id;
        (0, db_2.approveMerchantApplication)(target);
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ success: false, error: 'Onaylama hatası' });
    }
});
app.post('/api/admin/applications/:id/reject', (req, res) => {
    try {
        const target = req.body?.email || req.body?.storeName || req.params.id;
        (0, db_2.rejectMerchantApplication)(target);
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ success: false, error: 'Reddetme hatası' });
    }
});
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();
    const ADMIN_USER = (process.env.ADMIN_USER || 'tonystark').toLowerCase();
    const ADMIN_PASS = process.env.ADMIN_PASS || 'cintonik!';
    const isUserValid = (cleanUser === ADMIN_USER || cleanUser === 'admin' || cleanUser === 'emre@iscworks.com' || cleanUser === 'iscenkalemre');
    const isPassValid = (cleanPass === ADMIN_PASS || cleanPass === 'cintonik!' || cleanPass === 'barons2026!');
    if (isUserValid && isPassValid) {
        const token = 'session_barons_' + Date.now() + '_' + Math.random().toString(36).substring(2);
        return res.json({
            success: true,
            token: token,
            user: {
                username: 'tonystark',
                name: 'Tony Stark',
                title: 'Mağaza Sahibi (Patron)',
                role: 'Administrator'
            }
        });
    }
    try {
        const userPrefix = cleanUser.split('@')[0];
        let dbApp = (0, db_2.findMerchantApplicationByIdentifier)(cleanUser);
        if (!dbApp && userPrefix) {
            dbApp = (0, db_2.findMerchantApplicationByIdentifier)(userPrefix);
        }
        if (dbApp) {
            if (!(0, db_2.verifyPassword)(cleanPass, dbApp.password)) {
                return res.status(401).json({ success: false, error: '❌ Hatalı kullanıcı adı veya şifre!' });
            }
            if (dbApp.status === 'pending') {
                return res.status(403).json({
                    success: false,
                    pending: true,
                    error: '⏳ Hesabınız henüz onay aşamasındadır. Yöneticilerimiz tarafından onaylandıktan sonra giriş yapabilirsiniz.'
                });
            }
            if (dbApp.status === 'rejected') {
                return res.status(403).json({
                    success: false,
                    error: '❌ Hesabınız reddedilmiştir. Lütfen destek ekibi ile iletişime geçin.'
                });
            }
            if (dbApp.status === 'approved') {
                const token = 'session_barons_' + Date.now() + '_' + Math.random().toString(36).substring(2);
                return res.json({
                    success: true,
                    token: token,
                    user: {
                        username: dbApp.email,
                        name: dbApp.full_name,
                        title: dbApp.store_name,
                        role: 'Merchant'
                    }
                });
            }
        }
    }
    catch (err) { }
    return res.status(401).json({ success: false, error: '❌ Hatalı kullanıcı adı veya şifre!' });
});
app.get('/api/auth/verify', (req, res) => {
    return res.json({ success: true, valid: true });
});
// Yönetim Paneli ve Static Sunucu (Login Esnek Sunumu)
app.use('/admin', express_1.default.static(path_1.default.join(__dirname, '../public/admin')));
app.get('/admin', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/admin/index.html'));
});
app.use('/', (req, res, next) => {
    if (req.path === '/webhook/instagram' || req.path.startsWith('/webhook') || req.path.startsWith('/api')) {
        return next();
    }
    return next();
}, express_1.default.static(path_1.default.join(__dirname, '../public')));
// Müşteri Sadakat Ödülleri API (user_rewards)
app.get('/api/rewards', (req, res) => {
    try {
        const rewards = db_1.db.prepare(`
      SELECT id, sender_id as senderId, reward_code as rewardCode, discount_percent as discountPercent, min_qualifying_amount as minQualifyingAmount, is_used as isUsed, created_at as createdAt, used_at as usedAt
      FROM user_rewards
      ORDER BY id DESC
    `).all();
        res.json({ success: true, rewards });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
const facebook_service_1 = require("./services/facebook.service");
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
        const lastOrder = db_1.db.prepare('SELECT first_name, last_name FROM orders WHERE sender_id = ? ORDER BY id DESC LIMIT 1').get(sId);
        const customerNameDisplay = lastOrder ? `${lastOrder.first_name || ''} ${lastOrder.last_name || ''}`.trim() || 'Müşterimiz' : 'Müşterimiz';
        const stmt = db_1.db.prepare(`
      INSERT INTO user_rewards (sender_id, reward_code, discount_percent, min_qualifying_amount, is_used)
      VALUES (?, ?, ?, ?, 0)
    `);
        stmt.run(sId, code, percent, minAmt);
        const dmNotice = `🎉 TEBRİKLER / VIP ÖDÜL KAZANDINIZ!\nSayın ${customerNameDisplay}, instagram profilinize özel %${percent} VIP İNDİRİM tanımlanmıştır! (Ödül Kodu: ${code})\nBir sonraki siparişinizde bu indirim otomatik olarak uygulanacaktır. Keyifli alışverişler dileriz! 🎁✨`;
        // Müşteriye Instagram DM Bildirimi Gönder
        facebook_service_1.FacebookService.sendMessage(sId, dmNotice).catch(err => {
            console.error('[Manual Reward DM Error]:', err.message);
        });
        res.json({ success: true, message: `Müşteri (${sId}) için %${percent} VIP indirim tanımlandı.` });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.delete('/api/rewards/:id', (req, res) => {
    try {
        db_1.db.prepare('DELETE FROM user_rewards WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'VIP Ödülü silindi.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// Kampanyalar GET API
app.get('/api/campaigns', (req, res) => {
    try {
        const campaigns = db_1.db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
        res.json({ success: true, campaigns });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/campaigns', (req, res) => {
    try {
        const { title, description, code, discountPercent, discountAmount, minOrderAmount, startDate, endDate } = req.body;
        const stmt = db_1.db.prepare(`
      INSERT INTO campaigns (title, description, code, discount_percent, discount_amount, min_order_amount, start_date, end_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
        stmt.run(title, description, code || '', discountPercent || 0, discountAmount || 0, minOrderAmount || 0, startDate || null, endDate || null);
        res.json({ success: true, message: 'Kampanya başarıyla oluşturuldu.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.delete('/api/campaigns/:id', (req, res) => {
    try {
        db_1.db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: 'Kampanya silindi.' });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Sistem Ayarları & Kargo Fiyatı API
app.get('/api/settings', (req, res) => {
    try {
        const rows = db_1.db.prepare('SELECT * FROM settings').all();
        const settingsObj = {};
        for (const r of rows) {
            if (r && r.key) {
                settingsObj[r.key] = r.value || '';
            }
        }
        res.json({ success: true, settings: settingsObj, settingsList: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message, settings: {} });
    }
});
app.post('/api/settings', (req, res) => {
    try {
        const { key, value, settings, shippingFee, freeShippingThreshold } = req.body;
        if (key && value !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(String(key), String(value));
        }
        if (shippingFee !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES ("shipping_fee", ?)').run(String(shippingFee));
        }
        if (freeShippingThreshold !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES ("free_shipping_threshold", ?)').run(String(freeShippingThreshold));
        }
        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) {
                db_1.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(String(k), String(v));
            }
        }
        res.json({ success: true, message: 'Ayarlar güncellendi.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
const admin_copilot_service_1 = require("./services/admin-copilot.service");
// Admin Copilot Chat Endpoint
app.post('/api/ai/admin-copilot', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, error: 'Lütfen bir yönetim komutu yazınız.' });
        }
        const reply = await admin_copilot_service_1.AdminCopilotService.processAdminCommand(prompt.trim());
        res.json({ success: true, reply });
    }
    catch (err) {
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
    const result = await ai_service_1.AIService.processMessage(senderId, message);
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
            const extractedCode = (0, regex_util_1.extractProductCode)(attachmentTitle);
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
            ai_service_1.AIService.processMessage(senderId, finalMessage).then(result => {
                axios_1.default.post(callbackUrl, {
                    success: true,
                    senderId,
                    reply: result.reply,
                    tokens: result.tokens
                }).catch((err) => console.error('[Webhook Callback Error]:', err.message));
            }).catch((err) => console.error('[AI Processing Error]:', err.message));
            return;
        }
        // Senkron Yanıt Modu (Standart)
        const result = await ai_service_1.AIService.processMessage(senderId, finalMessage, 'default', 1);
        res.json({
            success: true,
            senderId,
            reply: result.reply,
            tokens: result.tokens
        });
    }
    catch (err) {
        console.error('[API /api/n8n/chat Error]:', err);
        res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
// Webhook End-point'leri (Genel & Mağazaya Özel İzole Webhook'lar)
app.get('/webhook/instagram', webhook_controller_1.WebhookController.verifyWebhook);
app.post('/webhook/instagram', webhook_controller_1.WebhookController.handleWebhook);
// Multi-Tenant Per-Store Webhook Endpoints (/api/webhook/:storeSlug)
app.get('/api/webhook/:storeSlug', webhook_controller_1.WebhookController.verifyStoreWebhook);
app.post('/api/webhook/:storeSlug', webhook_controller_1.WebhookController.handleStoreWebhook);
// Admin API End-point'leri (Siparişleri Görme & Stok Listesi)
app.get('/api/orders', async (req, res) => {
    const orders = await order_service_1.OrderService.getOrders(1);
    res.json({ success: true, count: orders.length, orders });
});
app.get('/api/stocks', async (req, res) => {
    const stocks = await stock_service_1.StockService.getAllProducts(1);
    res.json({ success: true, stocks });
});
app.get('/api/stock/:code', async (req, res) => {
    const result = await stock_service_1.StockService.checkStock(1, req.params.code);
    res.json(result);
});
// Yeni Ürün Ekleme (SQLite Veritabanı & Mağaza İzolasyonu)
app.post('/api/products', async (req, res) => {
    try {
        const { shortCode, productCode, name, color, size, stock, price, category, storeName } = req.body || {};
        if (!shortCode || !name || !size) {
            return res.status(400).json({ success: false, error: 'Kısa kod, ürün ismi ve beden/numara alanları zorunludur.' });
        }
        const result = await stock_service_1.StockService.addProduct({
            storeId: 1,
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
            res.json({
                success: true,
                message: 'Ürün mağaza stok veritabanınıza başarıyla eklendi!',
                productCode: result.productCode
            });
        }
        else {
            res.status(500).json({ success: false, error: 'Ürün veritabanına kaydedilemedi.' });
        }
    }
    catch (err) {
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
        const stmt = db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');
        const result = stmt.run(numPrice, productCode, productCode);
        if (result.changes > 0) {
            res.json({ success: true, message: `Ürün (${productCode}) fiyatı ${numPrice} TL olarak güncellendi.` });
        }
        else {
            res.status(404).json({ success: false, error: 'Ürün bulunamadı.' });
        }
    }
    catch (e) {
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
        const updatePriceStmt = db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');
        const updateStockStmt = db_1.db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ? OR short_code = ?');
        let updatedCount = 0;
        const bulkTransaction = db_1.db.transaction((items) => {
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
    }
    catch (e) {
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
        const success = await order_service_1.OrderService.updateOrderStatus(1, orderId, status, reason);
        if (success) {
            res.json({
                success: true,
                message: `Sipariş ${orderId} durumu '${status}' olarak güncellendi.`,
                orderId,
                status
            });
        }
        else {
            res.status(500).json({ success: false, error: 'Sipariş durumu veritabanında güncellenemedi.' });
        }
    }
    catch (err) {
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
        const success = await stock_service_1.StockService.deleteProduct(1, productCode);
        if (success) {
            res.json({ success: true, message: `Ürün (${productCode}) Google Sheets stok tablosundan silindi.` });
        }
        else {
            res.status(500).json({ success: false, error: 'Ürün Google Sheets stok tablosundan silinemedi.' });
        }
    }
    catch (err) {
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
        const success = await order_service_1.OrderService.deleteOrder(1, orderId);
        if (success) {
            res.json({ success: true, message: `Sipariş (${orderId}) Google Sheets siparişler tablosundan silindi.` });
        }
        else {
            res.status(500).json({ success: false, error: 'Sipariş Google Sheets siparişler tablosundan silinemedi.' });
        }
    }
    catch (err) {
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
        const success = await stock_service_1.StockService.updateStock(productCode, Number(newStock));
        if (success) {
            res.json({ success: true, message: `Ürün (${productCode}) stoğu ${newStock} olarak güncellendi.`, productCode, newStock: Number(newStock) });
        }
        else {
            res.status(500).json({ success: false, error: 'Ürün stoğu Google Sheets üzerinde güncellenemedi.' });
        }
    }
    catch (err) {
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
        const result = await gemini_service_1.GeminiService.createProductFromPrompt(prompt.trim());
        if (result.success && result.products && result.products.length > 0) {
            res.json({
                success: true,
                message: result.aiMessage || 'Ürün(ler) Gemini AI tarafından başarıyla oluşturuldu ve kaydedildi.',
                products: result.products,
                product: result.products[0]
            });
        }
        else {
            res.status(500).json({ success: false, error: result.error || 'Gemini AI ile ürün oluşturulamadı.' });
        }
    }
    catch (err) {
        console.error('[API /api/ai/create-product Error]:', err);
        res.status(500).json({ success: false, error: err.message || 'Yapay zeka sunucu hatası' });
    }
});
// Sunucuyu Başlat
app.listen(env_1.env.port, () => {
    console.log(`
  🚀 iscworks bot - Enterprise AI Backend Sunucusu Başlatıldı!
  -------------------------------------------------------------
  🤖 Sistem Adı: iscworks bot
  🌐 Port: ${env_1.env.port}
  🗄️ Database: SQLite (barons.db)
  📩 n8n Cloud API: http://localhost:${env_1.env.port}/api/n8n/chat
  📊 Admin API: http://localhost:${env_1.env.port}/api/orders
  🎛️ Admin Panel: http://localhost:${env_1.env.port}/admin
  -------------------------------------------------------------
  `);
});

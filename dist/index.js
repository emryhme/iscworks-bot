"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("./config/env");
const webhook_controller_1 = require("./controllers/webhook.controller");
const order_service_1 = require("./services/order.service");
const stock_service_1 = require("./services/stock.service");
const gemini_service_1 = require("./services/gemini.service");
const admin_copilot_service_1 = require("./services/admin-copilot.service");
const db_1 = require("./database/db");
const auth_middleware_1 = require("./middleware/auth.middleware");
// Initialize Database & Migrations
(0, db_1.initDatabase)();
const app = (0, express_1.default)();
// Apply Global CORS Middleware
app.use(auth_middleware_1.AuthMiddleware.cors);
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
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
        const cleanTcNo = String(tcNo).trim();
        if (cleanTcNo.length !== 11 || !/^\d{11}$/.test(cleanTcNo)) {
            return res.status(400).json({ success: false, error: 'T.C. Kimlik Numarası tam 11 haneli olmalıdır.' });
        }
        const cleanEmail = String(email).trim().toLowerCase();
        const cleanStoreName = String(storeName).trim();
        const storeSlug = cleanStoreName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `store-${Date.now()}`;
        // 1. Check existing Email
        const existingUser = db_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
        if (existingUser) {
            return res.status(400).json({ success: false, error: 'Bu E-Posta adresi ile zaten bir hesap veya başvuru mevcuttur.' });
        }
        // 2. Check existing TC No
        const existingTc = db_1.db.prepare('SELECT id FROM users WHERE tc_no = ?').get(cleanTcNo);
        if (existingTc) {
            return res.status(400).json({ success: false, error: 'Bu T.C. Kimlik Numarası ile zaten bir hesap mevcuttur.' });
        }
        // Hash password with PBKDF2 SHA-512 (Zero Plaintext Storage)
        const hashedPassword = (0, db_1.hashPassword)(String(password).trim());
        // Atomic transaction for Registration: users -> stores -> memberships -> merchant_applications -> audit_logs
        let resultUser = null;
        let resultStore = null;
        db_1.db.transaction(() => {
            // 1. Create User (status: 'pending')
            const userRes = db_1.db.prepare(`
        INSERT INTO users (full_name, email, phone, tc_no, password_hash, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(fullName, cleanEmail, phone, cleanTcNo, hashedPassword);
            const userId = Number(userRes.lastInsertRowid);
            // 2. Create Store (status: 'pending')
            const storeRes = db_1.db.prepare(`
        INSERT INTO stores (owner_id, name, slug, status)
        VALUES (?, ?, ?, 'pending')
      `).run(userId, cleanStoreName, storeSlug);
            const storeId = Number(storeRes.lastInsertRowid);
            // 3. Create Membership (OWNER / pending)
            db_1.db.prepare(`
        INSERT INTO memberships (user_id, store_id, role, status)
        VALUES (?, ?, 'OWNER', 'pending')
      `).run(userId, storeId);
            // 4. Create Merchant Application History (status: 'pending')
            db_1.db.prepare(`
        INSERT INTO merchant_applications (full_name, tc_no, phone, email, store_name, plan, password, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(fullName, cleanTcNo, phone, cleanEmail, cleanStoreName, plan || 'Pro Store', hashedPassword);
            // 5. Create Audit Log
            auth_middleware_1.AuthMiddleware.logAudit(storeId, userId, 'REGISTER', 'users', String(userId), '', cleanEmail);
            resultUser = { id: userId, email: cleanEmail, name: fullName };
            resultStore = { id: storeId, name: cleanStoreName, slug: storeSlug };
        })();
        return res.json({
            success: true,
            message: 'Mağaza başvurunuz başarıyla alındı. Süper Admin onayından sonra giriş yapabilirsiniz.',
            user: {
                id: resultUser.id,
                email: resultUser.email,
                name: resultUser.name,
                storeId: resultStore.id,
                storeSlug: resultStore.slug,
                status: 'pending'
            }
        });
    }
    catch (err) {
        console.error('[Register Error]:', err);
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, error: 'Bu E-Posta, T.C. Kimlik Numarası veya mağaza adı kullanılmaktadır.' });
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
    const user = db_1.db.prepare('SELECT id, full_name, email, password_hash, status FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (!user || !(0, db_1.verifyPassword)(cleanPass, user.password_hash)) {
        return res.status(401).json({ success: false, error: 'Geçersiz kullanıcı adı veya şifre.' });
    }
    if (user.status === 'pending') {
        return res.status(403).json({ success: false, error: 'Hesabınız henüz onay aşamasındadır. Süper Admin onayından sonra giriş yapabilirsiniz.' });
    }
    if (user.status !== 'active') {
        return res.status(403).json({ success: false, error: 'Hesabınız pasif durumdadır.' });
    }
    // 2. Fetch active memberships
    const memberships = db_1.db.prepare(`
    SELECT m.store_id, m.role, s.name as store_name, s.slug as store_slug, s.status as store_status
    FROM memberships m
    JOIN stores s ON s.id = m.store_id
    WHERE m.user_id = ? AND m.status = 'active' AND s.status = 'active'
    ORDER BY m.id ASC
  `).all(user.id);
    if (!memberships || memberships.length === 0) {
        return res.status(403).json({ success: false, error: 'Aktif veya onaylanmış bir mağaza üyeliğiniz bulunmamaktadır.' });
    }
    // Pick target store (or requested storeId if valid)
    const reqStoreId = Number(req.body?.storeId);
    let activeMem = memberships[0];
    if (reqStoreId) {
        const found = memberships.find(m => m.store_id === reqStoreId);
        if (found)
            activeMem = found;
    }
    const token = auth_middleware_1.AuthMiddleware.generateToken({
        userId: user.id,
        storeId: activeMem.store_id,
        role: activeMem.role,
        email: user.email
    });
    auth_middleware_1.AuthMiddleware.logAudit(activeMem.store_id, user.id, 'LOGIN', 'users', String(user.id), '', user.email);
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
app.get('/api/auth/verify', auth_middleware_1.AuthMiddleware.authenticate, (req, res) => {
    return res.json({ success: true, valid: true, user: req.auth });
});
// ==========================================
// MASTER ADMIN MERCHANT APPLICATION ROUTES
// ==========================================
// GET /api/admin/applications (Master Admin only - Store ID 1)
app.get('/api/admin/applications', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        if (req.auth.storeId !== 1) {
            return res.status(403).json({ success: false, error: 'Mağaza başvurularını yalnızca Süper Admin yönetebilir.' });
        }
        const apps = db_1.db.prepare('SELECT id, full_name, tc_no, phone, email, store_name, plan, status, created_at FROM merchant_applications ORDER BY id DESC').all();
        return res.json({ success: true, applications: apps });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/admin/applications/:id/approve (Master Admin approve application)
app.post('/api/admin/applications/:id/approve', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        if (req.auth.storeId !== 1) {
            return res.status(403).json({ success: false, error: 'Başvuru onaylama yetkisi sadece Süper Admin hesabına aittir.' });
        }
        const appId = Number(req.params.id);
        const appRow = db_1.db.prepare('SELECT * FROM merchant_applications WHERE id = ?').get(appId);
        if (!appRow) {
            return res.status(404).json({ success: false, error: 'Mağaza başvurusu bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE merchant_applications SET status = \'approved\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(appId);
            db_1.db.prepare('UPDATE users SET status = \'active\' WHERE LOWER(email) = ?').run(appRow.email.toLowerCase());
            const userRow = db_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(appRow.email.toLowerCase());
            if (userRow) {
                db_1.db.prepare('UPDATE stores SET status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(userRow.id);
                db_1.db.prepare('UPDATE memberships SET status = \'active\' WHERE user_id = ?').run(userRow.id);
            }
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'APPROVE_APPLICATION', 'merchant_applications', String(appId), '', appRow.email);
        })();
        return res.json({ success: true, message: `${appRow.store_name} mağaza başvurusu başarıyla onaylandı ve aktifleşti!` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/admin/applications/:id/reject (Master Admin reject application)
app.post('/api/admin/applications/:id/reject', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        if (req.auth.storeId !== 1) {
            return res.status(403).json({ success: false, error: 'Başvuru reddetme yetkisi sadece Süper Admin hesabına aittir.' });
        }
        const appId = Number(req.params.id);
        const appRow = db_1.db.prepare('SELECT * FROM merchant_applications WHERE id = ?').get(appId);
        if (!appRow) {
            return res.status(404).json({ success: false, error: 'Mağaza başvurusu bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE merchant_applications SET status = \'rejected\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(appId);
            db_1.db.prepare('UPDATE users SET status = \'rejected\' WHERE LOWER(email) = ?').run(appRow.email.toLowerCase());
            const userRow = db_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(appRow.email.toLowerCase());
            if (userRow) {
                db_1.db.prepare('UPDATE stores SET status = \'rejected\', updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(userRow.id);
                db_1.db.prepare('UPDATE memberships SET status = \'rejected\' WHERE user_id = ?').run(userRow.id);
            }
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'REJECT_APPLICATION', 'merchant_applications', String(appId), '', appRow.email);
        })();
        return res.json({ success: true, message: `${appRow.store_name} mağaza başvurusu reddedildi.` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// 2. WEBHOOK ENDPOINTS (Stage 5 Security Rules)
// ==========================================
app.get('/webhook/instagram', webhook_controller_1.WebhookController.verifyWebhook);
app.post('/webhook/instagram', webhook_controller_1.WebhookController.handleWebhook);
app.get('/api/webhook/:storeSlug', webhook_controller_1.WebhookController.verifyStoreWebhook);
app.post('/api/webhook/:storeSlug', webhook_controller_1.WebhookController.handleStoreWebhook);
// GET /api/integration/status (Authenticated Merchant - Scoped by req.auth.storeId)
app.get('/api/integration/status', auth_middleware_1.AuthMiddleware.authenticate, (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const store = db_1.db.prepare('SELECT id, name, slug, status, meta_page_id, instagram_account_id, instagram_username, last_webhook_at FROM stores WHERE id = ?').get(storeId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        const isConnected = !!(store.meta_page_id || store.instagram_account_id);
        const webhookUrl = `${req.protocol}://${req.get('host')}/api/webhook/${store.slug}`;
        return res.json({
            success: true,
            storeId: store.id,
            storeName: store.name,
            storeSlug: store.slug,
            metaPageId: store.meta_page_id || '',
            instagramAccountId: store.instagram_account_id || '',
            instagramUsername: store.instagram_username || '',
            connected: isConnected,
            webhookUrl,
            globalWebhookUrl: `${req.protocol}://${req.get('host')}/webhook/instagram`,
            lastWebhookAt: store.last_webhook_at || null
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/integration/meta (Authenticated Merchant - Scoped by req.auth.storeId)
app.post('/api/integration/meta', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { metaPageId, instagramAccountId, instagramUsername } = req.body || {};
        db_1.db.prepare(`
      UPDATE stores 
      SET meta_page_id = ?, instagram_account_id = ?, instagram_username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(String(metaPageId || '').trim(), String(instagramAccountId || '').trim(), String(instagramUsername || '').trim(), storeId);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_META_INTEGRATION', 'stores', String(storeId));
        return res.json({ success: true, message: 'Meta / Instagram entegrasyon bilgileri başarıyla güncellendi.' });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// Static Admin UI Server (Merchant Panel)
app.use('/admin', express_1.default.static(path_1.default.resolve(__dirname, '../public/admin')));
app.get(['/admin', '/admin/'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/admin/index.html'));
});
app.get(['/admin/login', '/admin/login.html'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/admin/login.html'));
});
// Static Master Admin UI Server (Platform Owner Panel)
app.use('/master-admin', express_1.default.static(path_1.default.resolve(__dirname, '../public/master-admin')));
app.get(['/master-admin', '/master-admin/'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/master-admin/index.html'));
});
app.get(['/master-admin/login', '/master-admin/login.html'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/master-admin/login.html'));
});
app.get(['/master-admin/merchants', '/master-admin/merchants.html'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/master-admin/merchants.html'));
});
app.get(['/master-admin/merchant', '/master-admin/merchant.html'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/master-admin/merchant.html'));
});
app.get(['/master-admin/applications', '/master-admin/applications.html'], (req, res) => {
    res.sendFile(path_1.default.resolve(__dirname, '../public/master-admin/applications.html'));
});
// ==========================================
// MASTER ADMIN API ENDPOINTS (/api/master-admin/*)
// Strictly enforced with AuthMiddleware.requireMasterAdmin
// ==========================================
// GET /api/master-admin/dashboard
app.get('/api/master-admin/dashboard', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const totalMerchants = db_1.db.prepare("SELECT COUNT(*) as count FROM stores WHERE id != 1").get().count;
        const activeStores = db_1.db.prepare("SELECT COUNT(*) as count FROM stores WHERE status = 'active' AND id != 1").get().count;
        const pendingApplications = db_1.db.prepare("SELECT COUNT(*) as count FROM merchant_applications WHERE status = 'pending'").get().count;
        const suspendedStores = db_1.db.prepare("SELECT COUNT(*) as count FROM stores WHERE status = 'suspended'").get().count;
        const totalUsers = db_1.db.prepare("SELECT COUNT(*) as count FROM users").get().count;
        const totalOrders = db_1.db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
        const totalAiMessages = db_1.db.prepare("SELECT COUNT(*) as count FROM ai_usage").get().count;
        const activeSubscriptions = db_1.db.prepare("SELECT COUNT(*) as count FROM merchant_applications WHERE status = 'approved' OR status = 'active'").get().count;
        const recentApplications = db_1.db.prepare("SELECT id, full_name, email, phone, store_name, plan, status, created_at FROM merchant_applications ORDER BY id DESC LIMIT 5").all();
        const recentMerchants = db_1.db.prepare(`
      SELECT s.id as store_id, s.name as store_name, s.slug, s.status as store_status, u.full_name as owner_name, u.email as owner_email, s.created_at
      FROM stores s
      JOIN users u ON u.id = s.owner_id
      WHERE s.id != 1
      ORDER BY s.id DESC LIMIT 5
    `).all();
        return res.json({
            success: true,
            metrics: {
                totalMerchants,
                activeStores,
                pendingApplications,
                suspendedStores,
                totalUsers,
                totalOrders,
                totalAiMessages,
                activeSubscriptions
            },
            recentApplications,
            recentMerchants
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// GET /api/master-admin/merchants
app.get('/api/master-admin/merchants', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const search = String(req.query.search || '').trim().toLowerCase();
        const status = String(req.query.status || 'all').trim().toLowerCase();
        let query = `
      SELECT s.id as store_id, s.name as store_name, s.slug as store_slug, s.status as store_status, s.created_at as store_created_at,
             u.id as owner_id, u.full_name as owner_name, u.email as owner_email, u.phone as owner_phone, u.status as user_status,
             m.role as owner_role, m.status as membership_status,
             ma.plan as plan
      FROM stores s
      LEFT JOIN users u ON u.id = s.owner_id
      LEFT JOIN memberships m ON m.user_id = u.id AND m.store_id = s.id
      LEFT JOIN merchant_applications ma ON LOWER(ma.email) = LOWER(u.email)
      WHERE s.id != 1
    `;
        const params = [];
        if (status !== 'all') {
            query += ` AND (LOWER(s.status) = ? OR LOWER(m.status) = ?)`;
            params.push(status, status);
        }
        if (search) {
            query += ` AND (LOWER(s.name) LIKE ? OR LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ? OR u.phone LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }
        query += ` ORDER BY s.id DESC`;
        const merchants = db_1.db.prepare(query).all(...params);
        return res.json({ success: true, merchants });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// GET /api/master-admin/merchants/:storeId
app.get('/api/master-admin/merchants/:storeId', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const targetStoreId = Number(req.params.storeId);
        if (!targetStoreId || isNaN(targetStoreId)) {
            return res.status(400).json({ success: false, error: 'Geçersiz mağaza ID.' });
        }
        const store = db_1.db.prepare("SELECT * FROM stores WHERE id = ?").get(targetStoreId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        const owner = db_1.db.prepare("SELECT id, full_name, email, phone, tc_no, status, created_at FROM users WHERE id = ?").get(store.owner_id);
        const membership = db_1.db.prepare("SELECT * FROM memberships WHERE user_id = ? AND store_id = ?").get(store.owner_id, targetStoreId);
        const application = db_1.db.prepare("SELECT * FROM merchant_applications WHERE LOWER(email) = LOWER(?)").get(owner?.email || '');
        const productsCount = db_1.db.prepare("SELECT COUNT(*) as count FROM products WHERE store_id = ?").get(targetStoreId).count;
        const ordersCount = db_1.db.prepare("SELECT COUNT(*) as count FROM orders WHERE store_id = ?").get(targetStoreId).count;
        const customersCount = db_1.db.prepare("SELECT COUNT(*) as count FROM customers WHERE store_id = ?").get(targetStoreId).count;
        const campaignsCount = db_1.db.prepare("SELECT COUNT(*) as count FROM campaigns WHERE store_id = ?").get(targetStoreId).count;
        const rewardsCount = db_1.db.prepare("SELECT COUNT(*) as count FROM user_rewards WHERE store_id = ?").get(targetStoreId).count;
        const aiUsageCount = db_1.db.prepare("SELECT COUNT(*) as count FROM ai_usage WHERE store_id = ?").get(targetStoreId).count;
        const apiKeysCount = db_1.db.prepare("SELECT COUNT(*) as count FROM api_keys WHERE store_id = ?").get(targetStoreId).count;
        const recentProducts = db_1.db.prepare("SELECT product_code, name, price, stock FROM products WHERE store_id = ? ORDER BY id DESC LIMIT 5").all(targetStoreId);
        const recentOrders = db_1.db.prepare("SELECT id, customer_name, total_price, status, created_at FROM orders WHERE store_id = ? ORDER BY id DESC LIMIT 5").all(targetStoreId);
        const recentAuditLogs = db_1.db.prepare("SELECT id, action, entity_type, entity_id, created_at FROM audit_logs WHERE store_id = ? ORDER BY id DESC LIMIT 10").all(targetStoreId);
        auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_VIEW_MERCHANT', 'stores', String(targetStoreId));
        return res.json({
            success: true,
            detail: {
                store,
                owner,
                membership,
                application,
                metrics: {
                    productsCount,
                    ordersCount,
                    customersCount,
                    campaignsCount,
                    rewardsCount,
                    aiUsageCount,
                    apiKeysCount
                },
                recentProducts,
                recentOrders,
                recentAuditLogs
            }
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// GET /api/master-admin/applications
app.get('/api/master-admin/applications', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const apps = db_1.db.prepare('SELECT id, full_name, tc_no, phone, email, store_name, plan, status, created_at FROM merchant_applications ORDER BY id DESC').all();
        return res.json({ success: true, applications: apps });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/master-admin/applications/:id/approve
app.post('/api/master-admin/applications/:id/approve', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const appId = Number(req.params.id);
        const appRow = db_1.db.prepare('SELECT * FROM merchant_applications WHERE id = ?').get(appId);
        if (!appRow) {
            return res.status(404).json({ success: false, error: 'Mağaza başvurusu bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE merchant_applications SET status = \'approved\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(appId);
            db_1.db.prepare('UPDATE users SET status = \'active\' WHERE LOWER(email) = ?').run(appRow.email.toLowerCase());
            const userRow = db_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(appRow.email.toLowerCase());
            if (userRow) {
                db_1.db.prepare('UPDATE stores SET status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(userRow.id);
                db_1.db.prepare('UPDATE memberships SET status = \'active\' WHERE user_id = ?').run(userRow.id);
            }
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_APPROVE_APPLICATION', 'merchant_applications', String(appId), '', appRow.email);
        })();
        return res.json({ success: true, message: `${appRow.store_name} mağaza başvurusu başarıyla onaylandı ve aktifleşti!` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/master-admin/applications/:id/reject
app.post('/api/master-admin/applications/:id/reject', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const appId = Number(req.params.id);
        const appRow = db_1.db.prepare('SELECT * FROM merchant_applications WHERE id = ?').get(appId);
        if (!appRow) {
            return res.status(404).json({ success: false, error: 'Mağaza başvurusu bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE merchant_applications SET status = \'rejected\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(appId);
            db_1.db.prepare('UPDATE users SET status = \'rejected\' WHERE LOWER(email) = ?').run(appRow.email.toLowerCase());
            const userRow = db_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(appRow.email.toLowerCase());
            if (userRow) {
                db_1.db.prepare('UPDATE stores SET status = \'rejected\', updated_at = CURRENT_TIMESTAMP WHERE owner_id = ?').run(userRow.id);
                db_1.db.prepare('UPDATE memberships SET status = \'rejected\' WHERE user_id = ?').run(userRow.id);
            }
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_REJECT_APPLICATION', 'merchant_applications', String(appId), '', appRow.email);
        })();
        return res.json({ success: true, message: `${appRow.store_name} mağaza başvurusu reddedildi.` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/master-admin/stores/:storeId/suspend
app.post('/api/master-admin/stores/:storeId/suspend', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const targetStoreId = Number(req.params.storeId);
        if (targetStoreId === 1) {
            return res.status(400).json({ success: false, error: 'Master Admin mağazası askıya alınamaz.' });
        }
        const store = db_1.db.prepare('SELECT * FROM stores WHERE id = ?').get(targetStoreId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE stores SET status = \'suspended\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetStoreId);
            db_1.db.prepare('UPDATE memberships SET status = \'suspended\' WHERE store_id = ?').run(targetStoreId);
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_SUSPEND_STORE', 'stores', String(targetStoreId), store.status, 'suspended');
        })();
        return res.json({ success: true, message: `${store.name} mağazası başarıyla askıya alındı.` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/master-admin/stores/:storeId/activate
app.post('/api/master-admin/stores/:storeId/activate', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const targetStoreId = Number(req.params.storeId);
        const store = db_1.db.prepare('SELECT * FROM stores WHERE id = ?').get(targetStoreId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        db_1.db.transaction(() => {
            db_1.db.prepare('UPDATE stores SET status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetStoreId);
            db_1.db.prepare('UPDATE memberships SET status = \'active\' WHERE store_id = ?').run(targetStoreId);
            db_1.db.prepare('UPDATE users SET status = \'active\' WHERE id = ?').run(store.owner_id);
            auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_ACTIVATE_STORE', 'stores', String(targetStoreId), store.status, 'active');
        })();
        return res.json({ success: true, message: `${store.name} mağazası yeniden aktifleştirildi!` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// POST /api/master-admin/stores/:storeId/change-plan
app.post('/api/master-admin/stores/:storeId/change-plan', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireMasterAdmin, (req, res) => {
    try {
        const targetStoreId = Number(req.params.storeId);
        const { plan } = req.body || {};
        if (!plan) {
            return res.status(400).json({ success: false, error: 'Yeni paket adı zorunludur.' });
        }
        const store = db_1.db.prepare('SELECT * FROM stores WHERE id = ?').get(targetStoreId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        const owner = db_1.db.prepare('SELECT email FROM users WHERE id = ?').get(store.owner_id);
        if (owner) {
            db_1.db.prepare('UPDATE merchant_applications SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = ?').run(plan, owner.email.toLowerCase());
        }
        auth_middleware_1.AuthMiddleware.logAudit(1, req.auth.userId, 'MASTER_ADMIN_CHANGE_PLAN', 'stores', String(targetStoreId), '', String(plan));
        return res.json({ success: true, message: `${store.name} mağazasının paketi "${plan}" olarak güncellendi.` });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
app.use('/', (req, res, next) => {
    if (req.path === '/webhook/instagram' || req.path.startsWith('/webhook') || req.path.startsWith('/api')) {
        return next();
    }
    return next();
}, express_1.default.static(path_1.default.join(__dirname, '../public')));
// ==========================================
// 3. PROTECTED MERCHANT API ENDPOINTS (Authenticated & Scoped by req.auth.storeId)
// ==========================================
// --- PRODUCTS & STOCKS ---
app.get('/api/stocks', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req, res) => {
    const storeId = req.auth.storeId;
    const stocks = await stock_service_1.StockService.getAllProducts(storeId);
    res.json({ success: true, stocks });
});
app.get('/api/stock/:code', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req, res) => {
    const storeId = req.auth.storeId;
    const result = await stock_service_1.StockService.checkStock(storeId, String(req.params.code));
    res.json(result);
});
app.post('/api/products', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { shortCode, productCode, name, color, size, stock, price, category, storeName } = req.body || {};
        if (!shortCode || !name || !size) {
            return res.status(400).json({ success: false, error: 'Kısa kod, ürün ismi ve beden/numara alanları zorunludur.' });
        }
        const result = await stock_service_1.StockService.addProduct({
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
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'ADD_PRODUCT', 'products', result.productCode || '');
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
        res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
app.post('/api/products/price', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { productCode, price } = req.body;
        if (!productCode || price === undefined) {
            return res.status(400).json({ success: false, error: 'productCode ve price zorunludur.' });
        }
        const numPrice = Number(price);
        if (isNaN(numPrice) || numPrice < 0) {
            return res.status(400).json({ success: false, error: 'Geçersiz fiyat.' });
        }
        const stmt = db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND (product_code = ? OR short_code = ?)');
        const result = stmt.run(numPrice, storeId, productCode, productCode);
        if (result.changes > 0) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_PRICE', 'products', productCode, '', String(numPrice));
            res.json({ success: true, message: `Ürün (${productCode}) fiyatı ${numPrice} TL olarak güncellendi.` });
        }
        else {
            res.status(404).json({ success: false, error: 'Ürün bu mağazada bulunamadı.' });
        }
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/products/bulk-update', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { updates } = req.body;
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Güncellenecek veri listesi boş veya geçersiz.' });
        }
        const updatePriceStmt = db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND product_code = ?');
        const updateStockStmt = db_1.db.prepare('UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND product_code = ?');
        let updatedCount = 0;
        const bulkTransaction = db_1.db.transaction((items) => {
            for (const item of items) {
                if (item.productCode) {
                    const cleanCode = String(item.productCode).trim().toUpperCase();
                    if (item.price !== undefined && !isNaN(Number(item.price)) && Number(item.price) >= 0) {
                        const resPrice = updatePriceStmt.run(Number(item.price), storeId, cleanCode);
                        if (resPrice.changes > 0)
                            updatedCount++;
                    }
                    if (item.stock !== undefined && !isNaN(Number(item.stock)) && Number(item.stock) >= 0) {
                        const stockNum = Number(item.stock);
                        const resStock = updateStockStmt.run(stockNum, storeId, cleanCode);
                        if (resStock.changes > 0) {
                            updatedCount++;
                            try {
                                let inv = db_1.db.prepare('SELECT id FROM inventory WHERE store_id = ? AND UPPER(product_code) = ?').get(storeId, cleanCode);
                                if (inv) {
                                    db_1.db.prepare('UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(stockNum, inv.id);
                                }
                                else {
                                    db_1.db.prepare('INSERT INTO inventory (store_id, product_code, stock, reserved_stock, updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)').run(storeId, cleanCode, stockNum);
                                }
                            }
                            catch (e) { }
                        }
                    }
                }
            }
        });
        bulkTransaction(updates);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'BULK_UPDATE_PRODUCTS', 'products', `${updates.length} items`);
        if (updatedCount === 0) {
            return res.status(404).json({ success: false, error: 'Belirtilen ürünler bu mağazada bulunamadı veya güncelleme yapılamadı.' });
        }
        return res.json({ success: true, message: `${updatedCount} adet güncelleme başarıyla kaydedildi!`, updatedCount });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/products/delete', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { productCode } = req.body;
        if (!productCode) {
            return res.status(400).json({ success: false, error: 'productCode parametresi gereklidir' });
        }
        const success = await stock_service_1.StockService.deleteProduct(storeId, productCode);
        if (success) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'DELETE_PRODUCT', 'products', productCode);
            return res.json({ success: true, message: `Ürün (${productCode}) silindi.` });
        }
        else {
            return res.status(404).json({ success: false, error: 'Ürün bu mağazada bulunamadı veya silinemedi.' });
        }
    }
    catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
app.post('/api/products/update-stock', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { productCode, newStock } = req.body;
        if (!productCode || newStock === undefined || newStock === null) {
            return res.status(400).json({ success: false, error: 'productCode ve newStock parametreleri gereklidir' });
        }
        const numStock = Number(newStock);
        if (isNaN(numStock) || numStock < 0) {
            return res.status(400).json({ success: false, error: 'Geçersiz stok miktarı. Stok 0 veya pozitif bir sayı olmalıdır.' });
        }
        const success = await stock_service_1.StockService.updateStock(storeId, String(productCode), numStock);
        if (success) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_STOCK', 'products', String(productCode), '', String(numStock));
            return res.json({ success: true, message: `Ürün (${productCode}) stoğu ${numStock} olarak güncellendi.`, productCode, stock: numStock });
        }
        else {
            return res.status(404).json({ success: false, error: 'Ürün bu mağazada bulunamadı veya stok güncellenemedi.' });
        }
    }
    catch (err) {
        return res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
// --- ORDERS ---
app.get('/api/orders', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req, res) => {
    const storeId = req.auth.storeId;
    const orders = await order_service_1.OrderService.getOrders(storeId);
    res.json({ success: true, count: orders.length, orders });
});
app.post('/api/orders/status', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { orderId, status, reason } = req.body;
        if (!orderId || !status || (status !== 'OK' && status !== 'DEC')) {
            return res.status(400).json({ success: false, error: 'orderId ve geçerli bir status (OK veya DEC) gereklidir' });
        }
        const success = await order_service_1.OrderService.updateOrderStatus(storeId, orderId, status, reason);
        if (success) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_ORDER_STATUS', 'orders', orderId, '', status);
            res.json({
                success: true,
                message: `Sipariş ${orderId} durumu '${status}' olarak güncellendi.`,
                orderId,
                status
            });
        }
        else {
            res.status(500).json({ success: false, error: 'Sipariş durumu güncellenemedi.' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
app.post('/api/orders/delete', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'orderId parametresi gereklidir' });
        }
        const success = await order_service_1.OrderService.deleteOrder(storeId, orderId);
        if (success) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'DELETE_ORDER', 'orders', orderId);
            res.json({ success: true, message: `Sipariş (${orderId}) silindi.` });
        }
        else {
            res.status(500).json({ success: false, error: 'Sipariş silinemedi.' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
// --- CAMPAIGNS ---
app.get('/api/campaigns', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const campaigns = db_1.db.prepare('SELECT * FROM campaigns WHERE store_id = ? ORDER BY id DESC').all(storeId);
        return res.json({ success: true, campaigns });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Kampanyalar alınırken sunucu hatası oluştu.' });
    }
});
app.post('/api/campaigns', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { title, description, code, discountPercent, discountAmount, minOrderAmount, startDate, endDate } = req.body || {};
        if (!title || !String(title).trim() || !description || !String(description).trim()) {
            return res.status(400).json({ success: false, error: 'Kampanya başlığı ve açıklaması zorunludur.' });
        }
        const cleanTitle = String(title).trim();
        const cleanDesc = String(description).trim();
        const cleanCode = code ? String(code).trim().toUpperCase() : '';
        const numPercent = discountPercent !== undefined ? Number(discountPercent) : 0;
        const numAmount = discountAmount !== undefined ? Number(discountAmount) : 0;
        const numMinOrder = minOrderAmount !== undefined ? Number(minOrderAmount) : 0;
        if (isNaN(numPercent) || numPercent < 0) {
            return res.status(400).json({ success: false, error: 'Geçersiz indirim yüzdesi.' });
        }
        const stmt = db_1.db.prepare(`
      INSERT INTO campaigns (store_id, title, description, code, discount_percent, discount_amount, min_order_amount, start_date, end_date, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
        const result = stmt.run(storeId, cleanTitle, cleanDesc, cleanCode, numPercent, numAmount, numMinOrder, startDate || null, endDate || null);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'CREATE_CAMPAIGN', 'campaigns', cleanCode || cleanTitle);
        return res.status(201).json({
            success: true,
            message: 'Kampanya başarıyla oluşturuldu.',
            id: Number(result.lastInsertRowid),
            campaign: {
                id: Number(result.lastInsertRowid),
                store_id: storeId,
                title: cleanTitle,
                description: cleanDesc,
                code: cleanCode,
                discount_percent: numPercent,
                active: 1
            }
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Kampanya oluşturulurken veritabanı hatası oluştu.' });
    }
});
app.post('/api/campaigns/toggle', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { id, active } = req.body || {};
        if (!id) {
            return res.status(400).json({ success: false, error: 'Kampanya id zorunludur.' });
        }
        const newActive = active ? 1 : 0;
        const result = db_1.db.prepare('UPDATE campaigns SET active = ? WHERE store_id = ? AND id = ?').run(newActive, storeId, String(id));
        if (result.changes > 0) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'TOGGLE_CAMPAIGN', 'campaigns', String(id), '', String(newActive));
            return res.json({ success: true, message: 'Kampanya durumu güncellendi.', active: newActive });
        }
        else {
            return res.status(404).json({ success: false, error: 'Kampanya bulunamadı veya bu mağazaya ait değil.' });
        }
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Kampanya güncellenemedi.' });
    }
});
app.delete('/api/campaigns/:id', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const campaignId = String(req.params.id);
        const result = db_1.db.prepare('DELETE FROM campaigns WHERE store_id = ? AND id = ?').run(storeId, campaignId);
        if (result.changes > 0) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'DELETE_CAMPAIGN', 'campaigns', campaignId);
            return res.json({ success: true, message: 'Kampanya silindi.' });
        }
        else {
            return res.status(404).json({ success: false, error: 'Kampanya bulunamadı veya bu mağazaya ait değil.' });
        }
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Kampanya silinirken hata oluştu.' });
    }
});
// --- SETTINGS ---
app.get('/api/settings', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const rows = db_1.db.prepare('SELECT * FROM settings WHERE store_id = ?').all(storeId);
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
app.post('/api/settings', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { key, value, settings, shippingFee, freeShippingThreshold } = req.body;
        if (key && value !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, ?, ?)').run(storeId, String(key), String(value));
        }
        if (shippingFee !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, "shipping_fee", ?)').run(storeId, String(shippingFee));
        }
        if (freeShippingThreshold !== undefined) {
            db_1.db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, "free_shipping_threshold", ?)').run(storeId, String(freeShippingThreshold));
        }
        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) {
                db_1.db.prepare('INSERT OR REPLACE INTO settings (store_id, key, value) VALUES (?, ?, ?)').run(storeId, String(k), String(v));
            }
        }
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_SETTINGS', 'settings', 'all');
        res.json({ success: true, message: 'Ayarlar güncellendi.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.get('/api/stores/webhook-info', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        let store = db_1.db.prepare('SELECT id, name, slug, status, meta_page_id, instagram_account_id, instagram_username, last_webhook_at, webhook_verify_token FROM stores WHERE id = ?').get(storeId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        if (!store.webhook_verify_token) {
            const newToken = `whsec_${store.slug}_` + crypto_1.default.randomBytes(12).toString('hex');
            db_1.db.prepare('UPDATE stores SET webhook_verify_token = ? WHERE id = ?').run(newToken, storeId);
            store.webhook_verify_token = newToken;
        }
        const host = req.get('host') || '136.92.8.201:3000';
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const webhookUrl = `${protocol}://${host}/api/webhook/${store.slug}`;
        return res.json({
            success: true,
            storeId: store.id,
            storeName: store.name,
            slug: store.slug,
            webhookUrl: webhookUrl,
            verifyToken: store.webhook_verify_token,
            metaPageId: store.meta_page_id || '',
            instagramAccountId: store.instagram_account_id || '',
            instagramUsername: store.instagram_username || '',
            lastWebhookAt: store.last_webhook_at || null
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Sunucu hatası' });
    }
});
app.post('/api/stores/webhook-token/regenerate', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const store = db_1.db.prepare('SELECT id, slug FROM stores WHERE id = ?').get(storeId);
        if (!store) {
            return res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
        }
        const newToken = `whsec_${store.slug}_` + crypto_1.default.randomBytes(12).toString('hex');
        db_1.db.prepare('UPDATE stores SET webhook_verify_token = ? WHERE id = ?').run(newToken, storeId);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'REGENERATE_WEBHOOK_TOKEN', 'stores', String(storeId));
        return res.json({
            success: true,
            message: 'Webhook verify token başarıyla yenilendi.',
            verifyToken: newToken
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Token yenilenirken sunucu hatası oluştu.' });
    }
});
app.post('/api/integration/meta', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { metaPageId, instagramAccountId, instagramUsername } = req.body || {};
        db_1.db.prepare(`
      UPDATE stores 
      SET meta_page_id = ?, instagram_account_id = ?, instagram_username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(metaPageId ? String(metaPageId).trim() : '', instagramAccountId ? String(instagramAccountId).trim() : '', instagramUsername ? String(instagramUsername).trim() : '', storeId);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'UPDATE_META_INTEGRATION', 'stores', String(storeId));
        return res.json({ success: true, message: 'Meta & Instagram entegrasyon ayarları kaydedildi!' });
    }
    catch (e) {
        return res.status(500).json({ success: false, error: e.message || 'Meta ayarları kaydedilemedi.' });
    }
});
// --- VIP REWARDS ---
app.get('/api/rewards', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const rewards = db_1.db.prepare(`
      SELECT id, sender_id as senderId, reward_code as rewardCode, discount_percent as discountPercent, min_qualifying_amount as minQualifyingAmount, is_used as isUsed, created_at as createdAt, used_at as usedAt
      FROM user_rewards
      WHERE store_id = ?
      ORDER BY id DESC
    `).all(storeId);
        res.json({ success: true, rewards });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/rewards', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { senderId, rewardCode, discountPercent, minQualifyingAmount } = req.body;
        if (!senderId || !discountPercent) {
            return res.status(400).json({ success: false, error: 'Müşteri ID ve İndirim Oranı zorunludur.' });
        }
        const sId = senderId.trim();
        const code = (rewardCode || 'YINEBEKLERIZ').trim().toUpperCase();
        const percent = Number(discountPercent) || 20;
        const minAmt = Number(minQualifyingAmount) || 2000;
        const stmt = db_1.db.prepare(`
      INSERT INTO user_rewards (store_id, sender_id, reward_code, discount_percent, min_qualifying_amount, is_used)
      VALUES (?, ?, ?, ?, ?, 0)
    `);
        stmt.run(storeId, sId, code, percent, minAmt);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'CREATE_REWARD', 'user_rewards', sId);
        res.json({ success: true, message: `Müşteri (${sId}) için %${percent} VIP indirim tanımlandı.` });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.delete('/api/rewards/:id', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        db_1.db.prepare('DELETE FROM user_rewards WHERE store_id = ? AND id = ?').run(storeId, String(req.params.id));
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'DELETE_REWARD', 'user_rewards', String(req.params.id));
        res.json({ success: true, message: 'VIP Ödülü silindi.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// --- ADMIN COPILOT & AI PRODUCT CREATION ---
app.post('/api/ai/admin-copilot', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { prompt } = req.body;
        if (!prompt || !prompt.trim()) {
            return res.status(400).json({ success: false, error: 'Lütfen bir yönetim komutu yazınız.' });
        }
        const reply = await admin_copilot_service_1.AdminCopilotService.processAdminCommand(prompt.trim(), storeId);
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'ADMIN_COPILOT_CMD', 'ai', prompt.substring(0, 50));
        res.json({ success: true, reply });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Sunucu hatası' });
    }
});
app.post('/api/ai/create-product', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER', 'ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
            return res.status(400).json({ success: false, error: 'Lütfen ürün komut metni giriniz.' });
        }
        const result = await gemini_service_1.GeminiService.createProductFromPrompt(prompt.trim(), storeId);
        if (result.success && result.products && result.products.length > 0) {
            auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'AI_CREATE_PRODUCT', 'products', result.products[0]?.productCode || '');
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
        res.status(500).json({ success: false, error: err.message || 'Yapay zeka sunucu hatası' });
    }
});
// --- API KEYS MANAGEMENT (OWNER ONLY) ---
app.get('/api/api-keys', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const keys = db_1.db.prepare('SELECT id, name, permissions, created_at, last_used_at FROM api_keys WHERE store_id = ? ORDER BY id DESC').all(storeId);
        res.json({ success: true, keys });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/api-keys', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        const { name, permissions } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'API key ismi zorunludur.' });
        }
        const rawKey = `isc_live_${crypto_1.default.randomBytes(24).toString('hex')}`;
        const keyHash = crypto_1.default.createHash('sha256').update(rawKey).digest('hex');
        db_1.db.prepare(`
      INSERT INTO api_keys (store_id, name, key_hash, permissions, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(storeId, name.trim(), keyHash, permissions || 'read_write');
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'CREATE_API_KEY', 'api_keys', name);
        res.json({ success: true, apiKey: rawKey, message: 'API Key oluşturuldu. Anahtarı güvenli yerde saklayın.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
app.delete('/api/api-keys/:id', auth_middleware_1.AuthMiddleware.authenticate, auth_middleware_1.AuthMiddleware.requireRole(['OWNER']), (req, res) => {
    try {
        const storeId = req.auth.storeId;
        db_1.db.prepare('DELETE FROM api_keys WHERE store_id = ? AND id = ?').run(storeId, String(req.params.id));
        auth_middleware_1.AuthMiddleware.logAudit(storeId, req.auth.userId, 'DELETE_API_KEY', 'api_keys', String(req.params.id));
        res.json({ success: true, message: 'API Key silindi.' });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// Start Express Application Server
app.listen(env_1.env.port, () => {
    console.log(`
  🚀 iscworks bot - Enterprise Multi-Tenant RBAC Backend SUNUCUSU BAŞLATILDI!
  -----------------------------------------------------------------------
  🤖 Sistem Adı: iscworks bot (Stage 6 RBAC Secured)
  🌐 Port: ${env_1.env.port}
  🗄️ Database: SQLite (barons.db)
  🔐 Authentication: JWT HMAC-SHA256 & API Key DB Isolation
  📊 Admin API: http://localhost:${env_1.env.port}/api/orders
  -----------------------------------------------------------------------
  `);
});

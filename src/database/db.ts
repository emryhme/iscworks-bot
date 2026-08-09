import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * BARON'S SILLAGE SQLite Veritabanı Yöneticisi (barons.db)
 */
const dbPath = path.resolve(process.cwd(), 'barons.db');
console.log(`[Database] 🗄️ SQLite Veritabanı Yolu: ${dbPath}`);

export const db = new Database(dbPath, { verbose: undefined });

// Performans Ayarları (WAL Mode & Synchronous Normal)
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

/**
 * Tabloları Oluşturur (Migrations)
 */
export function initDatabase() {
  // 1. Ürünler Tablosu (products)
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_code TEXT NOT NULL,
      product_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '',
      size TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 299.00,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT DEFAULT '',
      wp_link TEXT DEFAULT '',
      media_link TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Siparişler Tablosu (orders)
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT DEFAULT '',
      customer_phone TEXT NOT NULL,
      address TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT DEFAULT '',
      size TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      shipping_fee REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'BEKLEMEDE',
      sender_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Kampanyalar Tablosu (campaigns)
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      code TEXT DEFAULT '',
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      min_order_amount REAL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Sistem Ayarları Tablosu (settings - Kargo Fiyatları vb.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 5. Müşteri Kişiye Özel İndirim Ödülleri Tablosu (user_rewards - Instagram ID'ye özel %20 İndirim)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      reward_code TEXT NOT NULL,
      discount_percent REAL NOT NULL DEFAULT 20.0,
      min_qualifying_amount REAL NOT NULL DEFAULT 2000.0,
      is_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at TEXT DEFAULT NULL
    );
  `);

  // 6. Üye / Mağaza Başvuruları Tablosu (merchant_applications)
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchant_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      tc_no TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      store_name TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'Pro Store (₺6.000 / Ay)',
      password TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Webhook Mükerrer İşleme Engelleyici Tablo (webhook_events - Idempotency)
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      store_slug TEXT DEFAULT '',
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. Multi-Tenant Stores Tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 9. Users Tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT DEFAULT '',
      tc_no TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 10. Memberships (Store-User RBAC Roles)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      store_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'OWNER',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 11. Product Variants (SKU & Size/Color Level)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER DEFAULT 0,
      store_id INTEGER NOT NULL DEFAULT 1,
      sku TEXT NOT NULL,
      color TEXT DEFAULT 'Standart',
      size TEXT DEFAULT 'M',
      price REAL NOT NULL DEFAULT 299.00,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 12. Inventory (Dedicated Stock & Reservation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER DEFAULT 0,
      product_code TEXT NOT NULL,
      store_id INTEGER NOT NULL DEFAULT 1,
      stock INTEGER NOT NULL DEFAULT 0,
      reserved_stock INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 13. Customers Directory
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL DEFAULT 1,
      sender_id TEXT DEFAULT '',
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 14. Persistent Conversations & Messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL DEFAULT 1,
      customer_id INTEGER DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'instagram',
      external_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_type TEXT NOT NULL DEFAULT 'user',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 15. Normalized Order Items
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      store_id INTEGER NOT NULL DEFAULT 1,
      product_id INTEGER DEFAULT 0,
      variant_id INTEGER DEFAULT 0,
      product_name TEXT NOT NULL,
      sku TEXT DEFAULT '',
      size TEXT DEFAULT '',
      unit_price REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_price REAL NOT NULL DEFAULT 0
    );
  `);

  // 16. Audit Logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      store_id INTEGER NOT NULL DEFAULT 1,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT DEFAULT '',
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 17. API Keys (Merchant API Access)
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      permissions TEXT DEFAULT 'read_write',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT DEFAULT NULL
    );
  `);

  // 18. AI Usage & Token Tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL DEFAULT 1,
      conversation_id INTEGER DEFAULT 0,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      latency INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Default Store & Admin User Records Ensure (store_id = 1)
  db.exec(`
    INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status)
    VALUES (1, 1, 'BARON''S SILLAGE', 'default', 'active');
  `);

  const adminPassHash = hashPassword('cintonik!');
  db.exec(`
    INSERT OR IGNORE INTO users (id, full_name, email, password_hash, status)
    VALUES (1, 'Tony Stark', 'tonystark@iscworks.com', '${adminPassHash}', 'active');

    INSERT OR IGNORE INTO memberships (id, user_id, store_id, role, status)
    VALUES (1, 1, 1, 'OWNER', 'active');
  `);

  // Auto Migrations: Kolonlar eksikse otomatik ekle
  try { db.exec(`ALTER TABLE products ADD COLUMN price REAL NOT NULL DEFAULT 299.00;`); } catch (e) {}
  try { db.exec(`ALTER TABLE products ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE products ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN total_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN start_date TEXT DEFAULT NULL;`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN end_date TEXT DEFAULT NULL;`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_rewards ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_rewards ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;`); } catch (e) {}
  try { db.exec(`ALTER TABLE webhook_events ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;`); } catch (e) {}
  db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_events_store_event ON webhook_events(store_id, event_id);`);

  // Multi-Tenant Migration 1: products tablosunu UNIQUE(store_id, product_code) yapısına geçir
  const productsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'products'").get() as { sql: string } | undefined;
  if (productsSchema && (productsSchema.sql.includes('product_code TEXT UNIQUE') || !productsSchema.sql.includes('UNIQUE(store_id, product_code)'))) {
    console.log('[Database Migration] 🔄 products tablosu UNIQUE(store_id, product_code) yapısına aktarılıyor...');
    const migrateProducts = db.transaction(() => {
      db.exec(`
        CREATE TABLE products_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          short_code TEXT NOT NULL,
          product_code TEXT NOT NULL,
          name TEXT NOT NULL,
          color TEXT DEFAULT '',
          size TEXT NOT NULL,
          price REAL NOT NULL DEFAULT 299.00,
          stock INTEGER NOT NULL DEFAULT 0,
          category TEXT DEFAULT '',
          wp_link TEXT DEFAULT '',
          media_link TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          store_name TEXT DEFAULT '',
          store_id INTEGER NOT NULL DEFAULT 1,
          UNIQUE(store_id, product_code),
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        INSERT INTO products_new (id, short_code, product_code, name, color, size, price, stock, category, wp_link, media_link, created_at, updated_at, store_name, store_id)
        SELECT id, short_code, product_code, name, color, size, COALESCE(price, 299.00), stock, category, wp_link, media_link, created_at, updated_at, COALESCE(store_name, ''), COALESCE(store_id, 1)
        FROM products;
      `);
      db.exec(`DROP TABLE products;`);
      db.exec(`ALTER TABLE products_new RENAME TO products;`);
    });
    migrateProducts();
    console.log('[Database Migration] ✅ products tablosu başarıyla dönüştürüldü.');
  }

  // Multi-Tenant Migration 2: settings tablosunu PRIMARY KEY(store_id, key) yapısına aktar
  const settingsSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get() as { sql: string } | undefined;
  if (settingsSchema && !settingsSchema.sql.includes('store_id')) {
    console.log('[Database Migration] 🔄 settings tablosu PRIMARY KEY(store_id, key) yapısına aktarılıyor...');
    const migrateSettings = db.transaction(() => {
      db.exec(`
        CREATE TABLE settings_new (
          store_id INTEGER NOT NULL DEFAULT 1,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (store_id, key),
          FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        INSERT OR IGNORE INTO settings_new (store_id, key, value)
        SELECT 1, key, value FROM settings;
      `);
      db.exec(`DROP TABLE settings;`);
      db.exec(`ALTER TABLE settings_new RENAME TO settings;`);
    });
    migrateSettings();
    console.log('[Database Migration] ✅ settings tablosu başarıyla dönüştürüldü.');
  }

  // Multi-Tenant Performans İndeksleri
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_short ON products(short_code);
    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_name);
    CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_products_store_code ON products(store_id, product_code);
    CREATE INDEX IF NOT EXISTS idx_products_store_short ON products(store_id, short_code);
    CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_name);
    CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store_created ON orders(store_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_store_status ON orders(store_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_store_sender ON orders(store_id, sender_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);
    CREATE INDEX IF NOT EXISTS idx_campaigns_store_id ON campaigns(store_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_sender ON user_rewards(sender_id);
    CREATE INDEX IF NOT EXISTS idx_rewards_store_id ON user_rewards(store_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_id ON webhook_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_stores_slug ON stores(slug);
    CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_store_code ON inventory(store_id, product_code);
    CREATE INDEX IF NOT EXISTS idx_customers_store_sender ON customers(store_id, sender_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_store_customer ON conversations(store_id, customer_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_store ON ai_usage(store_id);
  `);

  // Varsayılan Başlangıç Stok & Kampanya Verilerini Yükle
  seedInitialProducts();
  seedInitialSettings();
  seedInitialCampaigns();
}

/**
 * Başlangıç Stok Verilerini Ekler
 */
function seedInitialProducts() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM products');
  const result = countStmt.get() as { count: number };

  if (result.count === 0) {
    console.log('[Database] 🚀 Ürünler tablosu boş, başlangıç stok ve fiyat verileri yükleniyor...');
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO products (short_code, product_code, name, color, size, price, stock, category)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const initialProducts = [
      { shortCode: 'KGMLW', productCode: 'KGMLW-S', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'S', price: 299.00, stock: 99, category: 'GÖMLEK' },
      { shortCode: 'KGMLW', productCode: 'KGMLW-M', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'M', price: 299.00, stock: 5, category: 'GÖMLEK' },
      { shortCode: 'KGMLW', productCode: 'KGMLW-L', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'L', price: 299.00, stock: 100, category: 'GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-S', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'S', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-M', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'M', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-L', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'L', price: 349.00, stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'DGMLP', productCode: 'DGMLP-S', name: 'DESENLİ GÖMLEK', color: 'PEMBE', size: 'S', price: 399.00, stock: 100, category: 'DESENLİ GÖMLEK' },
      { shortCode: 'DGMLP', productCode: 'DGMLP-M', name: 'DESENLİ GÖMLEK', color: 'PEMBE', size: 'M', price: 399.00, stock: 100, category: 'DESENLİ GÖMLEK' },
      { shortCode: 'NDL41', productCode: 'NDL41-41', name: 'NIKE DUNK LOW', color: 'BEYAZ/SİYAH', size: '41', price: 1299.00, stock: 50, category: 'AYAKKABI' },
      { shortCode: 'STRC39', productCode: 'STRC39-39', name: 'STAR CROSS', color: 'BEYAZ', size: '39', price: 899.00, stock: 30, category: 'AYAKKABI' },
      { shortCode: 'TSW', productCode: 'TSW-S', name: 'TSW T-SHIRT', color: 'BEYAZ', size: 'S', price: 199.00, stock: 75, category: 'T-SHIRT' }
    ];

    for (const p of initialProducts) {
      insertStmt.run(p.shortCode, p.productCode, p.name, p.color, p.size, p.price, p.stock, p.category);
    }
    console.log(`[Database] ✅ ${initialProducts.length} varsayılan ürün fiyatları ile yüklendi.`);
  }
}

/**
 * Varsayılan Sistem Ayarlarını Yükler (Kargo Ücretleri)
 */
function seedInitialSettings() {
  const setStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setStmt.run('shipping_fee', '49'); // Standard Kargo 49 TL
  setStmt.run('free_shipping_threshold', '1500'); // 1500 TL Üzeri Ücretsiz Kargo
}

/**
 * Varsayılan Kampanyaları Yükler
 */
function seedInitialCampaigns() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM campaigns');
  const result = countStmt.get() as { count: number };

  if (result.count === 0) {
    const insertStmt = db.prepare(`
      INSERT INTO campaigns (title, description, code, discount_percent, discount_amount, min_order_amount, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      '🚀 1500 TL Üzeri Ücretsiz Kargo!',
      '1500 TL ve üzeri siparişlerde kargo ücreti BARON\'S SILLAGE tarafından karşılanır.',
      'KARGO_BEDAVA',
      0, 49, 1500, 1
    );

    insertStmt.run(
      '🎉 BARONS10 İndirim Kodu',
      'Tüm siparişlerde %10 Hoşgeldin İndirimi.',
      'BARONS10',
      10, 0, 0, 1
    );

    console.log('[Database] ✅ Aktif başlangıç kampanyaları yüklendi.');
  }
}

// Veritabanını Otomatik İlklendir
initDatabase();

export function createMerchantApplication(data: {
  fullName: string;
  tcNo: string;
  phone: string;
  email: string;
  storeName: string;
  plan?: string;
  password?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO merchant_applications (full_name, tc_no, phone, email, store_name, plan, password, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
  return stmt.run(
    data.fullName,
    data.tcNo,
    data.phone,
    data.email,
    data.storeName,
    data.plan || 'Pro Store (₺6.000 / Ay)',
    data.password || '123456'
  );
}

export function getAllMerchantApplications() {
  const stmt = db.prepare(`SELECT * FROM merchant_applications ORDER BY id DESC`);
  return stmt.all();
}

export function approveMerchantApplication(identifier: number | string) {
  const idStr = String(identifier).trim();
  const idNum = parseInt(idStr, 10) || 0;
  const stmt = db.prepare(`
    UPDATE merchant_applications 
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ? OR LOWER(email) = LOWER(?) OR LOWER(store_name) = LOWER(?) OR phone = ?
  `);
  return stmt.run(idNum, idStr, idStr, idStr);
}

export function rejectMerchantApplication(identifier: number | string) {
  const idStr = String(identifier).trim();
  const idNum = parseInt(idStr, 10) || 0;
  const stmt = db.prepare(`
    UPDATE merchant_applications 
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ? OR LOWER(email) = LOWER(?) OR LOWER(store_name) = LOWER(?) OR phone = ?
  `);
  return stmt.run(idNum, idStr, idStr, idStr);
}

export function findMerchantApplicationByIdentifier(identifier: string) {
  const cleanId = (identifier || '').trim();
  const stmt = db.prepare(`
    SELECT * FROM merchant_applications 
    WHERE LOWER(email) = LOWER(?) 
       OR LOWER(store_name) = LOWER(?) 
       OR LOWER(full_name) = LOWER(?)
       OR phone = ?
       OR tc_no = ?
  `);
  return stmt.get(cleanId, cleanId, cleanId, cleanId, cleanId);
}

/**
 * Şifre Güvenliği & Hashleme (PBKDF2 / SHA-512)
 */
export function hashPassword(password: string): string {
  if (!password) return '';
  const salt = 'iscworks_salt_2026';
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `pbkdf2:sha512:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  // Düz metin geçiş desteği (eski veriler için)
  if (!storedHash.startsWith('pbkdf2:')) {
    return String(password).trim() === String(storedHash).trim();
  }
  const computed = hashPassword(password);
  return computed === storedHash;
}

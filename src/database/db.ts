import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

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

  // Auto Migrations: Kolonlar eksikse otomatik ekle
  try { db.exec(`ALTER TABLE products ADD COLUMN price REAL NOT NULL DEFAULT 299.00;`); } catch (e) {}
  try { db.exec(`ALTER TABLE products ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN total_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE orders ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN start_date TEXT DEFAULT NULL;`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN end_date TEXT DEFAULT NULL;`); } catch (e) {}
  try { db.exec(`ALTER TABLE campaigns ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}
  try { db.exec(`ALTER TABLE user_rewards ADD COLUMN store_name TEXT DEFAULT '';`); } catch (e) {}

  // İndeksler (Sorgu Hızlandırma)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_short ON products(short_code);
    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_name);
    CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_name);
    CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);
    CREATE INDEX IF NOT EXISTS idx_rewards_sender ON user_rewards(sender_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_id ON webhook_events(event_id);
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
import crypto from 'crypto';

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

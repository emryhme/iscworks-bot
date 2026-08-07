"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
/**
 * BARON'S SILLAGE SQLite Veritabanı Yöneticisi (barons.db)
 */
const dbPath = path_1.default.resolve(process.cwd(), 'barons.db');
console.log(`[Database] 🗄️ SQLite Veritabanı Yolu: ${dbPath}`);
exports.db = new better_sqlite3_1.default(dbPath, { verbose: undefined });
// Performans Ayarları (WAL Mode & Synchronous Normal)
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('synchronous = NORMAL');
/**
 * Tabloları Oluşturur (Migrations)
 */
function initDatabase() {
    // 1. Ürünler Tablosu (products)
    exports.db.exec(`
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
    exports.db.exec(`
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
    exports.db.exec(`
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
    exports.db.exec(`
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
    // Auto Migrations: Kolonlar eksikse otomatik ekle
    try {
        exports.db.exec(`ALTER TABLE products ADD COLUMN price REAL NOT NULL DEFAULT 299.00;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN total_price REAL NOT NULL DEFAULT 0;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE campaigns ADD COLUMN start_date TEXT DEFAULT NULL;`);
    }
    catch (e) { }
    try {
        exports.db.exec(`ALTER TABLE campaigns ADD COLUMN end_date TEXT DEFAULT NULL;`);
    }
    catch (e) { }
    // İndeksler (Sorgu Hızlandırma)
    exports.db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_short ON products(short_code);
    CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(active);
    CREATE INDEX IF NOT EXISTS idx_rewards_sender ON user_rewards(sender_id);
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
    const countStmt = exports.db.prepare('SELECT COUNT(*) as count FROM products');
    const result = countStmt.get();
    if (result.count === 0) {
        console.log('[Database] 🚀 Ürünler tablosu boş, başlangıç stok ve fiyat verileri yükleniyor...');
        const insertStmt = exports.db.prepare(`
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
    const setStmt = exports.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    setStmt.run('shipping_fee', '49'); // Standard Kargo 49 TL
    setStmt.run('free_shipping_threshold', '1500'); // 1500 TL Üzeri Ücretsiz Kargo
}
/**
 * Varsayılan Kampanyaları Yükler
 */
function seedInitialCampaigns() {
    const countStmt = exports.db.prepare('SELECT COUNT(*) as count FROM campaigns');
    const result = countStmt.get();
    if (result.count === 0) {
        const insertStmt = exports.db.prepare(`
      INSERT INTO campaigns (title, description, code, discount_percent, discount_amount, min_order_amount, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        insertStmt.run('🚀 1500 TL Üzeri Ücretsiz Kargo!', '1500 TL ve üzeri siparişlerde kargo ücreti BARON\'S SILLAGE tarafından karşılanır.', 'KARGO_BEDAVA', 0, 49, 1500, 1);
        insertStmt.run('🎉 BARONS10 İndirim Kodu', 'Tüm siparişlerde %10 Hoşgeldin İndirimi.', 'BARONS10', 10, 0, 0, 1);
        console.log('[Database] ✅ Aktif başlangıç kampanyaları yüklendi.');
    }
}
// Veritabanını Otomatik İlklendir
initDatabase();

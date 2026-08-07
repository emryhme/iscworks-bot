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
      status TEXT NOT NULL DEFAULT 'BEKLEMEDE',
      sender_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Auto Migration: sender_id sütunu yoksa ekle
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`);
    console.log('[Database] ➕ orders tablosuna sender_id sütunu başarıyla eklendi.');
  } catch (e) {
    // Sütun zaten mevcutsa hatayı yut
  }

  // İndeksler (Sorgu Hızlandırma)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code);
    CREATE INDEX IF NOT EXISTS idx_products_short ON products(short_code);
    CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_sender ON orders(sender_id);
  `);

  // Varsayılan Başlangıç Stok Verisini Yükle (Seed Data)
  seedInitialProducts();
}

/**
 * Başlangıç Stok Verilerini Ekler (Eğer tablo boşsa)
 */
function seedInitialProducts() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM products');
  const result = countStmt.get() as { count: number };

  if (result.count === 0) {
    console.log('[Database] 🚀 Ürünler tablosu boş, başlangıç stok verileri yükleniyor...');
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO products (short_code, product_code, name, color, size, stock, category)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const initialProducts = [
      { shortCode: 'KGMLW', productCode: 'KGMLW-S', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'S', stock: 99, category: 'GÖMLEK' },
      { shortCode: 'KGMLW', productCode: 'KGMLW-M', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'M', stock: 5, category: 'GÖMLEK' },
      { shortCode: 'KGMLW', productCode: 'KGMLW-L', name: 'KUMAŞ GÖMLEK', color: 'BEYAZ', size: 'L', stock: 100, category: 'GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-S', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'S', stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-M', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'M', stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'KTGMLB', productCode: 'KTGMLB-L', name: 'SİYAH KETEN GÖMLEK', color: 'SİYAH', size: 'L', stock: 100, category: 'KETEN GÖMLEK' },
      { shortCode: 'DGMLP', productCode: 'DGMLP-S', name: 'PEMBE DESENLİ GÖMLEK', color: 'PEMBE', size: 'S', stock: 100, category: 'DESENLİ GÖMLEK' },
      { shortCode: 'DGMLP', productCode: 'DGMLP-M', name: 'PEMBE DESENLİ GÖMLEK', color: 'PEMBE', size: 'M', stock: 100, category: 'DESENLİ GÖMLEK' },
      { shortCode: 'DGMLP', productCode: 'DGMLP-L', name: 'PEMBE DESENLİ GÖMLEK', color: 'PEMBE', size: 'L', stock: 100, category: 'DESENLİ GÖMLEK' },
      { shortCode: 'NDL41', productCode: 'NDL41-41', name: 'Nike Dunk Low', color: 'SİYAH/BEYAZ', size: '41', stock: 5, category: 'AYAKKABI' },
      { shortCode: 'STRC39', productCode: 'STRC39-39', name: 'Streç Pantolon', color: 'SİYAH', size: '39', stock: 0, category: 'PANTOLON' },
      { shortCode: 'TSW', productCode: 'TSW-S', name: 'BEYAZ TSHIRT', color: 'BEYAZ', size: 'S', stock: 50, category: 'TSHIRT' }
    ];

    const transaction = db.transaction((products) => {
      for (const p of products) {
        insertStmt.run(p.shortCode, p.productCode, p.name, p.color, p.size, p.stock, p.category);
      }
    });

    transaction(initialProducts);
    console.log('[Database] ✅ Başlangıç ürün verileri SQLite veritabanına başarıyla yüklendi!');
  }
}

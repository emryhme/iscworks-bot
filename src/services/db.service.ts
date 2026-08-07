import Database from 'better-sqlite3';
import path from 'path';

// database.sqlite dosyasının konumu
const dbPath = path.join(__dirname, '../../database.sqlite');
export const db = new Database(dbPath);

/**
 * Veritabanı tablolarını ve başlangıç verilerini hazırlayan servis.
 */
export function initDatabase() {
  // 1. Ürünler & Stok Tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      product_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      sizes TEXT NOT NULL
    );
  `);

  // 2. Siparişler Tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      address TEXT NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Varsayılan ürünler yoksa doldur
  const count = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (count.count === 0) {
    const insertProduct = db.prepare('INSERT INTO products (product_code, name, stock, sizes) VALUES (?, ?, ?, ?)');
    insertProduct.run('KGMLW', 'Keten Gömlek', 15, 'S, M, L, XL');
    insertProduct.run('NDL41', 'Nike Dunk Low', 5, '40, 41, 42, 43');
    insertProduct.run('STRC39', 'Streç Pantolon', 0, '38, 39, 40');
    console.log('[Database] 📦 Varsayılan ürünler veritabanına eklendi (KGMLW, NDL41, STRC39).');
  }

  console.log(`[Database] 🗄️ SQLite Veritabanı Aktif: ${dbPath}`);
}

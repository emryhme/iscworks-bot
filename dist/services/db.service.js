"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
// database.sqlite dosyasının konumu
const dbPath = path_1.default.join(__dirname, '../../database.sqlite');
exports.db = new better_sqlite3_1.default(dbPath);
/**
 * Veritabanı tablolarını ve başlangıç verilerini hazırlayan servis.
 */
function initDatabase() {
    // 1. Ürünler & Stok Tablosu
    exports.db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      product_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      sizes TEXT NOT NULL
    );
  `);
    // 2. Siparişler Tablosu
    exports.db.exec(`
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
    const count = exports.db.prepare('SELECT COUNT(*) as count FROM products').get();
    if (count.count === 0) {
        const insertProduct = exports.db.prepare('INSERT INTO products (product_code, name, stock, sizes) VALUES (?, ?, ?, ?)');
        insertProduct.run('KGMLW', 'Keten Gömlek', 15, 'S, M, L, XL');
        insertProduct.run('NDL41', 'Nike Dunk Low', 5, '40, 41, 42, 43');
        insertProduct.run('STRC39', 'Streç Pantolon', 0, '38, 39, 40');
        console.log('[Database] 📦 Varsayılan ürünler veritabanına eklendi (KGMLW, NDL41, STRC39).');
    }
    console.log(`[Database] 🗄️ SQLite Veritabanı Aktif: ${dbPath}`);
}

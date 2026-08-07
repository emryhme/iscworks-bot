import { db } from '../database/db';
import { GoogleSheetsService } from './google-sheets.service';

export interface ProductStockRow {
  shortCode: string;   // KISA KOD (Örn: KGMLW)
  productCode: string; // ÜRÜN KODU (Örn: KGMLW-M)
  name: string;        // ÜRÜN İSMİ (Örn: KUMAŞ GÖMLEK)
  color: string;       // RENK (Örn: BEYAZ)
  size: string;        // NUMARA/BEDEN (Örn: M)
  price: number;       // FİYAT (Örn: 299)
  stock: number;       // STOK (Örn: 5)
  category: string;    // KATEGORİ (Örn: GÖMLEK)
}

/**
 * SQLite (barons.db) Destekli Ultra Hızlı Stok Yönetim Servisi
 */
export class StockService {
  /**
   * SQLite veritabanındaki tüm ham ürün satırlarını getirir.
   */
  public static async fetchAllSheetRows(): Promise<ProductStockRow[]> {
    try {
      const stmt = db.prepare(`
        SELECT short_code as shortCode, product_code as productCode, name, color, size, price, stock, category
        FROM products
        ORDER BY id ASC
      `);
      return stmt.all() as ProductStockRow[];
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Ürünler okunamadı:', e.message);
      return [];
    }
  }

  /**
   * Tüm benzersiz ürünlerin güncel stok listesini getirir.
   */
  public static async getAllProducts(): Promise<ProductStockRow[]> {
    return await this.fetchAllSheetRows();
  }

  /**
   * Ürün Kodu (KGMLW-M), Kısa Kod (KGMLW), Beden veya Ürün İsmine göre akıllı stok sorgulama yapar.
   */
  public static async checkStock(queryInput: string): Promise<{ exists: boolean; inStock: boolean; product?: any }> {
    const rawQuery = queryInput.trim().toUpperCase();
    const rows = await this.fetchAllSheetRows();

    if (rows.length === 0) {
      return { exists: false, inStock: false };
    }

    // 1. Doğrudan ÜRÜN KODU Eşleşmesi (Örn: "KGMLW-M" veya "KGMLW-M var mı?")
    let match = rows.find(r => r.productCode.toUpperCase() === rawQuery || rawQuery.includes(r.productCode.toUpperCase()));

    // 2. Kısa Kod + Beden ayrıştırma (Örn: "KGMLW M" veya "KGMLW L")
    if (!match) {
      match = rows.find(r => {
        const pattern1 = `${r.shortCode}-${r.size}`.toUpperCase();
        const pattern2 = `${r.shortCode} ${r.size}`.toUpperCase();
        return rawQuery.includes(pattern1) || rawQuery.includes(pattern2);
      });
    }

    // 3. Kısa Kod Eşleşmesi (Örn: "KGMLW") -> Mevcut tüm bedenleri ve stok durumunu kontrol et
    if (!match) {
      const shortMatch = rows.find(r => rawQuery.includes(r.shortCode.toUpperCase()));
      if (shortMatch) {
        const shortCode = shortMatch.shortCode.toUpperCase();
        const shortMatches = rows.filter(r => r.shortCode.toUpperCase() === shortCode);
        const hasStock = shortMatches.some(r => r.stock > 0);
        const availableSizes = shortMatches.filter(r => r.stock > 0).map(r => r.size);
        return {
          exists: true,
          inStock: hasStock,
          product: {
            productCode: shortCode,
            name: shortMatch.name,
            availableSizes,
            stock: hasStock ? 1 : 0
          }
        };
      }
    }

    // 4. İsim İle Arama (Örn: "KUMAŞ GÖMLEK")
    if (!match) {
      match = rows.find(r => r.name.toUpperCase().includes(rawQuery) || rawQuery.includes(r.name.toUpperCase()));
    }

    if (!match) {
      return { exists: false, inStock: false };
    }

    return {
      exists: true,
      inStock: match.stock > 0,
      product: {
        productCode: match.productCode,
        name: `${match.name} (${match.size})`,
        stock: match.stock,
        size: match.size
      }
    };
  }

  /**
   * Stok Eksiltme (Sipariş Gerçekleştiğinde: -quantity)
   */
  public static async deductStock(productCode: string, quantity: number, size?: string): Promise<boolean> {
    try {
      const targetCode = productCode.trim().toUpperCase();
      const targetSize = size ? size.trim().toUpperCase() : '';

      let stmt;
      let result;

      if (targetCode.includes('-')) {
        stmt = db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
        const parts = targetCode.split('-');
        result = stmt.run(quantity, targetCode, parts[0], parts[1] || targetSize);
      } else if (targetSize) {
        const fullCode = `${targetCode}-${targetSize}`;
        stmt = db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
        result = stmt.run(quantity, fullCode, targetCode, targetSize);
      } else {
        stmt = db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?
        `);
        result = stmt.run(quantity, targetCode, targetCode);
      }

      console.log(`[StockService SQLite] 📦 Stok Düşüldü (${targetCode}): -${quantity} (Etkilenen Satır: ${result.changes})`);

      // Google Sheets Senkronizasyonu
      const updatedProd = db.prepare(`SELECT stock, product_code FROM products WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?`).get(targetCode, targetCode) as any;
      if (updatedProd && updatedProd.stock !== undefined) {
        GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => {});
      }

      return result.changes > 0;
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Stok düşülemedi:', e.message);
      return false;
    }
  }

  /**
   * Stok İade Etme / Artırma (Sipariş Reddedildiğinde / İptal Edildiğinde: +quantity)
   */
  public static async restoreStock(productCode: string, quantity: number, size?: string): Promise<boolean> {
    try {
      const targetCode = productCode.trim().toUpperCase();
      const targetSize = size ? size.trim().toUpperCase() : '';

      let stmt;
      let result;

      if (targetCode.includes('-')) {
        stmt = db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
        const parts = targetCode.split('-');
        result = stmt.run(quantity, targetCode, parts[0], parts[1] || targetSize);
      } else if (targetSize) {
        const fullCode = `${targetCode}-${targetSize}`;
        stmt = db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?)
        `);
        result = stmt.run(quantity, fullCode, targetCode, targetSize);
      } else {
        stmt = db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?
        `);
        result = stmt.run(quantity, targetCode, targetCode);
      }

      console.log(`[StockService SQLite] 🔄 Stok İade Edildi (${targetCode}): +${quantity} (Etkilenen Satır: ${result.changes})`);

      // Google Sheets Senkronizasyonu
      const updatedProd = db.prepare(`SELECT stock, product_code FROM products WHERE UPPER(product_code) = ? OR UPPER(short_code) = ?`).get(targetCode, targetCode) as any;
      if (updatedProd && updatedProd.stock !== undefined) {
        GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => {});
      }

      return result.changes > 0;
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Stok iade edilemedi:', e.message);
      return false;
    }
  }

  /**
   * SQLite Veritabanına Yeni Ürün Ekler veya Günceller
   */
  public static async addProduct(data: {
    shortCode: string;
    productCode?: string;
    name: string;
    color?: string;
    size: string;
    stock: number;
    category?: string;
  }): Promise<{ success: boolean; productCode: string }> {
    try {
      const shortCode = data.shortCode.trim().toUpperCase();
      const size = data.size.trim().toUpperCase();
      const productCode = data.productCode && data.productCode.trim() !== '' 
        ? data.productCode.trim().toUpperCase() 
        : `${shortCode}-${size}`;
      const name = data.name.trim();
      const color = (data.color || '').trim();
      const stock = Number(data.stock) || 0;
      const category = (data.category || '').trim();

      const stmt = db.prepare(`
        INSERT INTO products (short_code, product_code, name, color, size, stock, category, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(product_code) DO UPDATE SET
          name = excluded.name,
          color = excluded.color,
          size = excluded.size,
          stock = excluded.stock,
          category = excluded.category,
          updated_at = CURRENT_TIMESTAMP
      `);

      stmt.run(shortCode, productCode, name, color, size, stock, category);
      console.log(`[StockService SQLite] ✅ Ürün eklendi/güncellendi: ${productCode}`);
      return { success: true, productCode };
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Ürün eklenemedi:', e.message);
      return { success: false, productCode: data.productCode || data.shortCode };
    }
  }

  /**
   * SQLite Veritabanından Ürün Siler
   */
  public static async deleteProduct(productCode: string): Promise<boolean> {
    try {
      const stmt = db.prepare(`DELETE FROM products WHERE product_code = ? OR short_code = ?`);
      const target = productCode.trim().toUpperCase();
      const res = stmt.run(target, target);
      console.log(`[StockService SQLite] 🗑️ Ürün silindi: ${target}`);

      // Google Sheets Senkronizasyonu
      GoogleSheetsService.deleteProductRow(target).catch(() => {});
      return res.changes > 0;
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Ürün silinemedi:', e.message);
      return false;
    }
  }

  /**
   * SQLite Veritabanında Ürün Stok Miktarını Günceller
   */
  public static async updateStock(productCode: string, newStock: number): Promise<boolean> {
    try {
      const stmt = db.prepare(`
        UPDATE products
        SET stock = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_code = ? OR short_code = ?
      `);
      const target = productCode.trim().toUpperCase();
      const res = stmt.run(Number(newStock), target, target);
      console.log(`[StockService SQLite] 📦 Ürün (${target}) Stoğu Güncellendi: ${newStock}`);

      // Google Sheets Senkronizasyonu
      GoogleSheetsService.updateProductStock(target, Number(newStock)).catch(() => {});
      return res.changes > 0;
    } catch (e: any) {
      console.error('[StockService SQLite] ❌ Ürün stoğu güncellenemedi:', e.message);
      return false;
    }
  }
}

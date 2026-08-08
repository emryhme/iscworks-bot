import { db } from '../database/db';

export interface StockCheckResult {
  available: boolean;
  stock: number;
  reserved: number;
  netAvailable: number;
}

/**
 * Enterprise Inventory Management & Reservation Service
 */
export class InventoryService {
  /**
   * getStock - Fetches total, reserved, and net available stock for a product in a specific store
   */
  public static getStock(storeId: number, productCode: string): StockCheckResult {
    const pCode = (productCode || '').trim();
    
    // Check inventory table first
    let inv = db.prepare('SELECT stock, reserved_stock FROM inventory WHERE store_id = ? AND product_code = ?').get(storeId, pCode) as any;
    
    if (!inv) {
      // Fallback lookup in products table
      const prod = db.prepare('SELECT stock FROM products WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)').get(storeId, pCode, pCode) as any;
      const stock = prod ? Number(prod.stock) || 0 : 0;
      return { available: stock > 0, stock: stock, reserved: 0, netAvailable: stock };
    }

    const stock = Number(inv.stock) || 0;
    const reserved = Number(inv.reserved_stock) || 0;
    const net = Math.max(0, stock - reserved);

    return {
      available: net > 0,
      stock: stock,
      reserved: reserved,
      netAvailable: net
    };
  }

  /**
   * checkAvailability - Checks if requested quantity is available
   */
  public static checkAvailability(storeId: number, productCode: string, quantity: number): boolean {
    const res = this.getStock(storeId, productCode);
    return res.netAvailable >= Math.max(1, quantity);
  }

  /**
   * reserveStock - Temporarily reserves stock for cart / checkout
   */
  public static reserveStock(storeId: number, productCode: string, quantity: number): boolean {
    const q = Math.max(1, quantity);
    const pCode = (productCode || '').trim();

    if (!this.checkAvailability(storeId, pCode, q)) {
      return false;
    }

    const stmt = db.prepare(`
      INSERT INTO inventory (store_id, product_code, stock, reserved_stock)
      VALUES (?, ?, 0, ?)
      ON CONFLICT(product_code) DO UPDATE SET
        reserved_stock = reserved_stock + ?,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(storeId, pCode, q, q);
    return true;
  }

  /**
   * releaseStock - Releases temporary stock reservation (e.g. cancelled checkout / payment failure)
   */
  public static releaseStock(storeId: number, productCode: string, quantity: number): void {
    const q = Math.max(1, quantity);
    const pCode = (productCode || '').trim();

    db.prepare(`
      UPDATE inventory 
      SET reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND product_code = ?
    `).run(q, storeId, pCode);
  }

  /**
   * deductStock - Permanently deducts stock upon order confirmation (Single Owner)
   */
  public static deductStock(storeId: number, productCode: string, quantity: number): boolean {
    const q = Math.max(1, quantity);
    const pCode = (productCode || '').trim();

    const result = db.prepare(`
      UPDATE products 
      SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)
    `).run(q, storeId, pCode, pCode);

    // Synchronize inventory table
    db.prepare(`
      UPDATE inventory 
      SET stock = MAX(0, stock - ?), reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND product_code = ?
    `).run(q, q, storeId, pCode);

    return result.changes > 0;
  }

  /**
   * restoreStock - Restores stock upon order cancellation or return
   */
  public static restoreStock(storeId: number, productCode: string, quantity: number): void {
    const q = Math.max(1, quantity);
    const pCode = (productCode || '').trim();

    db.prepare(`
      UPDATE products 
      SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)
    `).run(q, storeId, pCode, pCode);
  }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const db_1 = require("../database/db");
/**
 * Enterprise Inventory Management & Reservation Service
 */
class InventoryService {
    /**
     * getStock - Fetches total, reserved, and net available stock for a product in a specific store
     */
    static getStock(storeId, productCode) {
        const pCode = (productCode || '').trim();
        // Check inventory table first
        let inv = db_1.db.prepare('SELECT stock, reserved_stock FROM inventory WHERE store_id = ? AND product_code = ?').get(storeId, pCode);
        if (!inv) {
            // Fallback lookup in products table
            const prod = db_1.db.prepare('SELECT stock FROM products WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)').get(storeId, pCode, pCode);
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
    static checkAvailability(storeId, productCode, quantity) {
        const res = this.getStock(storeId, productCode);
        return res.netAvailable >= Math.max(1, quantity);
    }
    /**
     * reserveStock - Temporarily reserves stock for cart / checkout
     */
    static reserveStock(storeId, productCode, quantity) {
        const q = Math.max(1, quantity);
        const pCode = (productCode || '').trim();
        if (!this.checkAvailability(storeId, pCode, q)) {
            return false;
        }
        const stmt = db_1.db.prepare(`
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
    static releaseStock(storeId, productCode, quantity) {
        const q = Math.max(1, quantity);
        const pCode = (productCode || '').trim();
        db_1.db.prepare(`
      UPDATE inventory 
      SET reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND product_code = ?
    `).run(q, storeId, pCode);
    }
    /**
     * deductStock - Permanently deducts stock upon order confirmation (Single Owner)
     */
    static deductStock(storeId, productCode, quantity) {
        const q = Math.max(1, quantity);
        const pCode = (productCode || '').trim();
        const result = db_1.db.prepare(`
      UPDATE products 
      SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)
    `).run(q, storeId, pCode, pCode);
        // Synchronize inventory table
        db_1.db.prepare(`
      UPDATE inventory 
      SET stock = MAX(0, stock - ?), reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND product_code = ?
    `).run(q, q, storeId, pCode);
        return result.changes > 0;
    }
    /**
     * restoreStock - Restores stock upon order cancellation or return
     */
    static restoreStock(storeId, productCode, quantity) {
        const q = Math.max(1, quantity);
        const pCode = (productCode || '').trim();
        db_1.db.prepare(`
      UPDATE products 
      SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE (store_id = ? OR store_id = 1) AND (product_code = ? OR short_code = ?)
    `).run(q, storeId, pCode, pCode);
    }
}
exports.InventoryService = InventoryService;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const db_1 = require("../database/db");
/**
 * Enterprise Multi-Tenant Inventory Management & Reservation Service
 */
class InventoryService {
    static validateStoreId(storeId) {
        if (typeof storeId !== 'number' || isNaN(storeId) || storeId <= 0) {
            throw new Error('Store ID zorunludur ve geçerli bir pozitif sayı olmalıdır.');
        }
    }
    static getStock(storeIdOrCode, productCode) {
        let storeId;
        let pCode;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = (productCode || '').trim().toUpperCase();
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return { available: false, stock: 0, reserved: 0, netAvailable: 0 };
        }
        this.validateStoreId(storeId);
        // Check inventory table first for this exact store
        let inv = db_1.db.prepare('SELECT stock, reserved_stock FROM inventory WHERE store_id = ? AND UPPER(product_code) = ?').get(storeId, pCode);
        if (!inv) {
            // Lookup in products table strictly scoped to storeId (No store_id = 1 fallback!)
            const prod = db_1.db.prepare('SELECT stock FROM products WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)').get(storeId, pCode, pCode);
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
    static checkAvailability(storeIdOrCode, quantityOrCode, quantity) {
        let storeId;
        let pCode;
        let q;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = String(quantityOrCode || '');
            q = Number(quantity) || 1;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        const res = this.getStock(storeId, pCode);
        return res.netAvailable >= Math.max(1, q);
    }
    static reserveStock(storeIdOrCode, quantityOrCode, quantity) {
        let storeId;
        let pCode;
        let q;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = String(quantityOrCode || '').trim().toUpperCase();
            q = Number(quantity) || 1;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        if (!this.checkAvailability(storeId, pCode, q)) {
            return false;
        }
        let inv = db_1.db.prepare('SELECT id, reserved_stock FROM inventory WHERE store_id = ? AND UPPER(product_code) = ?').get(storeId, pCode);
        if (inv) {
            db_1.db.prepare(`
        UPDATE inventory 
        SET reserved_stock = reserved_stock + ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(q, inv.id);
        }
        else {
            // Pull stock from products table
            const prod = db_1.db.prepare('SELECT stock FROM products WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)').get(storeId, pCode, pCode);
            const prodStock = prod ? Number(prod.stock) || 0 : 0;
            db_1.db.prepare(`
        INSERT INTO inventory (store_id, product_code, stock, reserved_stock, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(storeId, pCode, prodStock, q);
        }
        return true;
    }
    static releaseStock(storeIdOrCode, quantityOrCode, quantity) {
        let storeId;
        let pCode;
        let q;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = String(quantityOrCode || '').trim().toUpperCase();
            q = Number(quantity) || 1;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return;
        }
        this.validateStoreId(storeId);
        db_1.db.prepare(`
      UPDATE inventory 
      SET reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND UPPER(product_code) = ?
    `).run(q, storeId, pCode);
    }
    static deductStock(storeIdOrCode, quantityOrCode, quantity) {
        let storeId;
        let pCode;
        let q;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = String(quantityOrCode || '').trim().toUpperCase();
            q = Number(quantity) || 1;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        const result = db_1.db.prepare(`
      UPDATE products 
      SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)
    `).run(q, storeId, pCode, pCode);
        // Synchronize inventory table
        db_1.db.prepare(`
      UPDATE inventory 
      SET stock = MAX(0, stock - ?), reserved_stock = MAX(0, reserved_stock - ?), updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND UPPER(product_code) = ?
    `).run(q, q, storeId, pCode);
        return result.changes > 0;
    }
    static restoreStock(storeIdOrCode, quantityOrCode, quantity) {
        let storeId;
        let pCode;
        let q;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            pCode = String(quantityOrCode || '').trim().toUpperCase();
            q = Number(quantity) || 1;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return;
        }
        this.validateStoreId(storeId);
        db_1.db.prepare(`
      UPDATE products 
      SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)
    `).run(q, storeId, pCode, pCode);
        db_1.db.prepare(`
      UPDATE inventory 
      SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP 
      WHERE store_id = ? AND UPPER(product_code) = ?
    `).run(q, storeId, pCode);
    }
}
exports.InventoryService = InventoryService;

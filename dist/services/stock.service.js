"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockService = void 0;
const db_1 = require("../database/db");
const google_sheets_service_1 = require("./google-sheets.service");
/**
 * SQLite (barons.db) Destekli Ultra Hızlı Multi-Tenant Stok Yönetim Servisi
 */
class StockService {
    static validateStoreId(storeId) {
        if (typeof storeId !== 'number' || isNaN(storeId) || storeId <= 0) {
            throw new Error('Store ID zorunludur ve geçerli bir pozitif sayı olmalıdır.');
        }
    }
    static async fetchAllSheetRows(storeId) {
        this.validateStoreId(storeId);
        try {
            const stmt = db_1.db.prepare(`
        SELECT short_code as shortCode, product_code as productCode, name, color, size, price, stock, category, store_id as storeId
        FROM products
        WHERE store_id = ?
        ORDER BY id ASC
      `);
            return stmt.all(storeId);
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Ürünler okunamadı (Store: ${storeId}):`, e.message);
            return [];
        }
    }
    static async getAllProducts(storeId) {
        return await this.fetchAllSheetRows(storeId);
    }
    static async checkStock(storeIdOrQuery, queryInput) {
        let storeId;
        let rawQuery;
        if (typeof storeIdOrQuery === 'number') {
            storeId = storeIdOrQuery;
            rawQuery = (queryInput || '').trim().toUpperCase();
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return { exists: false, inStock: false };
        }
        this.validateStoreId(storeId);
        const rows = await this.fetchAllSheetRows(storeId);
        if (rows.length === 0) {
            return { exists: false, inStock: false };
        }
        // 1. Doğrudan ÜRÜN KODU Eşleşmesi
        let match = rows.find(r => r.productCode.toUpperCase() === rawQuery || rawQuery.includes(r.productCode.toUpperCase()));
        // 2. Kısa Kod + Beden ayrıştırma
        if (!match) {
            match = rows.find(r => {
                const pattern1 = `${r.shortCode}-${r.size}`.toUpperCase();
                const pattern2 = `${r.shortCode} ${r.size}`.toUpperCase();
                return rawQuery.includes(pattern1) || rawQuery.includes(pattern2);
            });
        }
        // 3. Kısa Kod Eşleşmesi
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
        // 4. İsim İle Arama
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
                size: match.size,
                price: match.price
            }
        };
    }
    static async deductStock(storeIdOrCode, quantityOrCode, sizeOrQty, size) {
        let storeId;
        let productCode;
        let quantity;
        let targetSize;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            productCode = String(quantityOrCode || '');
            quantity = Number(sizeOrQty) || 1;
            targetSize = size ? size.trim().toUpperCase() : '';
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        try {
            const targetCode = productCode.trim().toUpperCase();
            let stmt;
            let result;
            if (targetCode.includes('-')) {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?))
        `);
                const parts = targetCode.split('-');
                result = stmt.run(quantity, storeId, targetCode, parts[0], parts[1] || targetSize);
            }
            else if (targetSize) {
                const fullCode = `${targetCode}-${targetSize}`;
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?))
        `);
                result = stmt.run(quantity, storeId, fullCode, targetCode, targetSize);
            }
            else {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)
        `);
                result = stmt.run(quantity, storeId, targetCode, targetCode);
            }
            // Synchronize inventory table
            try {
                db_1.db.prepare(`
          UPDATE inventory 
          SET stock = MAX(0, stock - ?), updated_at = CURRENT_TIMESTAMP 
          WHERE store_id = ? AND UPPER(product_code) = ?
        `).run(quantity, storeId, targetCode);
            }
            catch (e) { }
            console.log(`[StockService SQLite] 📦 Stok Düşüldü (Store: ${storeId}, ${targetCode}): -${quantity} (Etkilenen Satır: ${result.changes})`);
            if (storeId === 1) {
                const updatedProd = db_1.db.prepare(`SELECT stock, product_code FROM products WHERE store_id = 1 AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)`).get(targetCode, targetCode);
                if (updatedProd && updatedProd.stock !== undefined) {
                    google_sheets_service_1.GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => { });
                }
            }
            return result.changes > 0;
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Stok düşülemedi (Store: ${storeId}):`, e.message);
            return false;
        }
    }
    static async restoreStock(storeIdOrCode, quantityOrCode, sizeOrQty, size) {
        let storeId;
        let productCode;
        let quantity;
        let targetSize;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            productCode = String(quantityOrCode || '');
            quantity = Number(sizeOrQty) || 1;
            targetSize = size ? size.trim().toUpperCase() : '';
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        try {
            const targetCode = productCode.trim().toUpperCase();
            let stmt;
            let result;
            if (targetCode.includes('-')) {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?))
        `);
                const parts = targetCode.split('-');
                result = stmt.run(quantity, storeId, targetCode, parts[0], parts[1] || targetSize);
            }
            else if (targetSize) {
                const fullCode = `${targetCode}-${targetSize}`;
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR (UPPER(short_code) = ? AND UPPER(size) = ?))
        `);
                result = stmt.run(quantity, storeId, fullCode, targetCode, targetSize);
            }
            else {
                stmt = db_1.db.prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)
        `);
                result = stmt.run(quantity, storeId, targetCode, targetCode);
            }
            // Synchronize inventory table
            try {
                db_1.db.prepare(`
          UPDATE inventory 
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP 
          WHERE store_id = ? AND UPPER(product_code) = ?
        `).run(quantity, storeId, targetCode);
            }
            catch (e) { }
            console.log(`[StockService SQLite] 🔄 Stok İade Edildi (Store: ${storeId}, ${targetCode}): +${quantity}`);
            if (storeId === 1) {
                const updatedProd = db_1.db.prepare(`SELECT stock, product_code FROM products WHERE store_id = 1 AND (UPPER(product_code) = ? OR UPPER(short_code) = ?)`).get(targetCode, targetCode);
                if (updatedProd && updatedProd.stock !== undefined) {
                    google_sheets_service_1.GoogleSheetsService.updateProductStock(updatedProd.product_code || targetCode, updatedProd.stock).catch(() => { });
                }
            }
            return result.changes > 0;
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Stok iade edilemedi (Store: ${storeId}):`, e.message);
            return false;
        }
    }
    static async addProduct(data) {
        this.validateStoreId(data?.storeId);
        try {
            const storeId = data.storeId;
            const shortCode = String(data.shortCode || '').trim().toUpperCase();
            const size = String(data.size || '').trim().toUpperCase();
            const productCode = data.productCode && data.productCode.trim() !== ''
                ? data.productCode.trim().toUpperCase()
                : `${shortCode}-${size}`;
            const name = String(data.name || '').trim();
            const color = (data.color || 'Standart').trim();
            const stock = Math.max(0, Number(data.stock) || 0);
            const price = Number(data.price) || 299;
            const category = (data.category || 'Genel').trim();
            const storeName = (data.storeName || '').trim();
            const existing = db_1.db.prepare('SELECT id FROM products WHERE store_id = ? AND (product_code = ? OR (short_code = ? AND size = ?))').get(storeId, productCode, shortCode, size);
            if (existing) {
                db_1.db.prepare(`
          UPDATE products 
          SET name = ?, color = ?, size = ?, stock = ?, price = ?, category = ?, store_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE store_id = ? AND id = ?
        `).run(name, color, size, stock, price, category, storeName, storeId, existing.id);
            }
            else {
                db_1.db.prepare(`
          INSERT INTO products (short_code, product_code, name, color, size, stock, price, category, store_name, store_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(shortCode, productCode, name, color, size, stock, price, category, storeName, storeId);
            }
            // Synchronize inventory table
            try {
                let inv = db_1.db.prepare('SELECT id FROM inventory WHERE store_id = ? AND product_code = ?').get(storeId, productCode);
                if (inv) {
                    db_1.db.prepare('UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(stock, inv.id);
                }
                else {
                    db_1.db.prepare('INSERT INTO inventory (store_id, product_code, stock, reserved_stock, updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)').run(storeId, productCode, stock);
                }
            }
            catch (e) { }
            console.log(`[StockService SQLite] ✅ Ürün eklendi/güncellendi (Store: ${storeId}): ${productCode} (Stok: ${stock}, Fiyat: ${price} TL)`);
            return { success: true, productCode };
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Ürün eklenemedi:`, e.message);
            return { success: false, productCode: data.productCode || data.shortCode };
        }
    }
    static async deleteProduct(storeIdOrCode, productCode) {
        let storeId;
        let targetCode;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            targetCode = String(productCode || '');
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        try {
            const target = targetCode.trim().toUpperCase();
            const stmt = db_1.db.prepare(`DELETE FROM products WHERE store_id = ? AND (product_code = ? OR short_code = ?)`);
            const res = stmt.run(storeId, target, target);
            // Synchronize inventory table
            try {
                db_1.db.prepare(`DELETE FROM inventory WHERE store_id = ? AND (product_code = ? OR product_code LIKE ?)`).run(storeId, target, `${target}-%`);
            }
            catch (e) { }
            console.log(`[StockService SQLite] 🗑️ Ürün silindi (Store: ${storeId}): ${target}`);
            if (storeId === 1) {
                google_sheets_service_1.GoogleSheetsService.deleteProductRow(target).catch(() => { });
            }
            return res.changes > 0;
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Ürün silinemedi (Store: ${storeId}):`, e.message);
            return false;
        }
    }
    static async updateStock(storeIdOrCode, productCodeOrStock, newStock) {
        let storeId;
        let targetCode;
        let stockNum;
        if (typeof storeIdOrCode === 'number') {
            storeId = storeIdOrCode;
            targetCode = String(productCodeOrStock || '');
            stockNum = Number(newStock) || 0;
        }
        else {
            this.validateStoreId(undefined); // Throws Error
            return false;
        }
        this.validateStoreId(storeId);
        try {
            const target = targetCode.trim().toUpperCase();
            const stmt = db_1.db.prepare(`
        UPDATE products
        SET stock = ?, updated_at = CURRENT_TIMESTAMP
        WHERE store_id = ? AND (product_code = ? OR short_code = ?)
      `);
            const res = stmt.run(stockNum, storeId, target, target);
            // Synchronize inventory table
            try {
                let inv = db_1.db.prepare('SELECT id FROM inventory WHERE store_id = ? AND product_code = ?').get(storeId, target);
                if (inv) {
                    db_1.db.prepare('UPDATE inventory SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(stockNum, inv.id);
                }
                else {
                    db_1.db.prepare('INSERT INTO inventory (store_id, product_code, stock, reserved_stock, updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)').run(storeId, target, stockNum);
                }
            }
            catch (e) { }
            console.log(`[StockService SQLite] 📦 Ürün (${target}) Stoğu Güncellendi (Store: ${storeId}): ${stockNum}`);
            if (storeId === 1) {
                google_sheets_service_1.GoogleSheetsService.updateProductStock(target, stockNum).catch(() => { });
            }
            return res.changes > 0;
        }
        catch (e) {
            console.error(`[StockService SQLite] ❌ Ürün stoğu güncellenemedi (Store: ${storeId}):`, e.message);
            return false;
        }
    }
}
exports.StockService = StockService;

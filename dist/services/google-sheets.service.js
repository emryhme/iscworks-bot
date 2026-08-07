"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleSheetsService = void 0;
const googleapis_1 = require("googleapis");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Google Sheets Service Account Entegrasyon Servisi (Hızlı Önbellekli & Toplu İstek Destekli)
 */
class GoogleSheetsService {
    static sheetsClient = null;
    // Önbellek (In-Memory Cache) Mekanizması
    static stockCache = null;
    static ordersCache = null;
    static CACHE_TTL_MS = 15000; // 15 Saniye Önbellek Yaşam Süresi
    // Google Sheet ID'leri (n8n projenizdeki mevcut tablolar)
    static STOCK_SPREADSHEET_ID = process.env.GOOGLE_STOCK_SHEET_ID || '18RoVq1V-Vb5Adv8Tcr4MiVaUwtRpnr3w827X6CWSOx0';
    static ORDERS_SPREADSHEET_ID = process.env.GOOGLE_ORDERS_SHEET_ID || '1xM_gc81Zsb4GtYN96nyjPmXxvFaWnMM3WRm2qtmfUZo';
    /**
     * Önbelleği Temizler (Yazma işlemlerinden sonra çağrılır).
     */
    static clearCache() {
        this.stockCache = null;
        this.ordersCache = null;
    }
    /**
     * Google Service Account İstemcisini Hazırlar.
     */
    static getSheetsClient() {
        if (this.sheetsClient)
            return this.sheetsClient;
        const jsonPath = path_1.default.join(__dirname, '../../service-account.json');
        let auth;
        if (fs_1.default.existsSync(jsonPath)) {
            console.log('[GoogleSheetsService] 🔑 service-account.json dosyası ile yetkilendiriliyor...');
            auth = new googleapis_1.google.auth.GoogleAuth({
                keyFile: jsonPath,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
        }
        else {
            console.log('[GoogleSheetsService] 🔑 Ortam değişkenleri (.env) ile yetkilendiriliyor...');
            const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
            const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
            auth = new googleapis_1.google.auth.JWT({
                email: clientEmail,
                key: privateKey,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
        }
        this.sheetsClient = googleapis_1.google.sheets({ version: 'v4', auth });
        return this.sheetsClient;
    }
    /**
     * Google Sheets Tablosundan Stok Verilerini Okur (Önbellekli - Hızlı).
     */
    static async fetchStockSheet(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.stockCache && (now - this.stockCache.timestamp < this.CACHE_TTL_MS)) {
            return this.stockCache.data;
        }
        try {
            const sheets = this.getSheetsClient();
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: this.STOCK_SPREADSHEET_ID,
                range: 'GÖMLEK!A1:Z100'
            });
            const data = res.data.values || [];
            this.stockCache = { data, timestamp: Date.now() };
            return data;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Stok tablosu okunamadı:', error?.message || error);
            return this.stockCache?.data || [];
        }
    }
    /**
     * Google Sheets Tablosundan Tüm Sipariş Verilerini Okur (Önbellekli - Hızlı).
     */
    static async fetchOrdersSheet(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.ordersCache && (now - this.ordersCache.timestamp < this.CACHE_TTL_MS)) {
            return this.ordersCache.data;
        }
        try {
            const sheets = this.getSheetsClient();
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: this.ORDERS_SPREADSHEET_ID,
                range: 'Sayfa1!A1:Z200'
            });
            const data = res.data.values || [];
            this.ordersCache = { data, timestamp: Date.now() };
            return data;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Siparişler tablosu okunamadı:', error?.message || error);
            return this.ordersCache?.data || [];
        }
    }
    /**
     * Sipariş Verisini Google Sheets 'SİPARİŞLER' Tablosuna Ekle (Append).
     */
    static async appendOrderRow(rowValues) {
        try {
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.append({
                spreadsheetId: this.ORDERS_SPREADSHEET_ID,
                range: 'Sayfa1!A:I',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [rowValues]
                }
            });
            this.clearCache();
            console.log('[GoogleSheetsService] ✅ Sipariş Google Sheets tablosuna başarıyla yazıldı!');
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Sipariş Google Sheets tablosuna yazılamadı:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosuna Yeni Ürün Ekler (Append).
     */
    static async appendProductRow(rowValues) {
        try {
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.append({
                spreadsheetId: this.STOCK_SPREADSHEET_ID,
                range: 'GÖMLEK!A:G',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [rowValues]
                }
            });
            this.clearCache();
            console.log('[GoogleSheetsService] ✅ Yeni ürün Google Sheets stok tablosuna yazıldı!');
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Ürün Google Sheets tablosuna yazılamadı:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosuna Çoklu Ürün Ekler (Toplu - Ultra Hızlı Single Request).
     */
    static async appendProductRowsBatch(rowsArray) {
        try {
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.append({
                spreadsheetId: this.STOCK_SPREADSHEET_ID,
                range: 'GÖMLEK!A:G',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: rowsArray
                }
            });
            this.clearCache();
            console.log(`[GoogleSheetsService] ⚡ ${rowsArray.length} adet ürün tek bir istekte Google Sheets stok tablosuna yazıldı!`);
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Toplu ürün Google Sheets tablosuna yazılamadı:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosundaki Belirli Siparişin Durumunu Günceller (DURUM = OK veya DEC).
     */
    static async updateOrderStatus(orderId, status) {
        try {
            const rows = await this.fetchOrdersSheet(true);
            if (!rows || rows.length === 0)
                return false;
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] && rows[i][7] && rows[i][7].toString().trim() === orderId.trim()) {
                    rowIndex = i + 1;
                    break;
                }
            }
            if (rowIndex === -1) {
                console.warn(`[GoogleSheetsService] ⚠️ Sipariş No bulunamadı: ${orderId}`);
                return false;
            }
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.update({
                spreadsheetId: this.ORDERS_SPREADSHEET_ID,
                range: `Sayfa1!I${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[status]]
                }
            });
            this.clearCache();
            console.log(`[GoogleSheetsService] ✅ Sipariş (${orderId}) Durumu Güncellendi: ${status}`);
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Sipariş durumu güncellenemedi:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosundan Belirli Bir Ürün Satırını Siler.
     */
    static async deleteProductRow(productCode) {
        try {
            const rows = await this.fetchStockSheet(true);
            if (!rows || rows.length === 0)
                return false;
            const target = productCode.trim().toUpperCase();
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row && (row[1]?.toString().trim().toUpperCase() === target || row[0]?.toString().trim().toUpperCase() === target)) {
                    rowIndex = i + 1;
                    break;
                }
            }
            if (rowIndex === -1) {
                console.warn(`[GoogleSheetsService] ⚠️ Silinecek ürün kodu bulunamadı: ${productCode}`);
                return false;
            }
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.clear({
                spreadsheetId: this.STOCK_SPREADSHEET_ID,
                range: `GÖMLEK!A${rowIndex}:Z${rowIndex}`
            });
            this.clearCache();
            console.log(`[GoogleSheetsService] 🗑️ Ürün (${productCode}) Google Sheets stok tablosundan silindi!`);
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Ürün silinemedi:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosundan Belirli Bir Sipariş Satırını Siler.
     */
    static async deleteOrderRow(orderId) {
        try {
            const rows = await this.fetchOrdersSheet(true);
            if (!rows || rows.length === 0)
                return false;
            const target = orderId.trim();
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row && row[7] && row[7].toString().trim() === target) {
                    rowIndex = i + 1;
                    break;
                }
            }
            if (rowIndex === -1) {
                console.warn(`[GoogleSheetsService] ⚠️ Silinecek sipariş no bulunamadı: ${orderId}`);
                return false;
            }
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.clear({
                spreadsheetId: this.ORDERS_SPREADSHEET_ID,
                range: `Sayfa1!A${rowIndex}:Z${rowIndex}`
            });
            this.clearCache();
            console.log(`[GoogleSheetsService] 🗑️ Sipariş (${orderId}) Google Sheets siparişler tablosundan silindi!`);
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Sipariş silinemedi:', error?.message || error);
            return false;
        }
    }
    /**
     * Google Sheets Tablosunda Ürün Stok Miktarını Günceller (Sütun F).
     */
    static async updateProductStock(productCode, newStock) {
        try {
            const rows = await this.fetchStockSheet(true);
            if (!rows || rows.length === 0)
                return false;
            const target = productCode.trim().toUpperCase();
            let rowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row && (row[1]?.toString().trim().toUpperCase() === target || row[0]?.toString().trim().toUpperCase() === target)) {
                    rowIndex = i + 1;
                    break;
                }
            }
            if (rowIndex === -1) {
                console.warn(`[GoogleSheetsService] ⚠️ Stok güncellenecek ürün kodu bulunamadı: ${productCode}`);
                return false;
            }
            const sheets = this.getSheetsClient();
            await sheets.spreadsheets.values.update({
                spreadsheetId: this.STOCK_SPREADSHEET_ID,
                range: `GÖMLEK!F${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [[newStock]]
                }
            });
            this.clearCache();
            console.log(`[GoogleSheetsService] 📦 Ürün (${productCode}) Stoğu Güncellendi: ${newStock}`);
            return true;
        }
        catch (error) {
            console.error('[GoogleSheetsService] ❌ Ürün stoğu güncellenemedi:', error?.message || error);
            return false;
        }
    }
}
exports.GoogleSheetsService = GoogleSheetsService;

import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

/**
 * Google Sheets Service Account Entegrasyon Servisi (Hızlı Önbellekli & Toplu İstek Destekli)
 */
export class GoogleSheetsService {
  private static sheetsClient: any = null;

  // Önbellek (In-Memory Cache) Mekanizması
  private static stockCache: { data: any[]; timestamp: number } | null = null;
  private static ordersCache: { data: any[]; timestamp: number } | null = null;
  private static CACHE_TTL_MS = 15000; // 15 Saniye Önbellek Yaşam Süresi

  // Google Sheet ID'leri (n8n projenizdeki mevcut tablolar)
  public static STOCK_SPREADSHEET_ID = process.env.GOOGLE_STOCK_SHEET_ID || '18RoVq1V-Vb5Adv8Tcr4MiVaUwtRpnr3w827X6CWSOx0';
  public static ORDERS_SPREADSHEET_ID = process.env.GOOGLE_ORDERS_SHEET_ID || '1xM_gc81Zsb4GtYN96nyjPmXxvFaWnMM3WRm2qtmfUZo';

  /**
   * Önbelleği Temizler (Yazma işlemlerinden sonra çağrılır).
   */
  public static clearCache() {
    this.stockCache = null;
    this.ordersCache = null;
  }

  /**
   * Google Service Account İstemcisini Hazırlar.
   */
  private static getSheetsClient() {
    if (this.sheetsClient) return this.sheetsClient;

    const jsonPath = path.join(__dirname, '../../service-account.json');
    let auth;

    if (fs.existsSync(jsonPath)) {
      console.log('[GoogleSheetsService] 🔑 service-account.json dosyası ile yetkilendiriliyor...');
      auth = new google.auth.GoogleAuth({
        keyFile: jsonPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
    } else {
      console.log('[GoogleSheetsService] 🔑 Ortam değişkenleri (.env) ile yetkilendiriliyor...');
      const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
      const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

      auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
    }

    this.sheetsClient = google.sheets({ version: 'v4', auth });
    return this.sheetsClient;
  }

  /**
   * Google Sheets Tablosundan Stok Verilerini Okur (Önbellekli - Hızlı).
   */
  public static async fetchStockSheet(forceRefresh = false): Promise<any[]> {
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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Stok tablosu okunamadı:', error?.message || error);
      return this.stockCache?.data || [];
    }
  }

  /**
   * Google Sheets Tablosundan Tüm Sipariş Verilerini Okur (Önbellekli - Hızlı).
   */
  public static async fetchOrdersSheet(forceRefresh = false): Promise<any[]> {
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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Siparişler tablosu okunamadı:', error?.message || error);
      return this.ordersCache?.data || [];
    }
  }

  /**
   * Sipariş Verisini Google Sheets 'SİPARİŞLER' Tablosuna Ekle (Append).
   */
  public static async appendOrderRow(rowValues: any[]): Promise<boolean> {
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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Sipariş Google Sheets tablosuna yazılamadı:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosuna Yeni Ürün Ekler (Append).
   */
  public static async appendProductRow(rowValues: any[]): Promise<boolean> {
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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Ürün Google Sheets tablosuna yazılamadı:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosuna Çoklu Ürün Ekler (Toplu - Ultra Hızlı Single Request).
   */
  public static async appendProductRowsBatch(rowsArray: any[][]): Promise<boolean> {
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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Toplu ürün Google Sheets tablosuna yazılamadı:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosundaki Belirli Siparişin Durumunu Günceller (DURUM = OK veya DEC).
   */
  public static async updateOrderStatus(orderId: string, status: string): Promise<boolean> {
    try {
      const rows = await this.fetchOrdersSheet(true);
      if (!rows || rows.length === 0) return false;

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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Sipariş durumu güncellenemedi:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosundan Belirli Bir Ürün Satırını Siler.
   */
  public static async deleteProductRow(productCode: string): Promise<boolean> {
    try {
      const rows = await this.fetchStockSheet(true);
      if (!rows || rows.length === 0) return false;

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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Ürün silinemedi:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosundan Belirli Bir Sipariş Satırını Siler.
   */
  public static async deleteOrderRow(orderId: string): Promise<boolean> {
    try {
      const rows = await this.fetchOrdersSheet(true);
      if (!rows || rows.length === 0) return false;

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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Sipariş silinemedi:', error?.message || error);
      return false;
    }
  }

  /**
   * Google Sheets Tablosunda Ürün Stok Miktarını Günceller (Sütun F).
   */
  public static async updateProductStock(productCode: string, newStock: number): Promise<boolean> {
    try {
      const rows = await this.fetchStockSheet(true);
      if (!rows || rows.length === 0) return false;

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
    } catch (error: any) {
      console.error('[GoogleSheetsService] ❌ Ürün stoğu güncellenemedi:', error?.message || error);
      return false;
    }
  }
}

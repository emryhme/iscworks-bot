import axios from 'axios';
import { env } from '../config/env';
import { db } from '../database/db';
import { StockService } from './stock.service';
import { GoogleSheetsService } from './google-sheets.service';
import { TelegramService } from './telegram.service';
import { FacebookService } from './facebook.service';

export interface OrderData {
  customerName: string;
  customerPhone: string;
  address: string;
  productCode: string;
  productName: string;
  size: string;
  quantity: number;
  unitPrice?: number;
  shippingFee?: number;
  discount?: number;
  totalPrice?: number;
  senderId?: string;
}

export interface SavedOrder extends OrderData {
  orderId: string;
  createdAt: string;
  status?: string; // 'BEKLEMEDE' | 'OK' | 'DEC'
  senderId?: string;
  unitPrice?: number;
  shippingFee?: number;
  discount?: number;
  totalPrice?: number;
}

/**
 * SQLite (barons.db) Destekli Ultra Hızlı Sipariş Servisi
 */
export class OrderService {
  /**
   * Deterministik Temiz Sipariş Numarası Üreticisi
   * Tekli Ürün Örn: BRN-KGMLW-712-4902
   * Çoklu/Toplu Sipariş Örn: BRN-ORD-712-4902
   */
  public static generateOrderId(productCode: string, size: string, phone: string): string {
    const cleanPhone = (phone || '').trim().replace(/\D/g, '');
    const lastThreePhone = cleanPhone.length >= 3 ? cleanPhone.slice(-3) : '000';
    
    const now = new Date();
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    const timeStamp = `${minute}${second}`;

    const rawCode = (productCode || '').trim();

    // Çoklu ürün kontrolü (virgül, boşluk veya çok uzun karakter var mı)
    let baseCode = 'ORD';
    if (rawCode && !rawCode.includes(',') && !rawCode.includes(' ') && rawCode.length <= 15) {
      baseCode = rawCode.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
    }

    return `BRN-${baseCode}-${lastThreePhone}-${timeStamp}`;
  }

  /**
   * Sipariş oluşturur, deterministik sipariş no basar, stoğu -1 eksiltir ve SQLite + Sheet'e yazar.
   */
  public static async createOrder(data: OrderData): Promise<SavedOrder> {
    const orderId = this.generateOrderId(data.productCode, data.size, data.customerPhone);
    const createdAt = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    const status = 'BEKLEMEDE';
    const senderId = data.senderId || '';

    // İsim ve Soyisim ayırma
    const nameParts = data.customerName.trim().split(' ');
    const firstName = nameParts[0] || data.customerName;
    const lastName = nameParts.slice(1).join(' ') || '';

    const unitPrice = data.unitPrice || 0;
    const shippingFee = data.shippingFee || 0;
    const discount = data.discount || 0;
    const totalPrice = data.totalPrice || 0;

    try {
      const stmt = db.prepare(`
        INSERT INTO orders (order_id, first_name, last_name, customer_phone, address, product_code, product_name, size, quantity, unit_price, shipping_fee, discount, total_price, status, sender_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        orderId,
        firstName,
        lastName,
        data.customerPhone,
        data.address,
        data.productCode,
        data.productName || data.productCode,
        data.size,
        data.quantity,
        unitPrice,
        shippingFee,
        discount,
        totalPrice,
        status,
        senderId,
        createdAt
      );

      console.log(`[OrderService SQLite] 🛍️ Sipariş Veritabanına Kaydedildi: ${orderId} (senderId: ${senderId})`);

      // Google Sheets 'SİPARİŞLER' Tablosuna Yaz
      const rowValues = [firstName, lastName, data.customerPhone, data.address, data.quantity, data.productCode, createdAt, orderId, status, senderId];
      GoogleSheetsService.appendOrderRow(rowValues).catch(() => {});

      // SİPARİŞ VERİLDİĞİNDE ÜRÜN STOĞUNU -1 DÜŞ (-quantity)
      await StockService.deductStock(data.productCode, Number(data.quantity) || 1, data.size);

    } catch (e: any) {
      console.error('[OrderService SQLite] ❌ Sipariş kaydı başarısız:', e.message);
    }

    return {
      orderId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      address: data.address,
      productCode: data.productCode,
      productName: data.productName,
      size: data.size,
      quantity: data.quantity,
      unitPrice,
      shippingFee,
      discount,
      totalPrice,
      createdAt,
      status,
      senderId
    };
  }

  /**
   * Tüm siparişleri SQLite veritabanından getirir (Self-Healing Korumalı).
   */
  public static async getOrders(): Promise<SavedOrder[]> {
    try {
      // 1. Tablo veya Kolon Eksikse Anında Tamir Et (Self-Healing Schema)
      try {
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
            unit_price REAL NOT NULL DEFAULT 0,
            shipping_fee REAL NOT NULL DEFAULT 0,
            discount REAL NOT NULL DEFAULT 0,
            total_price REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'BEKLEMEDE',
            sender_id TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);
        try { db.exec(`ALTER TABLE orders ADD COLUMN unit_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
        try { db.exec(`ALTER TABLE orders ADD COLUMN shipping_fee REAL NOT NULL DEFAULT 0;`); } catch (e) {}
        try { db.exec(`ALTER TABLE orders ADD COLUMN discount REAL NOT NULL DEFAULT 0;`); } catch (e) {}
        try { db.exec(`ALTER TABLE orders ADD COLUMN total_price REAL NOT NULL DEFAULT 0;`); } catch (e) {}
        try { db.exec(`ALTER TABLE orders ADD COLUMN sender_id TEXT DEFAULT '';`); } catch (e) {}
      } catch (err) {}

      const stmt = db.prepare(`
        SELECT 
          order_id as orderId, 
          first_name, 
          last_name, 
          customer_phone as customerPhone, 
          address, 
          product_code as productCode, 
          product_name as productName, 
          size, 
          quantity, 
          unit_price as unitPrice,
          shipping_fee as shippingFee,
          discount,
          total_price as totalPrice,
          status, 
          sender_id as senderId, 
          created_at as createdAt
        FROM orders
        ORDER BY id DESC
      `);
      const rows = stmt.all() as any[];

      return rows.map(r => ({
        orderId: r.orderId,
        customerName: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Müşteri',
        customerPhone: r.customerPhone,
        address: r.address,
        productCode: r.productCode,
        productName: r.productName || r.productCode,
        size: r.size,
        quantity: r.quantity,
        unitPrice: Number(r.unitPrice) || 0,
        shippingFee: Number(r.shippingFee) || 0,
        discount: Number(r.discount) || 0,
        totalPrice: Number(r.totalPrice) || 0,
        createdAt: r.createdAt,
        status: r.status,
        senderId: r.senderId || ''
      }));
    } catch (e: any) {
      console.error('[OrderService SQLite] ❌ Siparişler çekilemedi:', e.message);
      return [];
    }
  }

  /**
   * Sipariş Onay / Red İşlemi (Sipariş Reddedilirse (DEC) Stoğu +1 İade Eder, Red sebebini Instagram DM gönderir!)
   */
  public static async updateOrderStatus(orderId: string, status: 'OK' | 'DEC', reason?: string): Promise<boolean> {
    try {
      const existingOrder = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId) as any;
      if (!existingOrder) {
        console.warn(`[OrderService SQLite] ⚠️ Güncellenecek sipariş bulunamadı: ${orderId}`);
        return false;
      }

      const prevStatus = (existingOrder.status || 'BEKLEMEDE').toUpperCase();
      const targetProductCode = existingOrder.product_code;
      const qty = Number(existingOrder.quantity) || 1;

      const stmt = db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`);
      const result = stmt.run(status, orderId);

      if (result.changes > 0) {
        console.log(`[OrderService SQLite] ✅ Sipariş (${orderId}) Durumu Güncellendi: ${prevStatus} -> ${status}`);

        // 1. SİPARİŞ REDDEDİLDİYSE (DEC): Stoğu +1 İade Et & Müşteriye Red Sebebini DM Gönder!
        if (status === 'DEC' && prevStatus !== 'DEC') {
          console.log(`[OrderService] 🔄 Sipariş reddedildi, ${targetProductCode} (${existingOrder.size}) stoğuna +${qty} iade ediliyor...`);
          await StockService.restoreStock(targetProductCode, qty, existingOrder.size);

          const senderId = (existingOrder.sender_id || existingOrder.senderId || '').trim();
          console.log(`[OrderService] 📤 Sipariş Red DM işlemi başlatıldı. OrderID: ${orderId}, SenderID: ${senderId}`);

          if (senderId) {
            const customerName = `${existingOrder.first_name || ''} ${existingOrder.last_name || ''}`.trim() || 'Müşterimiz';
            const defaultReason = 'Siparişiniz operasyonel nedenlerle onaylanamamıştır.';
            const cleanReason = reason && reason.trim() ? reason.trim() : defaultReason;

            const dmMessage = `Sayın ${customerName},\n\nSiparişiniz (#${orderId}) maalesef onaylanamamıştır.\n\nİptal / Red Nedeni:\n${cleanReason}\n\nAnlayışınız için teşekkür eder, keyifli günler dileriz. 🌸`;

            const sent = await FacebookService.sendMessage(senderId, dmMessage);
            console.log(`[OrderService] 📤 Red DM gönderim sonucu: ${sent}`);
          } else {
            console.warn(`[OrderService] ⚠️ Siparişte (ID: ${orderId}) sender_id bilgisi bulunamadığı için DM yollanamadı.`);
          }
        }
        // 2. Sipariş ONAYLANDIYSA (OK): Müşteriye "Siparişiniz Onaylandı" Mesajı Gönder!
        else if (status === 'OK') {
          if (prevStatus === 'DEC') {
            console.log(`[OrderService] 📦 Reddedilen sipariş onaylandı, ${targetProductCode} (${existingOrder.size}) stoğundan -${qty} tekrar düşülüyor...`);
            await StockService.deductStock(targetProductCode, qty, existingOrder.size);
          }

          // Müşteriye "Siparişiniz Onaylandı" Bildirim Mesajı Gönder (Telegram & n8n)
          const fullOrder: SavedOrder = {
            orderId: existingOrder.order_id,
            customerName: `${existingOrder.first_name || ''} ${existingOrder.last_name || ''}`.trim() || 'Müşteri',
            customerPhone: existingOrder.customer_phone || '',
            address: existingOrder.address || '',
            productCode: existingOrder.product_code || '',
            productName: existingOrder.product_name || existingOrder.product_code,
            size: existingOrder.size || 'M',
            quantity: qty,
            senderId: existingOrder.sender_id || '',
            createdAt: existingOrder.created_at || ''
          };
          await TelegramService.sendCustomerApprovalNotification(fullOrder);

          // n8n Webhook Trigger Tanımlıysa n8n Akışına POST Et (Hem Test Hem Canlı Adrese)
          if (env.n8nWebhookUrl) {
            const webhookPayload = {
              event: 'ORDER_APPROVED',
              senderId: fullOrder.senderId || '',
              orderId: fullOrder.orderId,
              customerName: fullOrder.customerName,
              customerPhone: fullOrder.customerPhone,
              address: fullOrder.address,
              productCode: fullOrder.productCode,
              productName: fullOrder.productName,
              size: fullOrder.size,
              quantity: fullOrder.quantity,
              message: `🎉 Sayın ${fullOrder.customerName}, ${fullOrder.orderId} numaralı siparişiniz onaylanmıştır!`
            };

            // 1. Ana Webhook Adresine Gönder
            axios.post(env.n8nWebhookUrl, webhookPayload).then(() => {
              console.log(`[n8n Webhook Main] 🚀 Sipariş Onay Webhook'u n8n'e yollandı (${fullOrder.orderId}, senderId: ${fullOrder.senderId})`);
            }).catch((err: any) => console.warn('[n8n Webhook Main Error]:', err.message));

            // 2. n8n Test veya Canlı Modundan Hangisindeyse Her İkisine de Gönder (Hiç Kaçırmasın)
            const altWebhookUrl = env.n8nWebhookUrl.includes('/webhook-test/')
              ? env.n8nWebhookUrl.replace('/webhook-test/', '/webhook/')
              : env.n8nWebhookUrl.replace('/webhook/', '/webhook-test/');

            axios.post(altWebhookUrl, webhookPayload).then(() => {
              console.log(`[n8n Webhook Alt] 🚀 Sipariş Onay Webhook'u n8n Alt Adrese yollandı (${fullOrder.orderId})`);
            }).catch(() => {});
          }
        }

        // Google Sheets Senkronizasyonu
        GoogleSheetsService.updateOrderStatus(orderId, status).catch(() => {});
        return true;
      }
      return false;
    } catch (e: any) {
      console.error('[OrderService SQLite] ❌ Sipariş durumu güncellenemedi:', e.message);
      return false;
    }
  }

  /**
   * Sipariş Silme (Eğer sipariş reddedilmemişse, silindiğinde stoğu iade eder)
   */
  public static async deleteOrder(orderId: string): Promise<boolean> {
    try {
      const existingOrder = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId) as any;

      const stmt = db.prepare(`DELETE FROM orders WHERE order_id = ?`);
      const result = stmt.run(orderId);

      if (result.changes > 0) {
        console.log(`[OrderService SQLite] 🗑️ Sipariş (${orderId}) silindi!`);

        // Aktif sipariş silindiyse stoğunu +1 iade et
        if (existingOrder && existingOrder.status !== 'DEC') {
          await StockService.restoreStock(existingOrder.product_code, Number(existingOrder.quantity) || 1, existingOrder.size);
        }

        // Google Sheets Senkronizasyonu
        GoogleSheetsService.deleteOrderRow(orderId).catch(() => {});
        return true;
      }
      return false;
    } catch (e: any) {
      console.error('[OrderService SQLite] ❌ Sipariş silinemedi:', e.message);
      return false;
    }
  }
}

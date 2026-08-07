import axios from 'axios';
import { env } from '../config/env';
import { SavedOrder } from './order.service';

/**
 * Telegram Bildirim Servisi (İşletme Sahibi & Müşteri Bildirimleri)
 */
export class TelegramService {
  /**
   * Yeni sipariş düştüğünde işletme sahibine HTML bildirim mesajı atar.
   */
  public static async notifyOrder(order: SavedOrder): Promise<boolean> {
    if (!env.telegramBotToken || !env.telegramChatId) {
      console.warn('[TelegramService] ⚠️ Bot Token veya Chat ID tanımlı değil, bildirim atlanıyor.');
      return false;
    }

    const messageHtml = `
🛍️ <b>YENİ SİPARİŞ BİLDİRİMİ</b>

• <b>Müşteri:</b> ${this.escapeHtml(order.customerName)}
• <b>Ürün İsmi:</b> ${this.escapeHtml(order.productName)}
• <b>Ürün Kodu:</b> <code>${this.escapeHtml(order.productCode)}</code>
• <b>Beden:</b> ${this.escapeHtml(order.size)}
• <b>Adet:</b> ${order.quantity}
• <b>Adres:</b> ${this.escapeHtml(order.address)}
• <b>Telefon:</b> ${this.escapeHtml(order.customerPhone)}
• <b>Tarih:</b> ${order.createdAt}
• <b>SİPARİŞ NUMARASI:</b> <code>${order.orderId}</code>

<i>Onaylamak için sipariş numarası ile ONAY veya RED yazınız.</i>
    `.trim();

    try {
      const url = `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`;
      await axios.post(url, {
        chat_id: env.telegramChatId,
        text: messageHtml,
        parse_mode: 'HTML'
      });
      console.log(`[TelegramService] 📲 Sipariş bildirimi Telegram'a gönderildi: ${order.orderId}`);
      return true;
    } catch (error: any) {
      console.error('[TelegramService] ❌ Telegram bildirimi gönderilemedi:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * Sipariş Onaylandığında Müşteriye / Grubuna 'Siparişiniz Onaylandı' Mesajı Gönderir.
   */
  public static async sendCustomerApprovalNotification(order: SavedOrder): Promise<boolean> {
    const messageHtml = `
🎉 <b>SİPARİŞİNİZ ONAYLANDI!</b>

Sayın <b>${this.escapeHtml(order.customerName)}</b>,
<code>${order.orderId}</code> numaralı siparişiniz başarıyla onaylanmıştır!

📦 <b>Ürün:</b> ${this.escapeHtml(order.productName || order.productCode)} (${order.size} Beden)
🔢 <b>Adet:</b> ${order.quantity}
📍 <b>Teslimat Adresi:</b> ${this.escapeHtml(order.address)}

Siparişiniz kargo birimine sevk edilmiş olup en kısa sürede adresinize teslim edilecektir. BARON'S SILLAGE'i tercih ettiğiniz için teşekkür ederiz! ✨
    `.trim();

    console.log(`[Customer Notification] 📩 Müşteriye Sipariş Onay Mesajı Yollandı (${order.customerName} - ${order.customerPhone}):`);
    console.log(messageHtml);

    if (env.telegramBotToken && env.telegramChatId) {
      try {
        const url = `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`;
        await axios.post(url, {
          chat_id: env.telegramChatId,
          text: messageHtml,
          parse_mode: 'HTML'
        });
        return true;
      } catch (e: any) {
        console.warn('[TelegramService] Müşteri onay mesajı gönderilemedi:', e.message);
      }
    }
    return true;
  }

  private static escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

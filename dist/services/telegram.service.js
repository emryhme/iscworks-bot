"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
/**
 * Telegram Bildirim Servisi (İşletme Sahibi & Müşteri Bildirimleri)
 */
class TelegramService {
    /**
     * Yeni sipariş düştüğünde işletme sahibine HTML bildirim mesajı atar.
     */
    static async notifyOrder(order) {
        if (!env_1.env.telegramBotToken || !env_1.env.telegramChatId) {
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
            const url = `https://api.telegram.org/bot${env_1.env.telegramBotToken}/sendMessage`;
            await axios_1.default.post(url, {
                chat_id: env_1.env.telegramChatId,
                text: messageHtml,
                parse_mode: 'HTML'
            });
            console.log(`[TelegramService] 📲 Sipariş bildirimi Telegram'a gönderildi: ${order.orderId}`);
            return true;
        }
        catch (error) {
            console.error('[TelegramService] ❌ Telegram bildirimi gönderilemedi:', error?.response?.data || error.message);
            return false;
        }
    }
    /**
     * Sipariş Onaylandığında Müşteriye / Grubuna 'Siparişiniz Onaylandı' Mesajı Gönderir.
     */
    static async sendCustomerApprovalNotification(order) {
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
        if (env_1.env.telegramBotToken && env_1.env.telegramChatId) {
            try {
                const url = `https://api.telegram.org/bot${env_1.env.telegramBotToken}/sendMessage`;
                await axios_1.default.post(url, {
                    chat_id: env_1.env.telegramChatId,
                    text: messageHtml,
                    parse_mode: 'HTML'
                });
                return true;
            }
            catch (e) {
                console.warn('[TelegramService] Müşteri onay mesajı gönderilemedi:', e.message);
            }
        }
        return true;
    }
    static escapeHtml(text) {
        if (!text)
            return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
exports.TelegramService = TelegramService;

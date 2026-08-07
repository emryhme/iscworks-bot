"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FacebookService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
/**
 * Facebook Graph API (Instagram DM / Messenger) Yanıt Gönderme Servisi
 */
class FacebookService {
    /**
     * Müşteriye yanıt mesajı gönderir.
     */
    static async sendMessage(recipientId, text) {
        if (!env_1.env.fbPageAccessToken) {
            console.warn('[FacebookService] ⚠️ FB Page Access Token eksik, mesaj konsola yazdırılıyor:');
            console.log(`[FB Mock -> ${recipientId}]: ${text}`);
            return false;
        }
        // Metin temizliği (satır sonu & fazla boşluk)
        const sanitizedText = text
            .trim()
            .replace(/[ \t]+/g, ' ')
            .replace(/\n+/g, '\n');
        try {
            const url = `https://graph.facebook.com/v21.0/me/messages`;
            await axios_1.default.post(url, {
                recipient: { id: recipientId },
                message: { text: sanitizedText }
            }, {
                headers: {
                    Authorization: `Bearer ${env_1.env.fbPageAccessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`[FacebookService] 📤 Mesaj başarıyla gönderildi -> ${recipientId}`);
            return true;
        }
        catch (error) {
            console.error('[FacebookService] ❌ Mesaj gönderim hatası:', error?.response?.data || error.message);
            return false;
        }
    }
}
exports.FacebookService = FacebookService;

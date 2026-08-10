import axios from 'axios';
import { env } from '../config/env';
import { db } from '../database/db';

/**
 * Facebook Graph API (Instagram DM / Messenger) Yanıt Gönderme Servisi (Store Scoped)
 */
export class FacebookService {
  /**
   * Müşteriye yanıt mesajı gönderir (Per-Store Credential Support).
   */
  public static async sendMessage(recipientId: string, text: string, storeId?: number): Promise<boolean> {
    let accessToken = env.fbPageAccessToken;

    if (storeId) {
      try {
        const setting = db.prepare("SELECT value FROM settings WHERE store_id = ? AND key = 'facebook_page_access_token'").get(storeId) as any;
        if (setting && setting.value && setting.value.trim()) {
          accessToken = setting.value.trim();
        }
      } catch {}
    }

    if (!accessToken) {
      console.warn(`[FacebookService] ⚠️ FB Page Access Token eksik (Store: ${storeId || 'default'}), mesaj konsola yazdırılıyor:`);
      console.log(`[FB Mock -> ${recipientId}]: ${text}`);
      return false;
    }

    const sanitizedText = text ? text.trim() : '';

    try {
      const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`;
      const res = await axios.post(
        url,
        {
          recipient: { id: recipientId },
          message: { text: sanitizedText }
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`[FacebookService] 📤 Mesaj başarıyla gönderildi -> ${recipientId} (Store: ${storeId || 'default'}, Status: ${res.status})`);
      return true;
    } catch (error: any) {
      const errDetails = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(`[FacebookService] ❌ Mesaj gönderim hatası (${recipientId}):`, errDetails);
      return false;
    }
  }
}

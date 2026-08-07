import axios from 'axios';
import { env } from '../config/env';

/**
 * Facebook Graph API (Instagram DM / Messenger) Yanıt Gönderme Servisi
 */
export class FacebookService {
  /**
   * Müşteriye yanıt mesajı gönderir.
   */
  public static async sendMessage(recipientId: string, text: string): Promise<boolean> {
    if (!env.fbPageAccessToken) {
      console.warn('[FacebookService] ⚠️ FB Page Access Token eksik, mesaj konsola yazdırılıyor:');
      console.log(`[FB Mock -> ${recipientId}]: ${text}`);
      return false;
    }

    const sanitizedText = text ? text.trim() : '';

    try {
      const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(env.fbPageAccessToken)}`;
      const res = await axios.post(
        url,
        {
          recipient: { id: recipientId },
          message: { text: sanitizedText }
        },
        {
          headers: {
            Authorization: `Bearer ${env.fbPageAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`[FacebookService] 📤 Mesaj başarıyla gönderildi -> ${recipientId} (Status: ${res.status})`);
      return true;
    } catch (error: any) {
      const errDetails = error?.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(`[FacebookService] ❌ Mesaj gönderim hatası (${recipientId}):`, errDetails);
      return false;
    }
  }
}

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

    // Metin temizliği (satır sonu & fazla boşluk)
    const sanitizedText = text
      .trim()
      .replace(/[ \t]+/g, ' ')
      .replace(/\n+/g, '\n');

    try {
      const url = `https://graph.facebook.com/v21.0/me/messages`;
      await axios.post(
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
      console.log(`[FacebookService] 📤 Mesaj başarıyla gönderildi -> ${recipientId}`);
      return true;
    } catch (error: any) {
      console.error('[FacebookService] ❌ Mesaj gönderim hatası:', error?.response?.data || error.message);
      return false;
    }
  }
}

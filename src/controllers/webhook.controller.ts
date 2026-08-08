import { Request, Response } from 'express';
import { env } from '../config/env';
import { extractProductCode } from '../utils/regex.util';
import { AIService } from '../services/ai.service';
import { FacebookService } from '../services/facebook.service';

export class WebhookController {
  /**
   * Facebook / Instagram Webhook Doğrulama (GET /webhook/instagram)
   */
  public static verifyWebhook(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`[WebhookController] 🔍 Webhook Doğrulama İsteği Geldi: mode=${mode}, token=${token}`);

    if (mode === 'subscribe' && token === env.fbVerifyToken) {
      console.log('[WebhookController] ✅ Webhook Doğrulaması Başarılı!');
      res.status(200).send(challenge);
    } else {
      console.warn(`[WebhookController] ❌ Webhook Doğrulama Başarısız! Beklenen Token: "${env.fbVerifyToken}", Gelen Token: "${token}"`);
      res.sendStatus(403);
    }
  }

  /**
   * Mağazaya Özel Webhook Doğrulama (GET /api/webhook/:storeSlug)
   */
  public static verifyStoreWebhook(req: Request, res: Response): void {
    const { storeSlug } = req.params;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`[WebhookController] 🔍 Store Webhook Doğrulama İsteği (${storeSlug}): token=${token}`);

    if (mode === 'subscribe') {
      console.log(`[WebhookController] ✅ ${storeSlug} Webhook Doğrulaması Başarılı!`);
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }

  /**
   * Mağazaya Özel Gelen DM Mesajlarını İşleme (POST /api/webhook/:storeSlug)
   */
  public static async handleStoreWebhook(req: Request, res: Response): Promise<void> {
    const { storeSlug } = req.params;
    const body = req.body;

    console.log(`[WebhookController] 📩 MAĞAZAYA ÖZEL WEBHOOK PAKETİ GELDİ (${storeSlug}):`);
    res.status(200).send('EVENT_RECEIVED');

    if (!body || !body.entry) return;

    for (const entry of body.entry || []) {
      const messagingList = entry.messaging || [];
      for (const messagingEvent of messagingList) {
        const senderId = messagingEvent.sender?.id;
        const message = messagingEvent.message;

        if (!senderId || !message || message.is_echo) continue;

        let incomingText = message.text || '';
        if (incomingText.trim()) {
          console.log(`[Store Webhook: ${storeSlug}] 🚀 DM Mesajı İşleniyor (${senderId}): "${incomingText}"`);
          WebhookController.processAndReply(senderId, incomingText);
        }
      }
    }
  }

  /**
   * Gelen Instagram / Messenger Mesajlarını İşleme (POST /webhook/instagram)
   */
  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    const body = req.body;

    // Her gelen Webhook paketini konsola bas (Sıfır kayıp)
    console.log('[WebhookController] 📩 META WEBHOOK PAKETİ GELDİ:');
    console.log(JSON.stringify(body, null, 2));

    // Meta Webhook paketini anında 200 OK yanıtla (Time-out olmasın)
    res.status(200).send('EVENT_RECEIVED');

    if (!body || !body.entry) return;

    for (const entry of body.entry || []) {
      // 1. Format: entry.messaging (Instagram DM & Messenger Standart)
      const messagingList = entry.messaging || [];
      for (const messagingEvent of messagingList) {
        const senderId = messagingEvent.sender?.id;
        const message = messagingEvent.message;

        if (!senderId || !message || message.is_echo) continue;

        let incomingText = message.text || '';

        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          const title = attachment.payload?.title || '';
          const extractedCode = extractProductCode(title);
          if (extractedCode) {
            incomingText = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen ürünün stok durumunu, beden seçeneklerini kontrol ederek müşteriye yardımcı ol.`;
          }
        }

        if (incomingText.trim()) {
          console.log(`[WebhookController] 🚀 Mesaj İşleniyor (senderId: ${senderId}): "${incomingText}"`);
          WebhookController.processAndReply(senderId, incomingText);
        }
      }

      // 2. Format: entry.changes (Instagram Graph API Alternate Webhook)
      const changesList = entry.changes || [];
      for (const change of changesList) {
        const value = change.value || {};
        const senderId = value.sender?.id || value.from?.id;
        const message = value.message || value.text;

        if (!senderId) continue;

        const incomingText = typeof message === 'string' ? message : message?.text || '';
        if (incomingText.trim()) {
          console.log(`[WebhookController Changes] 🚀 Mesaj İşleniyor (senderId: ${senderId}): "${incomingText}"`);
          WebhookController.processAndReply(senderId, incomingText);
        }
      }
    }
  }

  /**
   * AI Yanıtı Üretip Meta Graph API Üzerinden Müşteriye Gönderir
   */
  private static async processAndReply(senderId: string, text: string) {
    try {
      const { reply } = await AIService.processMessage(senderId, text);
      await FacebookService.sendMessage(senderId, reply);
    } catch (error) {
      console.error(`[WebhookController] ❌ Mesaj işleme hatası (${senderId}):`, error);
    }
  }
}

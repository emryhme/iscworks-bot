import { Request, Response } from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import { extractProductCode } from '../utils/regex.util';
import { AIService } from '../services/ai.service';
import { FacebookService } from '../services/facebook.service';
import { db } from '../database/db';

export class WebhookController {
  /**
   * Helper: Resolves store by slug strictly from database (No Fallbacks!)
   */
  public static resolveStore(slug: string): { id: number; name: string; slug: string; status: string } | null {
    const cleanSlug = (slug || '').trim().toLowerCase();
    if (!cleanSlug) return null;
    try {
      const store = db.prepare('SELECT id, name, slug, status FROM stores WHERE LOWER(slug) = ?').get(cleanSlug) as any;
      return store || null;
    } catch {
      return null;
    }
  }

  /**
   * Helper: Verifies X-Hub-Signature-256 HMAC-SHA256 Header (Security Rule 7)
   */
  public static verifySignature(req: Request): boolean {
    const signatureHeader = (req.headers['x-hub-signature-256'] || req.headers['x-hub-signature']) as string;
    const appSecret = process.env.INSTAGRAM_APP_SECRET || (env as any).instagramAppSecret;

    if (!appSecret) {
      if (signatureHeader) {
        console.warn('[Webhook Signature] ⚠️ App secret is not configured in environment variables.');
      }
      return true;
    }

    if (!signatureHeader) {
      console.warn('[Webhook Signature] ❌ X-Hub-Signature-256 header missing.');
      return false;
    }

    try {
      const parts = signatureHeader.split('=');
      const expectedHash = parts.length === 2 ? parts[1] : parts[0];
      const rawBody = (req as any).rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
      
      const computedHash = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      const isValid = crypto.timingSafeEqual(Buffer.from(computedHash, 'utf8'), Buffer.from(expectedHash, 'utf8'));

      if (!isValid) {
        console.error('[Webhook Signature] ❌ HMAC Signature Mismatch!');
      }
      return isValid;
    } catch (e: any) {
      console.error('[Webhook Signature] ❌ Error computing HMAC signature:', e.message);
      return false;
    }
  }

  /**
   * Helper: Tenant-Aware Webhook Event Idempotency Check (Security Rule 6)
   */
  public static isDuplicateEvent(eventId: string, storeId: number): boolean {
    if (!eventId || !storeId) return false;
    try {
      const existing = db.prepare('SELECT event_id FROM webhook_events WHERE store_id = ? AND event_id = ?').get(storeId, eventId);
      if (existing) {
        console.log(`[Webhook Idempotency] ⚠️ Duplicate webhook event ignored (eventId: ${eventId}, storeId: ${storeId})`);
        return true;
      }
      db.prepare('INSERT INTO webhook_events (store_id, event_id, processed_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(storeId, eventId);
      return false;
    } catch (e: any) {
      console.warn('[Webhook Idempotency Error]:', e.message);
      return false;
    }
  }

  /**
   * Facebook / Instagram Webhook Verification (GET /webhook/instagram)
   */
  public static verifyWebhook(req: Request, res: Response): void {
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = req.query['hub.challenge'];

    console.log(`[WebhookController] 🔍 Webhook Doğrulama İsteği Geldi: mode=${mode}, token=${token}`);
    const expectedToken = process.env.FB_VERIFY_TOKEN || env.fbVerifyToken;

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('[WebhookController] ✅ Webhook Doğrulaması Başarılı!');
      res.status(200).send(challenge);
    } else {
      console.warn(`[WebhookController] ❌ Webhook Verification Failed! Token: "${token}"`);
      res.sendStatus(403);
    }
  }

  /**
   * Mağazaya Özel Webhook Doğrulama (GET /api/webhook/:storeSlug)
   */
  public static verifyStoreWebhook(req: Request, res: Response): void {
    const storeSlug = String(req.params.storeSlug || '');
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = req.query['hub.challenge'];

    console.log(`[WebhookController] 🔍 Store Webhook Doğrulama İsteği (${storeSlug}): token=${token}`);

    const store = WebhookController.resolveStore(storeSlug);
    if (!store) {
      console.warn(`[WebhookController] ❌ Mağaza bulunamadı: "${storeSlug}"`);
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    if (store.status !== 'active') {
      console.warn(`[WebhookController] ⛔ Mağaza pasif durumda: "${storeSlug}" (status: ${store.status})`);
      res.status(403).json({ success: false, error: 'Mağaza pasif durumda.' });
      return;
    }

    const expectedToken = process.env.FB_VERIFY_TOKEN || env.fbVerifyToken;
    if (mode === 'subscribe' && token === expectedToken) {
      console.log(`[WebhookController] ✅ ${storeSlug} Webhook Doğrulaması Başarılı!`);
      res.status(200).send(challenge);
    } else {
      console.warn(`[WebhookController] ❌ ${storeSlug} Token Uyuşmazlığı!`);
      res.sendStatus(403);
    }
  }

  /**
   * Mağazaya Özel Gelen DM Mesajlarını İşleme (POST /api/webhook/:storeSlug)
   */
  public static async handleStoreWebhook(req: Request, res: Response): Promise<void> {
    const storeSlug = String(req.params.storeSlug || '');
    const store = WebhookController.resolveStore(storeSlug);

    if (!store) {
      console.warn(`[WebhookController] ❌ Mağaza bulunamadı: "${storeSlug}"`);
      res.status(404).json({ success: false, error: 'Mağaza bulunamadı.' });
      return;
    }

    if (store.status !== 'active') {
      console.warn(`[WebhookController] ⛔ Mağaza pasif/askıda: "${storeSlug}" (status: ${store.status})`);
      res.status(403).json({ success: false, error: 'Mağaza pasif/askıda durumdadır.' });
      return;
    }

    if (!WebhookController.verifySignature(req)) {
      res.status(401).json({ success: false, error: 'Geçersiz Webhook İmzası (Signature verification failed).' });
      return;
    }

    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    if (!body || !body.entry || !Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      const messagingList = entry.messaging || [];
      for (const messagingEvent of messagingList) {
        const senderId = messagingEvent.sender?.id;
        const message = messagingEvent.message;

        if (!senderId || !message || message.is_echo) continue;

        const eventId = String(message.mid || `${entry.id}_${messagingEvent.timestamp || Date.now()}`);
        if (WebhookController.isDuplicateEvent(eventId, store.id)) {
          continue;
        }

        let incomingText = message.text || '';
        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          const title = attachment.payload?.title || '';
          const extractedCode = extractProductCode(title);
          if (extractedCode) {
            incomingText = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen stok durumunu kontrol et.`;
          }
        }

        if (incomingText.trim()) {
          console.log(`[Store Webhook: ${store.slug} (ID: ${store.id})] 🚀 DM Mesajı İşleniyor (${senderId}): "${incomingText}"`);
          WebhookController.processAndReply(senderId, incomingText, store.slug, store.id);
        }
      }

      const changesList = entry.changes || [];
      for (const change of changesList) {
        const value = change.value || {};
        const senderId = value.sender?.id || value.from?.id;
        const message = value.message || value.text;

        if (!senderId) continue;

        const eventId = String(value.item_id || value.comment_id || `${entry.id}_${Date.now()}`);
        if (WebhookController.isDuplicateEvent(eventId, store.id)) {
          continue;
        }

        const incomingText = typeof message === 'string' ? message : message?.text || '';
        if (incomingText.trim()) {
          console.log(`[Store Webhook Changes: ${store.slug} (ID: ${store.id})] 🚀 Mesaj İşleniyor (${senderId}): "${incomingText}"`);
          WebhookController.processAndReply(senderId, incomingText, store.slug, store.id);
        }
      }
    }
  }

  /**
   * Gelen Instagram / Messenger Mesajlarını İşleme (POST /webhook/instagram)
   */
  public static async handleWebhook(req: Request, res: Response): Promise<void> {
    const defaultStore = db.prepare("SELECT id, name, slug, status FROM stores WHERE slug = 'default' OR id = 1 LIMIT 1").get() as any;

    if (!defaultStore) {
      res.status(404).json({ success: false, error: 'Varsayılan mağaza veritabanında bulunamadı.' });
      return;
    }

    if (defaultStore.status !== 'active') {
      res.status(403).json({ success: false, error: 'Mağaza pasif/askıda durumdadır.' });
      return;
    }

    if (!WebhookController.verifySignature(req)) {
      res.status(401).json({ success: false, error: 'Geçersiz Webhook İmzası.' });
      return;
    }

    res.status(200).send('EVENT_RECEIVED');

    const body = req.body;
    if (!body || !body.entry || !Array.isArray(body.entry)) return;

    for (const entry of body.entry) {
      const messagingList = entry.messaging || [];
      for (const messagingEvent of messagingList) {
        const senderId = messagingEvent.sender?.id;
        const message = messagingEvent.message;

        if (!senderId || !message || message.is_echo) continue;

        const eventId = String(message.mid || `${entry.id}_${messagingEvent.timestamp || Date.now()}`);
        if (WebhookController.isDuplicateEvent(eventId, defaultStore.id)) {
          continue;
        }

        let incomingText = message.text || '';
        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          const title = attachment.payload?.title || '';
          const extractedCode = extractProductCode(title);
          if (extractedCode) {
            incomingText = `${extractedCode}\n\nMüşteri bu ürünü sipariş etmek istiyor. Lütfen stok durumunu kontrol et.`;
          }
        }

        if (incomingText.trim()) {
          WebhookController.processAndReply(senderId, incomingText, defaultStore.slug, defaultStore.id);
        }
      }

      const changesList = entry.changes || [];
      for (const change of changesList) {
        const value = change.value || {};
        const senderId = value.sender?.id || value.from?.id;
        const message = value.message || value.text;

        if (!senderId) continue;

        const eventId = String(value.item_id || value.comment_id || `${entry.id}_${Date.now()}`);
        if (WebhookController.isDuplicateEvent(eventId, defaultStore.id)) {
          continue;
        }

        const incomingText = typeof message === 'string' ? message : message?.text || '';
        if (incomingText.trim()) {
          WebhookController.processAndReply(senderId, incomingText, defaultStore.slug, defaultStore.id);
        }
      }
    }
  }

  /**
   * AI Yanıtı Üretip Meta Graph API Üzerinden Müşteriye Gönderir (Store Scoped)
   */
  private static async processAndReply(senderId: string, text: string, storeSlug: string, storeId: number) {
    try {
      const { reply } = await AIService.processMessage(senderId, text, storeSlug, storeId);
      await FacebookService.sendMessage(senderId, reply);
    } catch (error: any) {
      console.error(`[WebhookController] ❌ Mesaj işleme hatası (Store: ${storeSlug}/${storeId}, Sender: ${senderId}):`, error?.message || error);
    }
  }
}

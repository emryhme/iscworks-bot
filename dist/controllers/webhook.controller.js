"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const env_1 = require("../config/env");
const regex_util_1 = require("../utils/regex.util");
const ai_service_1 = require("../services/ai.service");
const facebook_service_1 = require("../services/facebook.service");
class WebhookController {
    /**
     * Facebook / Instagram Webhook Doğrulama (GET /webhook/instagram)
     */
    static verifyWebhook(req, res) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        console.log(`[WebhookController] 🔍 Webhook Doğrulama İsteği Geldi: mode=${mode}, token=${token}`);
        if (mode === 'subscribe' && token === env_1.env.fbVerifyToken) {
            console.log('[WebhookController] ✅ Webhook Doğrulaması Başarılı!');
            res.status(200).send(challenge);
        }
        else {
            console.warn(`[WebhookController] ❌ Webhook Doğrulama Başarısız! Beklenen Token: "${env_1.env.fbVerifyToken}", Gelen Token: "${token}"`);
            res.sendStatus(403);
        }
    }
    /**
     * Mağazaya Özel Webhook Doğrulama (GET /api/webhook/:storeSlug)
     */
    static verifyStoreWebhook(req, res) {
        const { storeSlug } = req.params;
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        console.log(`[WebhookController] 🔍 Store Webhook Doğrulama İsteği (${storeSlug}): token=${token}`);
        if (mode === 'subscribe') {
            console.log(`[WebhookController] ✅ ${storeSlug} Webhook Doğrulaması Başarılı!`);
            res.status(200).send(challenge);
        }
        else {
            res.sendStatus(403);
        }
    }
    /**
     * Mağazaya Özel Gelen DM Mesajlarını İşleme (POST /api/webhook/:storeSlug)
     */
    static async handleStoreWebhook(req, res) {
        const { storeSlug } = req.params;
        const body = req.body;
        console.log(`[WebhookController] 📩 MAĞAZAYA ÖZEL WEBHOOK PAKETİ GELDİ (${storeSlug}):`);
        res.status(200).send('EVENT_RECEIVED');
        if (!body || !body.entry)
            return;
        for (const entry of body.entry || []) {
            const messagingList = entry.messaging || [];
            for (const messagingEvent of messagingList) {
                const senderId = messagingEvent.sender?.id;
                const message = messagingEvent.message;
                if (!senderId || !message || message.is_echo)
                    continue;
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
    static async handleWebhook(req, res) {
        const body = req.body;
        // Her gelen Webhook paketini konsola bas (Sıfır kayıp)
        console.log('[WebhookController] 📩 META WEBHOOK PAKETİ GELDİ:');
        console.log(JSON.stringify(body, null, 2));
        // Meta Webhook paketini anında 200 OK yanıtla (Time-out olmasın)
        res.status(200).send('EVENT_RECEIVED');
        if (!body || !body.entry)
            return;
        for (const entry of body.entry || []) {
            // 1. Format: entry.messaging (Instagram DM & Messenger Standart)
            const messagingList = entry.messaging || [];
            for (const messagingEvent of messagingList) {
                const senderId = messagingEvent.sender?.id;
                const message = messagingEvent.message;
                if (!senderId || !message || message.is_echo)
                    continue;
                let incomingText = message.text || '';
                if (message.attachments && message.attachments.length > 0) {
                    const attachment = message.attachments[0];
                    const title = attachment.payload?.title || '';
                    const extractedCode = (0, regex_util_1.extractProductCode)(title);
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
                if (!senderId)
                    continue;
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
    static async processAndReply(senderId, text) {
        try {
            const { reply } = await ai_service_1.AIService.processMessage(senderId, text);
            await facebook_service_1.FacebookService.sendMessage(senderId, reply);
        }
        catch (error) {
            console.error(`[WebhookController] ❌ Mesaj işleme hatası (${senderId}):`, error);
        }
    }
}
exports.WebhookController = WebhookController;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIService = void 0;
const openai_1 = require("@langchain/openai");
const tools_1 = require("@langchain/core/tools");
const messages_1 = require("@langchain/core/messages");
const env_1 = require("../config/env");
const stock_service_1 = require("./stock.service");
const order_service_1 = require("./order.service");
const telegram_service_1 = require("./telegram.service");
const facebook_service_1 = require("./facebook.service");
const db_1 = require("../database/db");
/**
 * n8n Multi-Agent Hiyerarşisi ve Akıllı Hafıza Korumalı LangChain JS Servisi (Sepet ve Kişiye Özel İndirim Destekli)
 */
class AIService {
    static sessions = new Map();
    static getApiKey() {
        return (process.env.OPENAI_API_KEY || env_1.env.openaiApiKey || '').trim().replace(/^["']|["']$/g, '');
    }
    static getSessionContext(senderId) {
        if (!this.sessions.has(senderId)) {
            this.sessions.set(senderId, { history: [], cart: [] });
        }
        const ctx = this.sessions.get(senderId);
        if (!ctx.cart)
            ctx.cart = [];
        return ctx;
    }
    /**
     * Yapay Zeka Destekli Akıllı Veri Ayıklama Motoru (AI Extractor - F.R.I.D.A.Y.)
     */
    static async extractSessionDataWithAI(senderId, userText, apiKey) {
        const ctx = this.getSessionContext(senderId);
        try {
            const extractorModel = new openai_1.ChatOpenAI({
                openAIApiKey: apiKey,
                modelName: 'gpt-4o-mini',
                temperature: 0
            });
            const extractionPrompt = `
Sen BARON'S SILLAGE için Türkçe Yapay Zeka Veri Ayıklayıcısısın (AI Extractor).
Müşterinin gönderdiği mesajdan ad-soyad, telefon, adres, ürün kodu, beden ve adet verilerini ayıkla.

Müşteri Mesajı: "${userText}"

Yalnızca aşağıdaki JSON yapısını döndür (bilinmeyen alanlar için null ver):
{
  "customerName": "Müşterinin Adı ve Soyadı (Örn: Emre İşcenkal, bulunamazsa null)",
  "customerPhone": "Müşterinin 10 veya 11 haneli Telefon Numarası (Örn: 05428523712, bulunamazsa null)",
  "address": "Müşterinin Açık Teslimat Adresi (Örn: Süleyman Mahallesi 1010 Sokak No 7, bulunamazsa null)",
  "productCode": "Varsa Ürün Kodu (Örn: KGMLW, TSW, NDL41, bulunamazsa null)",
  "size": "Varsa Beden (Örn: S, M, L, XL, 41, bulunamazsa null)",
  "quantity": "Varsa Adet Sayısı (Örn: 1, 2, 3, bulunamazsa null)"
}
`;
            const response = await extractorModel.invoke([new messages_1.HumanMessage(extractionPrompt)]);
            const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                if (data.customerName && data.customerName !== 'null' && data.customerName.trim().length > 1) {
                    ctx.customerName = data.customerName.trim();
                }
                if (data.customerPhone && data.customerPhone !== 'null') {
                    ctx.customerPhone = data.customerPhone.trim();
                }
                if (data.address && data.address !== 'null' && data.address.trim().length > 3) {
                    ctx.address = data.address.trim();
                }
                if (data.productCode && data.productCode !== 'null') {
                    ctx.productCode = data.productCode.trim().toUpperCase();
                }
                if (data.size && data.size !== 'null') {
                    ctx.size = data.size.trim().toUpperCase();
                }
                if (data.quantity && data.quantity !== 'null' && !isNaN(Number(data.quantity))) {
                    ctx.quantity = Number(data.quantity);
                }
            }
        }
        catch (e) {
            console.warn('[AI Extractor] ⚠️ AI veri ayıklama hatası:', e.message);
        }
    }
    /**
     * Alt Düğüm Araçlarını Tanımlar
     */
    static createLeafTools(senderId) {
        const ctx = this.getSessionContext(senderId);
        // STOK Tool
        const stokTool = new tools_1.DynamicTool({
            name: 'STOK',
            description: 'Ürün kodu, BEDEN ve ADET bilgisi mevcutsa stok kontrolü yapar.',
            func: async (input) => {
                try {
                    const query = input || ctx.productCode || '';
                    const result = await stock_service_1.StockService.checkStock(query);
                    if (!result.exists)
                        return JSON.stringify({ exists: false, message: 'Ürün bulunamadı.' });
                    if (result.product?.productCode) {
                        ctx.productCode = result.product.productCode;
                    }
                    return JSON.stringify({
                        exists: true,
                        inStock: result.inStock,
                        productName: result.product?.name,
                        productCode: result.product?.productCode || ctx.productCode,
                        size: result.product?.size || ctx.size,
                        price: result.product?.price || 299,
                        availableSizes: result.product?.availableSizes,
                        message: result.inStock ? 'Stokta mevcuttur.' : 'Stokta kalmamıştır.'
                    });
                }
                catch (e) {
                    return JSON.stringify({ error: e.message });
                }
            }
        });
        // SEPETE_EKLE Tool
        const sepeteEkleTool = new tools_1.DynamicTool({
            name: 'SEPETE_EKLE',
            description: 'Müşterinin istediği ürünü, bedenini ve adetini sepete ekler.',
            func: async (input) => {
                try {
                    let data = {};
                    try {
                        data = typeof input === 'object' ? input : JSON.parse(input);
                    }
                    catch {
                        data = {};
                    }
                    const pCode = (data.productCode || ctx.productCode || 'KGMLW').toUpperCase();
                    const pSize = (data.size || ctx.size || 'M').toUpperCase();
                    const pQty = Number(data.quantity) || ctx.quantity || 1;
                    const prod = db_1.db.prepare('SELECT * FROM products WHERE product_code = ? OR short_code = ?').get(pCode, pCode);
                    const unitPrice = prod?.price || 299;
                    const productName = prod?.name || pCode;
                    const stockRes = await stock_service_1.StockService.checkStock(pCode);
                    if (!stockRes.inStock) {
                        return JSON.stringify({ success: false, message: `${productName} (${pSize}) stokta tükendiği için sepete eklenemedi.` });
                    }
                    const existingIdx = ctx.cart.findIndex(i => i.productCode === pCode && i.size === pSize);
                    if (existingIdx >= 0) {
                        ctx.cart[existingIdx].quantity += pQty;
                    }
                    else {
                        ctx.cart.push({
                            productCode: pCode,
                            productName: productName,
                            size: pSize,
                            quantity: pQty,
                            unitPrice: unitPrice
                        });
                    }
                    const cartSubtotal = ctx.cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
                    const shippingFeeEstimate = cartSubtotal >= 1500 ? 0 : 49;
                    const totalEstimate = cartSubtotal + shippingFeeEstimate;
                    return JSON.stringify({
                        success: true,
                        message: `${productName} (Beden: ${pSize}, Adet: ${pQty}) sepete eklendi!`,
                        cartItemCount: ctx.cart.length,
                        cartTotalItems: ctx.cart.reduce((sum, i) => sum + i.quantity, 0),
                        cartSubtotal: cartSubtotal,
                        shippingFeeEstimate: shippingFeeEstimate,
                        totalEstimate: totalEstimate,
                        priceMessage: `Ara Toplam: ${cartSubtotal.toFixed(2)} TL | Kargo: ${shippingFeeEstimate === 0 ? 'ÜCRETSİZ' : shippingFeeEstimate + ' TL'} | Tahmini Toplam: ${totalEstimate.toFixed(2)} TL`,
                        cart: ctx.cart
                    });
                }
                catch (e) {
                    return JSON.stringify({ error: e.message });
                }
            }
        });
        // SEPET_GORUNTULE Tool
        const sepetGoruntuleTool = new tools_1.DynamicTool({
            name: 'SEPET_GORUNTULE',
            description: 'Müşterinin sepetindeki tüm ürünleri ve ara toplamı listeler.',
            func: async () => {
                if (!ctx.cart || ctx.cart.length === 0) {
                    return JSON.stringify({ cartEmpty: true, message: 'Sepetiniz şu an boş.' });
                }
                const cartSubtotal = ctx.cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
                return JSON.stringify({
                    cartEmpty: false,
                    cart: ctx.cart,
                    cartSubtotal: cartSubtotal
                });
            }
        });
        // KAYIT Tool (Instagram ID'ye Özel Sadakat İndirimi & Ödül Tanımlama Destekli)
        const kayitTool = new tools_1.DynamicTool({
            name: 'KAYIT',
            description: 'Müşterinin 3 Bilgisi (İsim, Tel, Adres) Tamamlandıysa Toplu Siparişi Oluşturur.',
            func: async (input) => {
                try {
                    let data = {};
                    try {
                        data = typeof input === 'object' ? input : JSON.parse(input);
                    }
                    catch {
                        data = {};
                    }
                    const customerName = data.customerName || ctx.customerName;
                    const customerPhone = data.customerPhone || ctx.customerPhone;
                    const address = data.address || ctx.address;
                    if (!ctx.cart || ctx.cart.length === 0) {
                        const pCode = (data.productCode || ctx.productCode || 'KGMLW').toUpperCase();
                        const pSize = (data.size || ctx.size || 'M').toUpperCase();
                        const pQty = Number(data.quantity) || ctx.quantity || 1;
                        const prod = db_1.db.prepare('SELECT * FROM products WHERE product_code = ? OR short_code = ?').get(pCode, pCode);
                        ctx.cart.push({
                            productCode: pCode,
                            productName: prod?.name || pCode,
                            size: pSize,
                            quantity: pQty,
                            unitPrice: prod?.price || 299
                        });
                    }
                    const missingFields = [];
                    if (!customerName || customerName.trim().length <= 1)
                        missingFields.push('İsim Soyisim');
                    if (!customerPhone || customerPhone.trim().length < 10)
                        missingFields.push('Telefon Numarası');
                    if (!address || address.trim().length < 3)
                        missingFields.push('Teslimat Adresi');
                    if (missingFields.length > 0) {
                        return JSON.stringify({
                            success: false,
                            orderCreated: false,
                            missingFields: missingFields,
                            message: `Sipariş oluşturulamadı! Eksik bilgiler: ${missingFields.join(', ')}. Lütfen bu bilgileri müşteriden talep edin.`
                        });
                    }
                    const subtotal = ctx.cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
                    const totalQuantity = ctx.cart.reduce((sum, item) => sum + item.quantity, 0);
                    // Ayarlardan Kargo Ücreti
                    const shippingSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'shipping_fee'").get();
                    const thresholdSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'free_shipping_threshold'").get();
                    const loyaltyThresholdSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'loyalty_threshold'").get();
                    let shippingFee = Number(shippingSetting?.value || 49);
                    const freeThreshold = Number(thresholdSetting?.value || 1500);
                    const loyaltyThreshold = Number(loyaltyThresholdSetting?.value || 2000);
                    if (subtotal >= freeThreshold) {
                        shippingFee = 0; // Ücretsiz Kargo
                    }
                    let discount = 0;
                    let appliedLoyaltyReward = false;
                    // 1. Müşterinin Instagram ID'sine tanımlı kullanılmamış %20 VIP Ödülü var mı?
                    const userReward = db_1.db.prepare('SELECT * FROM user_rewards WHERE sender_id = ? AND is_used = 0 ORDER BY id DESC LIMIT 1').get(senderId);
                    if (userReward) {
                        // Müşteriye özel %20VIP İndirimi uygula!
                        discount = (subtotal * (userReward.discount_percent / 100));
                        appliedLoyaltyReward = true;
                        // Ödülü kullanıldı olarak işaretle
                        db_1.db.prepare('UPDATE user_rewards SET is_used = 1, used_at = CURRENT_TIMESTAMP WHERE id = ?').run(userReward.id);
                    }
                    else {
                        // Standart Aktif Kampanyaları Uygula (Örn BARONS10)
                        const activeCampaigns = db_1.db.prepare('SELECT * FROM campaigns WHERE active = 1').all();
                        for (const c of activeCampaigns) {
                            if (c.code === 'BARONS10') {
                                discount += (subtotal * 0.10);
                            }
                        }
                    }
                    const totalPrice = Math.max(0, subtotal + shippingFee - discount);
                    // 2. Satıcı İzni Varsa (auto_vip_reward_enabled === '1') ve Sipariş Tutarı Eşik Değeri Geçtiyse Otomatik Ödül Tanımla!
                    let earnedNewLoyaltyReward = false;
                    const autoVipSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'auto_vip_reward_enabled'").get();
                    const isAutoVipEnabled = autoVipSetting && (autoVipSetting.value === '1' || autoVipSetting.value === 'true');
                    if (isAutoVipEnabled && subtotal >= loyaltyThreshold) {
                        // Müşteriye yeni VIP Ödülü ver (Ödül Kodu: YINEBEKLERIZ)
                        const rewardCode = 'YINEBEKLERIZ';
                        db_1.db.prepare(`
              INSERT INTO user_rewards (sender_id, reward_code, discount_percent, min_qualifying_amount)
              VALUES (?, ?, 20.0, ?)
            `).run(senderId, rewardCode, loyaltyThreshold);
                        earnedNewLoyaltyReward = true;
                        // Instagram DM Otomatik Bildirimi Gönder
                        const autoDmText = `🎉 TEBRİKLER / VIP ÖDÜL KAZANDINIZ!\nSayın ${customerName.trim()}, instagram profilinize özel %20 VIP İNDİRİM tanımlanmıştır! (Ödül Kodu: ${rewardCode})\nBir sonraki siparişinizde bu indirim otomatik olarak uygulanacaktır. Keyifli alışverişler dileriz! 🎁✨`;
                        facebook_service_1.FacebookService.sendMessage(senderId, autoDmText).catch(e => console.error('[Auto Reward DM Error]:', e.message));
                    }
                    const combinedProductCode = ctx.cart.map(i => `${i.productCode} (${i.size}) x${i.quantity}`).join(', ');
                    const combinedProductName = ctx.cart.map(i => `${i.productName} (${i.size})`).join(', ');
                    const order = await order_service_1.OrderService.createOrder({
                        customerName: customerName,
                        customerPhone: customerPhone,
                        address: address,
                        productCode: combinedProductCode,
                        productName: combinedProductName,
                        size: ctx.cart.map(i => i.size).join(','),
                        quantity: totalQuantity,
                        senderId: senderId
                    });
                    db_1.db.prepare(`
            UPDATE orders 
            SET unit_price = ?, shipping_fee = ?, discount = ?, total_price = ?
            WHERE order_id = ?
          `).run(subtotal / Math.max(1, totalQuantity), shippingFee, discount, totalPrice, order.orderId);
                    for (const item of ctx.cart) {
                        await stock_service_1.StockService.deductStock(item.productCode, item.quantity);
                    }
                    const cartSummaryText = ctx.cart.map(i => `• ${i.productName} (${i.size}) - ${i.quantity} adet x ${i.unitPrice} TL`).join('\n');
                    ctx.cart = [];
                    return JSON.stringify({
                        success: true,
                        orderCreated: true,
                        orderId: order.orderId,
                        appliedLoyaltyReward,
                        earnedNewLoyaltyReward,
                        subtotal,
                        shippingFee,
                        discount,
                        totalPrice,
                        priceDetails: `Sipariş Özeti:\n${cartSummaryText}\n\nAra Toplam: ${subtotal.toFixed(2)} TL\nKargo: ${shippingFee === 0 ? 'ÜCRETSİZ' : shippingFee.toFixed(2) + ' TL'}\nİndirim: ${discount > 0 ? '-' + discount.toFixed(2) + ' TL' : '0 TL'}\nNET ÖDENECEK TOPLAM: ${totalPrice.toFixed(2)} TL`,
                        loyaltyNotice: earnedNewLoyaltyReward
                            ? `🎉 TEBRİKLER! ${loyaltyThreshold} TL ve üzeri sipariş verdiğiniz için Instagram hesabınıza (ID: ${senderId}) tanımlı BIR DAHA Kİ SİPARİŞİNİZDE GEÇERLİ %20 VIP İNDİRİM HAKKI KAZANDINIZ!`
                            : ''
                    });
                }
                catch (e) {
                    return JSON.stringify({ error: e.message });
                }
            }
        });
        // MESAJ Tool
        const mesajTool = new tools_1.DynamicTool({
            name: 'MESAJ',
            description: 'İşletme sahibine Telegram üzerinden HTML bildirim yollar.',
            func: async (input) => {
                try {
                    let data = typeof input === 'object' ? input : JSON.parse(input);
                    await telegram_service_1.TelegramService.notifyOrder({
                        customerName: data.customerName || ctx.customerName || 'Müşteri',
                        customerPhone: data.customerPhone || ctx.customerPhone || '',
                        address: data.address || ctx.address || '',
                        productCode: data.productCode || ctx.productCode || '',
                        productName: data.productName || data.productCode || ctx.productCode || '',
                        size: data.size || ctx.size || '',
                        quantity: data.quantity || 1,
                        orderId: data.orderId || 'SIP-123',
                        createdAt: new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
                    });
                    return 'Telegram bildirimi gönderildi.';
                }
                catch (e) {
                    return `Telegram hatası: ${e.message}`;
                }
            }
        });
        // GÜNCELLE Tool
        const guncelleTool = new tools_1.DynamicTool({
            name: 'GUNCELLE',
            description: 'Sipariş onaylandığında stok miktarını günceller.',
            func: async (input) => {
                try {
                    let data = typeof input === 'object' ? input : JSON.parse(input);
                    const pCode = data.productCode || ctx.productCode;
                    if (pCode) {
                        await stock_service_1.StockService.deductStock(pCode, Number(data.quantity) || 1);
                    }
                    return 'Stok başarıyla güncellendi.';
                }
                catch (e) {
                    return `Stok güncelleme hatası: ${e.message}`;
                }
            }
        });
        return { stokTool, sepeteEkleTool, sepetGoruntuleTool, kayitTool, mesajTool, guncelleTool };
    }
    static createBilgilendirmeSubAgent(model, mesajTool) {
        return new tools_1.DynamicTool({
            name: 'BILGILENDIRME',
            description: 'Sipariş tamamlandığında işletme sahibine bilgilendirme mesajı atar.',
            func: async (input) => {
                const systemPrompt = new messages_1.SystemMessage(`İşletme sahibini Telegram üzerinden bilgilendir.`);
                const boundModel = model.bindTools([mesajTool]);
                const messages = [systemPrompt, new messages_1.HumanMessage(input)];
                const response = await boundModel.invoke(messages);
                if (response.tool_calls && response.tool_calls.length > 0) {
                    for (const tc of response.tool_calls) {
                        await mesajTool.invoke(JSON.stringify(tc.args));
                    }
                }
                return 'Bilgilendirme tamamlandı.';
            }
        });
    }
    static createSiparisSubAgent(model, stokTool, sepeteEkleTool, sepetGoruntuleTool, kayitTool, bilgilendirmeAgentTool) {
        return new tools_1.DynamicTool({
            name: 'SIPARIS',
            description: 'Stok sorgulama, sepete ekleme ve toplu sipariş kaydı işlemlerini yürütür.',
            func: async (input) => {
                const systemPrompt = new messages_1.SystemMessage(`
<görev>
Stok sorgulama, sepete ekleme ve sipariş kayıt ajansın.
1. Müşteri ürün beğenip sepete eklemek istediğinde SEPETE_EKLE aracını çağır.
2. Müşteri "isteklerim bu kadar", "siparişi tamamla", "hepsini alayım" dediğinde KAYIT aracını çağır.
</görev>
`);
                const boundModel = model.bindTools([stokTool, sepeteEkleTool, sepetGoruntuleTool, kayitTool, bilgilendirmeAgentTool]);
                let messages = [systemPrompt, new messages_1.HumanMessage(input)];
                let response = await boundModel.invoke(messages);
                messages.push(response);
                let count = 0;
                while (response.tool_calls && response.tool_calls.length > 0 && count < 4) {
                    count++;
                    for (const tc of response.tool_calls) {
                        let toolRes = "";
                        if (tc.name === 'STOK')
                            toolRes = await stokTool.invoke(JSON.stringify(tc.args));
                        else if (tc.name === 'SEPETE_EKLE')
                            toolRes = await sepeteEkleTool.invoke(JSON.stringify(tc.args));
                        else if (tc.name === 'SEPET_GORUNTULE')
                            toolRes = await sepetGoruntuleTool.invoke(JSON.stringify(tc.args));
                        else if (tc.name === 'KAYIT')
                            toolRes = await kayitTool.invoke(JSON.stringify(tc.args));
                        else if (tc.name === 'BILGILENDIRME')
                            toolRes = await bilgilendirmeAgentTool.invoke(JSON.stringify(tc.args));
                        messages.push(new messages_1.ToolMessage({ content: toolRes, tool_call_id: tc.id }));
                    }
                    response = await boundModel.invoke(messages);
                    messages.push(response);
                }
                return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            }
        });
    }
    static createStokManSubAgent(model, guncelleTool) {
        return new tools_1.DynamicTool({
            name: 'STOK_MAN',
            description: 'Sipariş onaylandığında stok düşer.',
            func: async (input) => {
                const systemPrompt = new messages_1.SystemMessage(`Stok güncelleme Ajanı.`);
                const boundModel = model.bindTools([guncelleTool]);
                const response = await boundModel.invoke([systemPrompt, new messages_1.HumanMessage(input)]);
                if (response.tool_calls && response.tool_calls.length > 0) {
                    for (const tc of response.tool_calls) {
                        await guncelleTool.invoke(JSON.stringify(tc.args));
                    }
                }
                return 'Stok güncelleme işlemi tamamlandı.';
            }
        });
    }
    static async processMessage(senderId, userMessage) {
        const apiKey = this.getApiKey();
        if (!apiKey || apiKey === 'DUMMY_KEY') {
            return {
                reply: "Merhaba! BARON'S SILLAGE müşteri temsilcisiyim. Lütfen geçerli bir OPENAI_API_KEY tanımlayınız.",
                tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
            };
        }
        let promptTokens = 0;
        let completionTokens = 0;
        const trackUsage = (res, currentMessagesCount) => {
            if (res?.usage_metadata) {
                promptTokens += res.usage_metadata.input_tokens || 0;
                completionTokens += res.usage_metadata.output_tokens || 0;
            }
            else {
                promptTokens += Math.ceil(currentMessagesCount * 120);
                completionTokens += Math.ceil((typeof res?.content === 'string' ? res.content.length : 100) / 4);
            }
        };
        try {
            await this.extractSessionDataWithAI(senderId, userMessage, apiKey);
            const ctx = this.getSessionContext(senderId);
            // Veritabanından Aktif ve Süresi Dolmamış Kampanyaları Çek
            const activeCampaigns = db_1.db.prepare(`
        SELECT title, description, code, start_date, end_date 
        FROM campaigns 
        WHERE active = 1 AND (end_date IS NULL OR end_date = '' OR end_date >= DATE('now'))
      `).all();
            const shippingSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'shipping_fee'").get();
            const thresholdSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'free_shipping_threshold'").get();
            const loyaltyThresholdSetting = db_1.db.prepare("SELECT value FROM settings WHERE key = 'loyalty_threshold'").get();
            const userReward = db_1.db.prepare("SELECT * FROM user_rewards WHERE sender_id = ? AND is_used = 0 ORDER BY id DESC LIMIT 1").get(senderId);
            const shippingFee = shippingSetting?.value || '49';
            const freeThreshold = thresholdSetting?.value || '1500';
            const loyaltyThreshold = loyaltyThresholdSetting?.value || '2000';
            let rewardText = "";
            if (userReward) {
                rewardText = `🎁 **MÜŞTERİNİN İNSTAGRAM HESABINA TANIMLI ÖZEL ÖDÜL:** Müşterinin Instagram hesabına tanımlı %${userReward.discount_percent} VIP İNDİRİM HAKKI vardır! Bu siparişinde müşteri özel %${userReward.discount_percent} VIP indirimi kazanır. Müşteriye bu harika haberi ver!`;
            }
            else {
                rewardText = `💡 **GELECEK SİPARİŞ İNDİRİM HAKKI KAZANMA:** Müşterinin bu siparişi ${loyaltyThreshold} TL ve üzeri olursa, bir sonraki siparişinde geçerli %20 VIP İNDİRİM HAKKI kazanacaktır!`;
            }
            const campaignsText = activeCampaigns.length > 0
                ? activeCampaigns.map(c => `- ${c.title}: ${c.description} (Kod: ${c.code || 'Yok'})`).join('\n')
                : 'Şu an aktif genel kampanya bulunmamaktadır.';
            const cartText = ctx.cart.length > 0
                ? ctx.cart.map(i => `• ${i.productName} (${i.size}) x${i.quantity} - ${i.unitPrice * i.quantity} TL`).join('\n')
                : 'Sepetiniz şu an boş.';
            const model = new openai_1.ChatOpenAI({
                openAIApiKey: apiKey,
                modelName: env_1.env.openaiModel || 'gpt-4o',
                temperature: 0.2
            });
            const { stokTool, sepeteEkleTool, sepetGoruntuleTool, kayitTool, mesajTool, guncelleTool } = this.createLeafTools(senderId);
            const bilgilendirmeAgentTool = this.createBilgilendirmeSubAgent(model, mesajTool);
            const siparisAgentTool = this.createSiparisSubAgent(model, stokTool, sepeteEkleTool, sepetGoruntuleTool, kayitTool, bilgilendirmeAgentTool);
            const stokManAgentTool = this.createStokManSubAgent(model, guncelleTool);
            const rootTools = [siparisAgentTool, stokManAgentTool];
            const boundRootModel = model.bindTools(rootTools);
            const systemPrompt = new messages_1.SystemMessage(`
<görev>
Sen BARON'S SILLAGE 7/24 Mağaza Müşteri Danışmanısın (F.R.I.D.A.Y.). Müşterilerin ürün sorularını yanıtlar, ürünleri SEPETE EKLER ve müşteri "isteklerim bu kadar / siparişi tamamla" dediğinde TOPLU SİPARİŞİ oluşturursun.
</görev>

<KATI_GÜVENLİK_VE_SEPET_KURALLARI>
1. 🛒 **SEPET SİSTEMİ (ÇOKLU ÜRÜN DESTEĞİ):**
   - Müşteri bir ürün seçtiğinde ("bunu sepetime ekle", "KGMLW M beden 1 adet ekle", "başka ürüne de bakacağım") SEPETE_EKLE aracını çağır ve ürünü sepete ekle.
   - Müşteri "isteklerim bu kadar", "siparişi tamamla", "hepsini alayım", "bu kadar" dediğinde veya tek seferde tüm bilgileri verdiyse KAYIT aracını çağırarak toplu siparişi veritabanına kaydet.
   - Müşterinin Mevcut Sepet Durumu:
${cartText}

2. 🎁 **INSTAGRAM ID'YE ÖZEL VİP İNDİRİM HAKKI SİSTEMİ:**
${rewardText}

3. 🔒 **STOK SORGULAMA KURALI (BEDEN VE ADET ZORUNLUDUR):**
   - Müşteri HANGİ BEDEN (S, M, L, XL, 41 vb.) ve KAÇ ADET ilgilendiğini söylemeden STOK SORGULAMASI YAPMA!
   - Eğer müşteri sadece "Gömlek var mı?" veya "KGMLW var mı?" dediyse, nazikçe şöyle sor: "Hangi beden (S, M, L, XL vb.) ve kaç adet düşünüyorsunuz?"

4. 🔒 **TOPLU SİPARİŞ VE BİLGİ İSTEME KURALI (SEPET TOPLAMI MUTLAKA BELİRTİLECEK!):**
   Müşteriden teslimat bilgilerini (Ad Soyad, Telefon, Adres) isterken VEYA siparişi tamamlamadan önce:
   👉 **SEPETTEKİ ÜRÜNLERİ, KARGO DURUMUNU VE TOPLAM SİPARİŞ TUTARINI (TL) MUTLAKA AÇIKÇA BELİRT!**
   
   Örnek Yanıt Formatı:
   "🛒 **Sepet Özeti:**
   {Ürün Kodları ve Adetleri}
   💰 **Toplam Sipariş Tutarınız:** {Net Toplam Ödenecek Tutar} TL ({Kargo Durumu})

   Siparişinizi tamamlamadan önce, lütfen aşağıdaki bilgileri paylaşın:
   1. Adınız ve Soyadınız
   2. Telefon Numaranız
   3. Teslimat Adresiniz

   Bu bilgileri aldıktan sonra siparişinizi oluşturabilirim."

   Şu 3 bilgi EKSİKSİZ alınmadan KAYIT/SIPARIS aracını tetikleme:
   ① Müşteri Adı ve Soyadı (${ctx.customerName || '❌ Eksik'})
   ② Telefon Numarası (${ctx.customerPhone || '❌ Eksik'})
   ③ Teslimat Adresi (${ctx.address || '❌ Eksik'})

5. 🎉 **KAMPANYALAR VE DÜKKAN İNDİRİMLERİ:**
   Mağazamızın Aktif Kampanyaları:
${campaignsText}

6. 🚚 **KARGO ÜCRETİ VE FİYATLANDIRMA:**
   - Standart Kargo Ücreti: ${shippingFee} TL.
   - ${freeThreshold} TL ve üzeri siparişlerde KARGO ÜCRETSİZDİR!
   - Sepet siparişi sorulduğunda veya teslimat bilgileri istenirken sepet ara toplamını, kargo ücretini ve varsa kampanya/VIP indirimini hesaplayarak NET TOPLAM TUTARI açıkça söyle.
</KATI_GÜVENLİK_VE_SEPET_KURALLARI>
`);
            ctx.history.push(new messages_1.HumanMessage(userMessage));
            if (ctx.history.length > 16) {
                ctx.history.splice(0, ctx.history.length - 16);
            }
            let messages = [systemPrompt, ...ctx.history];
            let response = await boundRootModel.invoke(messages);
            trackUsage(response, messages.length);
            messages.push(response);
            let count = 0;
            while (response.tool_calls && response.tool_calls.length > 0 && count < 4) {
                count++;
                for (const tc of response.tool_calls) {
                    let toolResult = "";
                    if (tc.name === 'SIPARIS') {
                        toolResult = await siparisAgentTool.invoke(JSON.stringify(tc.args));
                    }
                    else if (tc.name === 'STOK_MAN') {
                        toolResult = await stokManAgentTool.invoke(JSON.stringify(tc.args));
                    }
                    messages.push(new messages_1.ToolMessage({ content: toolResult, tool_call_id: tc.id }));
                }
                response = await boundRootModel.invoke(messages);
                trackUsage(response, messages.length);
                messages.push(response);
            }
            const finalOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
            ctx.history.push(new messages_1.AIMessage(finalOutput));
            const totalTokens = promptTokens + completionTokens;
            const costUsd = (promptTokens * 0.0000025) + (completionTokens * 0.00001);
            return {
                reply: finalOutput,
                tokens: { promptTokens, completionTokens, totalTokens, costUsd }
            };
        }
        catch (error) {
            console.error('[AIService] ❌ İşlem Hatası:', error);
            return {
                reply: "Üzgünüm, şu an bağlantıda geçici bir yoğunluk var. Lütfen biraz sonra tekrar deneyiniz.",
                tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
            };
        }
    }
}
exports.AIService = AIService;

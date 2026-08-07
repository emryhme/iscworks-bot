"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminCopilotService = void 0;
const openai_1 = require("@langchain/openai");
const tools_1 = require("@langchain/core/tools");
const messages_1 = require("@langchain/core/messages");
const env_1 = require("../config/env");
const stock_service_1 = require("./stock.service");
const order_service_1 = require("./order.service");
const db_1 = require("../database/db");
/**
 * BARON'S SILLAGE - AI Admin & Copilot Management Service
 */
class AdminCopilotService {
    static getApiKey() {
        return env_1.env.openaiApiKey || env_1.env.geminiApiKey || 'DUMMY_KEY';
    }
    static async processAdminCommand(userPrompt) {
        const apiKey = this.getApiKey();
        if (!apiKey || apiKey === 'DUMMY_KEY') {
            return "⚠️ Patron, geçerli bir OPENAI_API_KEY veya GEMINI_API_KEY bulunamadı. Lütfen .env dosyanızı kontrol ediniz.";
        }
        // 1. Stok Güncelleme Aracı
        const stokGuncelleTool = new tools_1.DynamicTool({
            name: 'STOK_GUNCELLE',
            description: 'Bir ürünün stok adedini günceller. Parametreler: productCode (string), newStock (number), size (string, opsiyonel).',
            func: async (inputStr) => {
                try {
                    const { productCode, newStock, size } = JSON.parse(inputStr);
                    const success = await stock_service_1.StockService.updateStock(productCode, Number(newStock), size || '');
                    if (success) {
                        return `✅ ${productCode} ${size ? '(' + size + ')' : ''} stoğu ${newStock} adet olarak güncellendi!`;
                    }
                    else {
                        return `❌ ${productCode} stoğu veritabanında bulunamadı veya güncellenemedi.`;
                    }
                }
                catch (e) {
                    return `❌ Stok güncelleme hatası: ${e.message}`;
                }
            }
        });
        // 2. Fiyat Güncelleme Aracı
        const fiyatGuncelleTool = new tools_1.DynamicTool({
            name: 'FIYAT_GUNCELLE',
            description: 'Bir ürünün satış fiyatını TL olarak günceller. Parametreler: productCode (string), price (number).',
            func: async (inputStr) => {
                try {
                    const { productCode, price } = JSON.parse(inputStr);
                    const numPrice = Number(price);
                    db_1.db.prepare('UPDATE products SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE product_code = ?').run(numPrice, productCode);
                    return `✅ ${productCode} ürününün fiyatı ${numPrice} TL olarak kaydedildi!`;
                }
                catch (e) {
                    return `❌ Fiyat güncelleme hatası: ${e.message}`;
                }
            }
        });
        // 3. Sipariş Sorgulama Aracı
        const siparisSorgulaTool = new tools_1.DynamicTool({
            name: 'SIPARIS_SORGULA',
            description: 'Veritabanındaki siparişleri listeler veya sorgular. Parametreler: query (string, opsiyonel - isim, telefon veya orderId).',
            func: async (inputStr) => {
                try {
                    const parsed = inputStr ? JSON.parse(inputStr) : {};
                    const query = parsed.query || '';
                    const orders = await order_service_1.OrderService.getOrders();
                    let filtered = orders;
                    if (query) {
                        const q = query.toLowerCase().trim();
                        filtered = orders.filter(o => (o.orderId || '').toLowerCase().includes(q) ||
                            (o.customerName || '').toLowerCase().includes(q) ||
                            (o.customerPhone || '').includes(q) ||
                            (o.status || '').toLowerCase().includes(q));
                    }
                    if (filtered.length === 0)
                        return 'Sorgunuza uygun sipariş bulunamadı.';
                    const list = filtered.slice(0, 5).map(o => `• #${o.orderId} | Müşteri: ${o.customerName} (${o.customerPhone}) | Ürün: ${o.productCode} (${o.quantity} Adet) | Tutar: ${o.totalPrice || 0} TL | Durum: ${o.status}`).join('\n');
                    return `📦 Toplam ${filtered.length} sipariş bulundu. Son ${Math.min(5, filtered.length)} sipariş:\n${list}`;
                }
                catch (e) {
                    return `❌ Sipariş sorgulama hatası: ${e.message}`;
                }
            }
        });
        // 4. Yeni Ürün Ekleme Aracı
        const urunEkleTool = new tools_1.DynamicTool({
            name: 'URUN_EKLE',
            description: 'Yapay zeka analizli yeni ürün ekler. Parametreler: shortCode (string), productName (string), color (string), size (string), stock (number), price (number, opsiyonel), category (string, opsiyonel).',
            func: async (inputStr) => {
                try {
                    const { shortCode, productName, color, size, stock, price, category } = JSON.parse(inputStr);
                    const sc = (shortCode || 'KGMLW').toUpperCase().trim();
                    const sz = (size || 'M').toUpperCase().trim();
                    const computedProductCode = `${sc}-${sz}`;
                    const numPrice = Number(price) || 299;
                    const res = await stock_service_1.StockService.addProduct({
                        shortCode: sc,
                        productCode: computedProductCode,
                        name: productName || 'BARON SILLAGE Ürün',
                        color: color || '',
                        size: sz,
                        stock: Number(stock) || 0,
                        category: category || ''
                    });
                    if (res.success) {
                        db_1.db.prepare('UPDATE products SET price = ? WHERE product_code = ?').run(numPrice, computedProductCode);
                        return `✨ Yeni ürün başarıyla eklendi!\n• Kod: ${computedProductCode}\n• İsim: ${productName}\n• Beden: ${sz}\n• Stok: ${stock}\n• Fiyat: ${numPrice} TL`;
                    }
                    else {
                        return '❌ Ürün eklenemedi.';
                    }
                }
                catch (e) {
                    return `❌ Ürün ekleme hatası: ${e.message}`;
                }
            }
        });
        const model = new openai_1.ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: env_1.env.openaiModel || 'gpt-4o',
            temperature: 0.1
        });
        const tools = [stokGuncelleTool, fiyatGuncelleTool, siparisSorgulaTool, urunEkleTool];
        const boundModel = model.bindTools(tools);
        const systemPrompt = new messages_1.SystemMessage(`
Sen BARON'S SILLAGE Yönetici ve Mağaza Copilot Asistanısın (F.R.I.D.A.Y.).
Kullanıcın Sayın Tony Stark (Patron)'dır.

Görevlerin:
1. Patronun Türkçe doğal dille verdiği yönetim emirlerini anlayıp doğru araçları (STOK_GUNCELLE, FIYAT_GUNCELLE, SIPARIS_SORGULA, URUN_EKLE) çağırarak işlemi gerçekleştirmek.
2. İşlem tamamlandığında Patron'a saygılı, samimi, karizmatik ve net bir Türkçe özet sunmak (Örn: "Emredersiniz Patron! KGMLW-M stoğu 50 adet yapıldı ve fiyatı 450 TL olarak güncellendi.").
3. Eğer bilgi eksikse (örn hangi beden veya hangi ürün kodu olduğu söylenmediyse) sormak.
    `);
        let messages = [systemPrompt, new messages_1.HumanMessage(userPrompt)];
        let response = await boundModel.invoke(messages);
        let count = 0;
        while (response.tool_calls && response.tool_calls.length > 0 && count < 3) {
            count++;
            messages.push(response);
            for (const tc of response.tool_calls) {
                let toolResult = "";
                if (tc.name === 'STOK_GUNCELLE')
                    toolResult = await stokGuncelleTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'FIYAT_GUNCELLE')
                    toolResult = await fiyatGuncelleTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'SIPARIS_SORGULA')
                    toolResult = await siparisSorgulaTool.invoke(JSON.stringify(tc.args));
                else if (tc.name === 'URUN_EKLE')
                    toolResult = await urunEkleTool.invoke(JSON.stringify(tc.args));
                messages.push(new messages_1.ToolMessage({ content: toolResult, tool_call_id: tc.id }));
            }
            response = await boundModel.invoke(messages);
        }
        return (typeof response.content === 'string' ? response.content : 'İşleminiz tamamlandı Patron!').trim();
    }
}
exports.AdminCopilotService = AdminCopilotService;

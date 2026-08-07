import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { StockService } from './stock.service';
import { OrderService } from './order.service';
import { TelegramService } from './telegram.service';
import { extractProductCode } from '../utils/regex.util';
import { db } from '../database/db';

interface SessionContext {
  history: BaseMessage[];
  productCode?: string;
  size?: string;
  quantity?: number;
  customerName?: string;
  customerPhone?: string;
  address?: string;
}

/**
 * n8n Multi-Agent Hiyerarşisi ve Akıllı Hafıza Korumalı LangChain JS Servisi
 */
export class AIService {
  private static sessions: Map<string, SessionContext> = new Map();

  private static getApiKey(): string {
    return (process.env.OPENAI_API_KEY || env.openaiApiKey || '').trim().replace(/^["']|["']$/g, '');
  }

  private static getSessionContext(senderId: string): SessionContext {
    if (!this.sessions.has(senderId)) {
      this.sessions.set(senderId, { history: [] });
    }
    return this.sessions.get(senderId)!;
  }

  /**
   * Yapay Zeka Destekli Akıllı Veri Ayıklama Motoru (AI Extractor - F.R.I.D.A.Y.)
   */
  private static async extractSessionDataWithAI(senderId: string, userText: string, apiKey: string) {
    const ctx = this.getSessionContext(senderId);

    try {
      const extractorModel = new ChatOpenAI({
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

      const response = await extractorModel.invoke([new HumanMessage(extractionPrompt)]);
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
    } catch (e: any) {
      console.warn('[AI Extractor] ⚠️ AI veri ayıklama hatası:', e.message);
    }
  }

  /**
   * Alt Düğüm Araçlarını Tanımlar
   */
  private static createLeafTools(senderId: string) {
    const ctx = this.getSessionContext(senderId);

    // STOK Tool (Sadece Beden VE Adet biliniyorsa çalışır)
    const stokTool = new DynamicTool({
      name: 'STOK',
      description: 'Ürün kodu, BEDEN ve ADET bilgisi mevcutsa stok kontrolü yapar.',
      func: async (input: string) => {
        try {
          const query = input || ctx.productCode || '';
          const result = await StockService.checkStock(query);
          if (!result.exists) return JSON.stringify({ exists: false, message: 'Ürün bulunamadı.' });
          
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
        } catch (e: any) {
          return JSON.stringify({ error: e.message });
        }
      }
    });

    // KAYIT Tool (5 BİLGİ TAMAMLANMADAN SİPARİŞ OLUŞTURMAZ!)
    const kayitTool = new DynamicTool({
      name: 'KAYIT',
      description: 'SADECE 5 BİLGİ (İsim, Telefon, Adres, Beden, Adet) EKSİKSİZ TAMAMLANDIĞINDA SİPARİŞİ OLUŞTURUR.',
      func: async (input: string) => {
        try {
          let data: any = {};
          try {
            data = typeof input === 'object' ? input : JSON.parse(input);
          } catch {
            data = {};
          }

          const customerName = data.customerName || ctx.customerName;
          const customerPhone = data.customerPhone || ctx.customerPhone;
          const address = data.address || ctx.address;
          const size = data.size || ctx.size;
          const quantity = Number(data.quantity) || ctx.quantity || 1;
          const productCode = data.productCode || ctx.productCode || 'KGMLW';

          // 🔒 KATI KURAL: 5 BİLGİ EKSİKSİZ Mİ?
          const missingFields: string[] = [];
          if (!customerName || customerName.trim().length <= 1) missingFields.push('İsim Soyisim');
          if (!customerPhone || customerPhone.trim().length < 10) missingFields.push('Telefon Numarası');
          if (!address || address.trim().length < 3) missingFields.push('Teslimat Adresi');
          if (!size) missingFields.push('Beden (S, M, L, XL vb.)');
          if (!quantity) missingFields.push('Adet Sayısı');

          if (missingFields.length > 0) {
            return JSON.stringify({
              success: false,
              orderCreated: false,
              missingFields: missingFields,
              message: `Sipariş oluşturulamadı! Eksik bilgiler: ${missingFields.join(', ')}. Lütfen müşteriden bu bilgileri isteyin.`
            });
          }

          // Fiyat ve Kargo Hesaplaması
          const productQuery = db.prepare('SELECT * FROM products WHERE product_code = ? OR short_code = ?').get(productCode, productCode) as any;
          const unitPrice = productQuery?.price || 299;
          const subtotal = unitPrice * quantity;

          // Ayarlardan Kargo Ücreti
      const shippingSetting = db.prepare("SELECT value FROM settings WHERE key = 'shipping_fee'").get() as any;
      const thresholdSetting = db.prepare("SELECT value FROM settings WHERE key = 'free_shipping_threshold'").get() as any;
          
          let shippingFee = Number(shippingSetting?.value || 49);
          const freeThreshold = Number(thresholdSetting?.value || 1500);

          if (subtotal >= freeThreshold) {
            shippingFee = 0; // Ücretsiz Kargo
          }

          // Aktif Kampanyaları Uygula
          let discount = 0;
          const activeCampaigns = db.prepare('SELECT * FROM campaigns WHERE active = 1').all() as any[];
          for (const c of activeCampaigns) {
            if (c.code === 'BARONS10') {
              discount += (subtotal * 0.10); // %10 İndirim
            }
          }

          const totalPrice = Math.max(0, subtotal + shippingFee - discount);

          const order = await OrderService.createOrder({
            customerName: customerName,
            customerPhone: customerPhone,
            address: address,
            productCode: productCode,
            productName: productQuery?.name || productCode,
            size: size,
            quantity: quantity,
            senderId: senderId
          });

          // SQLite Order Fiyat Güncellemesi
          db.prepare(`
            UPDATE orders 
            SET unit_price = ?, shipping_fee = ?, discount = ?, total_price = ?
            WHERE order_id = ?
          `).run(unitPrice, shippingFee, discount, totalPrice, order.orderId);

          return JSON.stringify({
            success: true,
            orderCreated: true,
            orderId: order.orderId,
            productCode: order.productCode,
            productName: productQuery?.name || order.productCode,
            unitPrice,
            quantity,
            subtotal,
            shippingFee,
            discount,
            totalPrice,
            priceDetails: `Ürün Ara Toplam: ${subtotal.toFixed(2)} TL | Kargo: ${shippingFee === 0 ? 'ÜCRETSİZ' : shippingFee.toFixed(2) + ' TL'} | Kampanya İndirimi: ${discount > 0 ? '-' + discount.toFixed(2) + ' TL' : '0 TL'} | NET TOPLAM: ${totalPrice.toFixed(2)} TL`
          });
        } catch (e: any) {
          return JSON.stringify({ error: e.message });
        }
      }
    });

    // MESAJ Tool (Telegram Bildirimi)
    const mesajTool = new DynamicTool({
      name: 'MESAJ',
      description: 'İşletme sahibine Telegram üzerinden HTML bildirim yollar.',
      func: async (input: string) => {
        try {
          let data: any = typeof input === 'object' ? input : JSON.parse(input);
          await TelegramService.notifyOrder({
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
        } catch (e: any) {
          return `Telegram hatası: ${e.message}`;
        }
      }
    });

    // GÜNCELLE Tool
    const guncelleTool = new DynamicTool({
      name: 'GUNCELLE',
      description: 'Sipariş onaylandığında stok miktarını günceller.',
      func: async (input: string) => {
        try {
          let data: any = typeof input === 'object' ? input : JSON.parse(input);
          const pCode = data.productCode || ctx.productCode;
          if (pCode) {
            await StockService.deductStock(pCode, Number(data.quantity) || 1);
          }
          return 'Stok başarıyla güncellendi.';
        } catch (e: any) {
          return `Stok güncelleme hatası: ${e.message}`;
        }
      }
    });

    return { stokTool, kayitTool, mesajTool, guncelleTool };
  }

  private static createBilgilendirmeSubAgent(model: ChatOpenAI, mesajTool: DynamicTool) {
    return new DynamicTool({
      name: 'BILGILENDIRME',
      description: 'Sipariş tamamlandığında işletme sahibine bilgilendirme mesajı atar.',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`İşletme sahibini Telegram üzerinden bilgilendir.`);
        const boundModel = model.bindTools([mesajTool]);
        const messages = [systemPrompt, new HumanMessage(input)];
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

  private static createSiparisSubAgent(model: ChatOpenAI, stokTool: DynamicTool, kayitTool: DynamicTool, bilgilendirmeAgentTool: DynamicTool) {
    return new DynamicTool({
      name: 'SIPARIS',
      description: 'Stok sorgulama ve sipariş kaydı işlemlerini yürütür.',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`
<görev>
Stok sorgulama ve sipariş kayıt ajansın.
1. Stok sorgulaması (STOK) yapmak için MÜŞTERİNİN BEDEN VE ADET BELİRTTİĞİNDEN EMİN OL. Beden veya Adet yoksa STOK sorgusu yapma, müşteriden beden ve adet iste.
2. Sipariş oluşturmak (KAYIT) için İsim, Telefon, Adres, Beden ve Adet bilgilerinin 5'inin de EKSİKSİZ olduğundan emin ol.
</görev>
`);
        const boundModel = model.bindTools([stokTool, kayitTool, bilgilendirmeAgentTool]);
        let messages: BaseMessage[] = [systemPrompt, new HumanMessage(input)];
        let response = await boundModel.invoke(messages);
        messages.push(response);

        let count = 0;
        while (response.tool_calls && response.tool_calls.length > 0 && count < 4) {
          count++;
          for (const tc of response.tool_calls) {
            let toolRes = "";
            if (tc.name === 'STOK') toolRes = await stokTool.invoke(JSON.stringify(tc.args));
            else if (tc.name === 'KAYIT') toolRes = await kayitTool.invoke(JSON.stringify(tc.args));
            else if (tc.name === 'BILGILENDIRME') toolRes = await bilgilendirmeAgentTool.invoke(JSON.stringify(tc.args));

            messages.push(new ToolMessage({ content: toolRes, tool_call_id: tc.id! }));
          }
          response = await boundModel.invoke(messages);
          messages.push(response);
        }

        return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      }
    });
  }

  private static createStokManSubAgent(model: ChatOpenAI, guncelleTool: DynamicTool) {
    return new DynamicTool({
      name: 'STOK_MAN',
      description: 'Sipariş onaylandığında stok düşer.',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`Stok güncelleme Ajanı.`);
        const boundModel = model.bindTools([guncelleTool]);
        const response = await boundModel.invoke([systemPrompt, new HumanMessage(input)]);
        if (response.tool_calls && response.tool_calls.length > 0) {
          for (const tc of response.tool_calls) {
            await guncelleTool.invoke(JSON.stringify(tc.args));
          }
        }
        return 'Stok güncelleme işlemi tamamlandı.';
      }
    });
  }

  public static async processMessage(senderId: string, userMessage: string): Promise<{
    reply: string;
    tokens: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number };
  }> {
    const apiKey = this.getApiKey();

    if (!apiKey || apiKey === 'DUMMY_KEY') {
      return {
        reply: "Merhaba! BARON'S SILLAGE müşteri temsilcisiyim. Lütfen geçerli bir OPENAI_API_KEY tanımlayınız.",
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
      };
    }

    let promptTokens = 0;
    let completionTokens = 0;

    const trackUsage = (res: any, currentMessagesCount: number) => {
      if (res?.usage_metadata) {
        promptTokens += res.usage_metadata.input_tokens || 0;
        completionTokens += res.usage_metadata.output_tokens || 0;
      } else {
        promptTokens += Math.ceil(currentMessagesCount * 120);
        completionTokens += Math.ceil((typeof res?.content === 'string' ? res.content.length : 100) / 4);
      }
    };

    try {
      await this.extractSessionDataWithAI(senderId, userMessage, apiKey);
      const ctx = this.getSessionContext(senderId);

      // Veritabanından Aktif Kampanyaları ve Kargo Ücretlerini Çek
      const activeCampaigns = db.prepare('SELECT title, description, code FROM campaigns WHERE active = 1').all() as any[];
      const shippingSetting = db.prepare("SELECT value FROM settings WHERE key = 'shipping_fee'").get() as any;
      const thresholdSetting = db.prepare("SELECT value FROM settings WHERE key = 'free_shipping_threshold'").get() as any;
      
      const shippingFee = shippingSetting?.value || '49';
      const freeThreshold = thresholdSetting?.value || '1500';

      const campaignsText = activeCampaigns.length > 0
        ? activeCampaigns.map(c => `- ${c.title}: ${c.description} (Kod: ${c.code || 'Yok'})`).join('\n')
        : 'Şu an aktif özel kampanya bulunmamaktadır.';

      const model = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: env.openaiModel || 'gpt-4o',
        temperature: 0.2
      });

      const { stokTool, kayitTool, mesajTool, guncelleTool } = this.createLeafTools(senderId);
      const bilgilendirmeAgentTool = this.createBilgilendirmeSubAgent(model, mesajTool);
      const siparisAgentTool = this.createSiparisSubAgent(model, stokTool, kayitTool, bilgilendirmeAgentTool);
      const stokManAgentTool = this.createStokManSubAgent(model, guncelleTool);

      const rootTools = [siparisAgentTool, stokManAgentTool];
      const boundRootModel = model.bindTools(rootTools);

      const systemPrompt = new SystemMessage(`
<görev>
Sen BARON'S SILLAGE 7/24 Mağaza Müşteri Danışmanısın (F.R.I.D.A.Y.).
</görev>

<KATI_GÜVENLİK_VE_İŞ_KURALLARI>
1. 🔒 **STOK SORGULAMA KURALI (BEDEN VE ADET ZORUNLUDUR):**
   - Müşteri HANGİ BEDEN (S, M, L, XL, 41 vb.) ve KAÇ ADET ilgilendiğini söylemeden STOK SORGULAMASI YAPMA!
   - Eğer müşteri sadece "Gömlek var mı?" veya "KGMLW var mı?" dediyse, nazikçe şöyle sor: "Hangi beden (S, M, L, XL vb.) ve kaç adet düşünüyorsunuz?"

2. 🔒 **SİPARİŞ OLUŞTURMA KURALI (5 BİLGİ TAMAMLANMADAN KESİNLİKLE SİPARİŞ VERME!):**
   Şu 5 bilgi EKSİKSİZ alınmadan KAYIT/SIPARIS aracını tetikleme ve sipariş oluşturuldu deme:
   ① Müşteri Adı ve Soyadı (${ctx.customerName || '❌ Eksik'})
   ② Telefon Numarası (${ctx.customerPhone || '❌ Eksik'})
   ③ Teslimat Adresi (${ctx.address || '❌ Eksik'})
   ④ Beden Bilgisi (${ctx.size || '❌ Eksik'})
   ⑤ Adet Sayısı (${ctx.quantity || '❌ Eksik'})
   Eksik bilgi varsa müşteriden nazikçe bu eksik kalan bilgileri iste!

3. 🎉 **KAMPANYALAR VE DÜKKAN İNDİRİMLERİ:**
   Mağazamızın Aktif Kampanyaları:
${campaignsText}

4. 🚚 **KARGO ÜCRETİ VE FİYATLANDIRMA:**
   - Standart Kargo Ücreti: ${shippingFee} TL.
   - ${freeThreshold} TL ve üzeri siparişlerde KARGO ÜCRETSİZDİR!
   - Ürün fiyatı sorulduğunda veya sipariş özeti verirken ürün fiyatını, kargo ücretini ve varsa kampanya indirimini hesaplayarak toplam tutarı belirt.

5. 💬 **İNSANİ İLETİŞİM:**
   Robotik cümleler kullanma. Her mesaj sonuna yapay soru kalıpları koyma. Sıcak ve doğal butik danışmanı gibi konuş.
</KATI_GÜVENLİK_VE_İŞ_KURALLARI>
`);

      ctx.history.push(new HumanMessage(userMessage));
      if (ctx.history.length > 16) {
        ctx.history.splice(0, ctx.history.length - 16);
      }

      let messages: BaseMessage[] = [systemPrompt, ...ctx.history];
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
          } else if (tc.name === 'STOK_MAN') {
            toolResult = await stokManAgentTool.invoke(JSON.stringify(tc.args));
          }
          messages.push(new ToolMessage({ content: toolResult, tool_call_id: tc.id! }));
        }
        response = await boundRootModel.invoke(messages);
        trackUsage(response, messages.length);
        messages.push(response);
      }

      const finalOutput = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      ctx.history.push(new AIMessage(finalOutput));

      const totalTokens = promptTokens + completionTokens;
      const costUsd = (promptTokens * 0.0000025) + (completionTokens * 0.00001);

      return {
        reply: finalOutput,
        tokens: { promptTokens, completionTokens, totalTokens, costUsd }
      };

    } catch (error: any) {
      console.error('[AIService] ❌ İşlem Hatası:', error);
      return {
        reply: "Üzgünüm, şu an bağlantıda geçici bir yoğunluk var. Lütfen biraz sonra tekrar deneyiniz.",
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
      };
    }
  }
}

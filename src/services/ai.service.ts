import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { SystemMessage, HumanMessage, AIMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { env } from '../config/env';
import { StockService } from './stock.service';
import { OrderService } from './order.service';
import { TelegramService } from './telegram.service';
import { extractProductCode } from '../utils/regex.util';

interface SessionContext {
  history: BaseMessage[];
  productCode?: string;
  size?: string;
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
   * Yapay Zeka Destekli Akıllı Veri Ayıklama Motoru (AI Extraction - F.R.I.D.A.Y.)
   * Statik regex kuralları yerine GPT-4o-mini ile isim, telefon, adres, ürün kodu ve beden ayıklar.
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
Müşterinin gönderdiği mesajdan ad-soyad, telefon, adres, ürün kodu ve beden verilerini eksiksiz ayıkla.

Müşteri Mesajı: "${userText}"

Yalnızca aşağıdaki JSON yapısını döndür (bilinmeyen alanlar için null ver):
{
  "customerName": "Müşterinin Adı ve Soyadı (Örn: Emre İşcenkal, bulunamazsa null)",
  "customerPhone": "Müşterinin 10 veya 11 haneli Telefon Numarası (Örn: 05428523712, bulunamazsa null)",
  "address": "Müşterinin Açık Teslimat Adresi (Örn: Süleyman Mahallesi 1010 Sokak No 7, bulunamazsa null)",
  "productCode": "Varsa Ürün Kodu (Örn: KGMLW, TSW, NDL41, bulunamazsa null)",
  "size": "Varsa Beden (Örn: S, M, L, XL, 41, bulunamazsa null)"
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
      }
    } catch (e: any) {
      console.warn('[AI Extractor] ⚠️ AI veri ayıklama hatası:', e.message);
    }
  }

  /**
   * 1. Alt Düğüm Araçlarını (Leaf Tools) Tanımlar
   */
  private static createLeafTools(senderId: string) {
    const ctx = this.getSessionContext(senderId);

    // STOK Tool (Google Sheets Baron-DB)
    const stokTool = new DynamicTool({
      name: 'STOK',
      description: 'Ürün kodu yada ürün ismiyle stok sorgulaması yap.',
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
            availableSizes: result.product?.availableSizes,
            message: result.inStock ? 'Stokta mevcuttur.' : 'Stokta kalmamıştır.'
          });
        } catch (e: any) {
          return JSON.stringify({ error: e.message });
        }
      }
    });

    // KAYIT Tool (Google Sheets SİPARİŞLER)
    const kayitTool = new DynamicTool({
      name: 'KAYIT',
      description: 'SİPARİŞ DETAYLARINI BURAYA KAYDEDER. JSON: {"customerName":"...","customerPhone":"...","address":"...","productCode":"...","size":"...","quantity":1}',
      func: async (input: string) => {
        try {
          let data: any = {};
          try {
            data = typeof input === 'object' ? input : JSON.parse(input);
          } catch {
            data = {};
          }

          // Esnek Parametre Haritalama & Hafızadan Kurtarma (Fallback)
          let rawName = data.customerName || data.fullName || data.full_name || data.name || data.customer || '';
          if (ctx.customerName && ctx.customerName !== 'Müşteri') {
            rawName = ctx.customerName;
          } else if (!rawName || rawName.trim() === 'Müşteri' || rawName.trim().length <= 1) {
            rawName = ctx.customerName || 'Müşteri';
          }
          const finalCustomerName = rawName;

          let rawAddress = data.address || data.deliveryAddress || data.delivery_address || '';
          if (ctx.address && ctx.address !== 'Adres Belirtilmedi') {
            rawAddress = ctx.address;
          } else if (!rawAddress || rawAddress.trim() === 'Adres Belirtilmedi') {
            rawAddress = ctx.address || 'Adres Belirtilmedi';
          }
          const finalAddress = rawAddress;

          let rawPhone = data.customerPhone || data.phone || data.customer_phone || data.phoneNumber || data.phone_number || '';
          if (ctx.customerPhone) {
            rawPhone = ctx.customerPhone;
          } else if (!rawPhone || rawPhone === '05550000000' || rawPhone === '05551234567') {
            rawPhone = ctx.customerPhone || rawPhone || '05550000000';
          }
          const finalPhone = rawPhone;

          let rawCode = data.productCode || data.product_code || data.code || data.product || '';
          if (!rawCode || rawCode === 'URUN') {
            rawCode = ctx.productCode || 'KGMLW';
          }
          const finalProductCode = rawCode;
          const finalSize = data.size || data.beden || ctx.size || 'M';

          const order = await OrderService.createOrder({
            customerName: finalCustomerName,
            customerPhone: finalPhone,
            address: finalAddress,
            productCode: finalProductCode,
            productName: finalProductCode,
            size: finalSize,
            quantity: Number(data.quantity) || 1,
            senderId: senderId
          });

          return JSON.stringify({ success: true, orderId: order.orderId, productCode: order.productCode });
        } catch (e: any) {
          return JSON.stringify({ error: e.message });
        }
      }
    });

    // MESAJ Tool (Telegram Bildirimi)
    const mesajTool = new DynamicTool({
      name: 'MESAJ',
      description: 'İşletme sahibine Telegram üzerinden HTML formatında bildirim gönderir.',
      func: async (input: string) => {
        try {
          let data: any = {};
          try {
            data = typeof input === 'object' ? input : JSON.parse(input);
          } catch {
            data = { orderId: input };
          }

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

  /**
   * n8n 'BİLGİLENDİRME' Sub-Agent Tool
   */
  private static createBilgilendirmeSubAgent(model: ChatOpenAI, mesajTool: DynamicTool) {
    return new DynamicTool({
      name: 'BILGILENDIRME',
      description: 'sipariş verildiğinde sipariş bilgilerini ve sipariş numarasını bu ajana gönder',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`
<görev>
Sen işletme sahibini Telegram üzerinden yeni siparişler hakkında bilgilendiren asistansın. Sipariş tamamlandığında SADECE BİR KERE mesaj gönderirsin.
</görev>

<mesaj_şablonu>
MESAJ aracıyla işletme sahibine şu HTML formatında bilgi ilet:

🛍️ <b>YENİ SİPARİŞ BİLDİRİMİ</b>
- <b>İSİM SOYİSİM:</b> {İsim Soyisim}
- <b>ÜRÜN KODU:</b> {Ürün Kodu}
- <b>BEDEN:</b> {Beden}
- <b>ADRES:</b> {Adres}
- <b>TELEFON:</b> {Telefon Numarası}
- <b>SİPARİŞ NUMARASI:</b> <code>{Siparişte Oluşturulan Sipariş Numarası}</code>

ONAYLAMAK İÇİN SİPARİŞ NUMARASI İLE ONAY YADA RED YAZINIZ.
</mesaj_şablonu>
`);
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

  /**
   * n8n 'SİPARİS' Sub-Agent Tool
   */
  private static createSiparisSubAgent(model: ChatOpenAI, stokTool: DynamicTool, kayitTool: DynamicTool, bilgilendirmeAgentTool: DynamicTool) {
    return new DynamicTool({
      name: 'SIPARIS',
      description: 'ANA AJANDAN ALINAN OUTPUTU DİREKT BURAYA VER',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`
<görev>
Sen stok sorgulaması yapmak ve sipariş tamamlandığında müşteri bilgilerini kaydetmekle görevli ajansın.
</görev>

<yönergeler>
1. **Stok Sorgulama (STOK):** Müşterinin istediği Ürün Kodu veya İsim ile STOK aracından stok kontrolü yap.
2. **Kayıt (KAYIT):** Sipariş bilgileri (İsim, Soyisim, Ürün Kodu, Beden, Adres, Telefon, Adet) eksiksiz alındığında KAYIT aracını çağırarak siparişi tabloya ekle.
3. **Bilgilendirme (BİLGİLENDİRME):** Sipariş kaydı oluştuktan sonra BİLGİLENDİRME aracını çalıştırarak işletme sahibine sipariş detaylarını ilet.
</yönergeler>
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

  /**
   * n8n 'STOK MAN' Sub-Agent Tool
   */
  private static createStokManSubAgent(model: ChatOpenAI, guncelleTool: DynamicTool) {
    return new DynamicTool({
      name: 'STOK_MAN',
      description: 'sipariş onaylanırsa buraya sipariş detaylarını gönder',
      func: async (input: string) => {
        const systemPrompt = new SystemMessage(`Sen bir stok güncelleme Ajanısın.`);
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

  /**
   * n8n Root 'ANA' Agent İşleyicisi
   */
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
      // Yapay Zeka Destekli Akıllı Veri Ayıklama Motorunu Çalıştır (F.R.I.D.A.Y. AI Extractor)
      await this.extractSessionDataWithAI(senderId, userMessage, apiKey);
      const ctx = this.getSessionContext(senderId);

      const model = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: env.openaiModel || 'gpt-4o',
        temperature: 0.2
      });

      // Alt Ajan ve Araç Ağacını Kur
      const { stokTool, kayitTool, mesajTool, guncelleTool } = this.createLeafTools(senderId);
      const bilgilendirmeAgentTool = this.createBilgilendirmeSubAgent(model, mesajTool);
      const siparisAgentTool = this.createSiparisSubAgent(model, stokTool, kayitTool, bilgilendirmeAgentTool);
      const stokManAgentTool = this.createStokManSubAgent(model, guncelleTool);

      const rootTools = [siparisAgentTool, stokManAgentTool];
      const boundRootModel = model.bindTools(rootTools);

      const systemPrompt = new SystemMessage(`
<görev>
Sen BARON'S SILLAGE 7/24 Mağaza Müşteri Danışmanısın. Tıpkı gerçek bir insan satış temsilcisi gibi sıcak, son derece nazik ve doğal bir iletişim kurarsın.
</görev>

<üslup_ve_doğallık_kuralları>
1. ROBOTİK KALIPLARI KESİNLİKLE KULLANMA: Her mesajın sonuna "Başka bir konuda yardımcı olabilir miyim?" veya "Başka bir isteğiniz var mı?" gibi yapay robotik cümleler KESİNLİKLE KOYMA.
2. İNSAN GİBİ KONUŞ: Gerçek bir butik mağaza danışmanı gibi akıcı konuş. (Örn: "KGMLW modelimiz stokta mevcuttur! Siparişinizi oluşturmamı ister misiniz?")
</üslup_ve_doğallık_kuralları>

<akış_ve_kurallar>
1. **İlk Temas:** İlk mesajda müşteriyi sıcak ve nazikçe karşıla.
2. **Kısa Kod ve Beden Akışı:**
   - Müşteri ürün ismi veya kısa kod verdiyse (Örn: KGMLW), ÖNCE hangi bedeni (S, M, L, XL veya 40, 41) istediğini sor.
   - Beden bilgisi alındıktan sonra kısa kod ile bedeni birleştirip (Örn: KGMLW-M) SIPARIS aracını çalıştır.
3. **HAFIZA VE VERİ KORUMA KURALI:**
   - Önceki mesajlarda konuşulan ÜRÜN KODUNU (Örn: ${ctx.productCode || 'KGMLW'}) ve BEDENİ (Örn: ${ctx.size || 'M'}) asla unutma. SIPARIS veya KAYIT araçlarını çağırırken bu ürün kodunu ve müşterinin telefonunu eksiksiz aktar.
4. **Sipariş Kaydı:** Müşteri bilgileri tam alındığında SIPARIS aracını çağırarak sipariş kaydını oluştur ve teşekkür et.
</akış_ve_kurallar>
`);

      ctx.history.push(new HumanMessage(userMessage));
      if (ctx.history.length > 16) {
        ctx.history.splice(0, ctx.history.length - 16);
      }

      let messages: BaseMessage[] = [systemPrompt, ...ctx.history];
      let response = await boundRootModel.invoke(messages);
      trackUsage(response, messages.length);
      messages.push(response);

      // Root Agent Tool Execution Loop
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
        tokens: {
          promptTokens,
          completionTokens,
          totalTokens,
          costUsd: Number(costUsd.toFixed(6))
        }
      };
    } catch (error: any) {
      console.error('[AIService Hiyerarşik Ajan] ❌ Hata:', error);
      return {
        reply: "Anlayışınız için teşekkür ederiz, talebinizi işleme alıyoruz.",
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
      };
    }
  }
}

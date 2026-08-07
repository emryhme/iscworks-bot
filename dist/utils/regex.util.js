"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractProductCode = extractProductCode;
/**
 * Metin veya Instagram gönderi başlığı içerisinden ÜRÜN KODU ayıklama aracı.
 */
function extractProductCode(text) {
    if (!text)
        return null;
    // 1. Açık etiket eşleşmesi: "ÜRÜN KODU = KGMLW-M" veya "Ürün Kodu: NDL41"
    const match = text.match(/(?:ÜRÜN\s*KODU|KODU|MODEL\s*KODU)\s*[:=]\s*([A-Z0-9-]+)/i);
    if (match && match[1]) {
        return match[1].toUpperCase();
    }
    // 2. Özel Ürün Kodu Desenleri (KGMLW-M, NDL41, STRC39, TSW-S, KGMLW vb.)
    // İnsan isimlerinin (emre, ahmet) ürün kodu sanılmaması için büyük harf ve desen kuralı uygulanır.
    const patternMatch = text.match(/\b([A-Z]{2,6}-(?:S|M|L|XL|XXL|[34]\d)|[A-Z]{2,6}\d{1,3}|KGMLW|KTGMLB|DGMLP|STRC39|NDL41|TSW)\b/);
    if (patternMatch && patternMatch[1]) {
        return patternMatch[1].toUpperCase();
    }
    return null;
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
exports.env = {
    port: parseInt(process.env.PORT || '3000', 10),
    fbVerifyToken: process.env.FB_VERIFY_TOKEN || 'barons_secure_verify_token_2026',
    fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '7659971499',
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || process.env.N8N_ORDER_APPROVED_WEBHOOK_URL || ''
};

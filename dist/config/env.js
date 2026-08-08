"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const zod_1 = require("zod");
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../.env') });
const envSchema = zod_1.z.object({
    PORT: zod_1.z.string().default('3000').transform((v) => parseInt(v, 10)),
    NODE_ENV: zod_1.z.string().default('development'),
    FB_VERIFY_TOKEN: zod_1.z.string().default('barons_secure_verify_token_2026'),
    FB_PAGE_ACCESS_TOKEN: zod_1.z.string().default(''),
    OPENAI_API_KEY: zod_1.z.string().default(''),
    OPENAI_MODEL: zod_1.z.string().default('gpt-4o'),
    GEMINI_API_KEY: zod_1.z.string().default(''),
    TELEGRAM_BOT_TOKEN: zod_1.z.string().default(''),
    TELEGRAM_CHAT_ID: zod_1.z.string().default('7659971499'),
    N8N_WEBHOOK_URL: zod_1.z.string().default(''),
    JWT_SECRET: zod_1.z.string().default('iscworks_jwt_secret_key_production_2026'),
    ADMIN_USER: zod_1.z.string().default('tonystark'),
    ADMIN_PASS: zod_1.z.string().default('cintonik!'),
    CORS_ORIGINS: zod_1.z.string().default('*')
});
const parsedEnv = envSchema.safeParse(process.env);
const envValues = parsedEnv.success ? parsedEnv.data : {
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    FB_VERIFY_TOKEN: process.env.FB_VERIFY_TOKEN || 'barons_secure_verify_token_2026',
    FB_PAGE_ACCESS_TOKEN: process.env.FB_PAGE_ACCESS_TOKEN || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '7659971499',
    N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL || '',
    JWT_SECRET: process.env.JWT_SECRET || 'iscworks_jwt_secret_key_production_2026',
    ADMIN_USER: process.env.ADMIN_USER || 'tonystark',
    ADMIN_PASS: process.env.ADMIN_PASS || 'cintonik!',
    CORS_ORIGINS: process.env.CORS_ORIGINS || '*'
};
exports.env = {
    port: envValues.PORT,
    nodeEnv: envValues.NODE_ENV,
    fbVerifyToken: envValues.FB_VERIFY_TOKEN,
    fbPageAccessToken: envValues.FB_PAGE_ACCESS_TOKEN,
    openaiApiKey: envValues.OPENAI_API_KEY,
    openaiModel: envValues.OPENAI_MODEL,
    geminiApiKey: envValues.GEMINI_API_KEY,
    telegramBotToken: envValues.TELEGRAM_BOT_TOKEN,
    telegramChatId: envValues.TELEGRAM_CHAT_ID,
    n8nWebhookUrl: envValues.N8N_WEBHOOK_URL,
    jwtSecret: envValues.JWT_SECRET,
    adminUser: envValues.ADMIN_USER,
    adminPass: envValues.ADMIN_PASS,
    corsOrigins: envValues.CORS_ORIGINS
};

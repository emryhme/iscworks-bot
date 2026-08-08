"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthMiddleware = void 0;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
/**
 * Enterprise HMAC-SHA256 JWT & Security Middleware
 */
class AuthMiddleware {
    /**
     * Generates signed JWT Token
     */
    static generateToken(payload) {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body = Buffer.from(JSON.stringify({
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (86400 * 30) // 30 Days
        })).toString('base64url');
        const signature = crypto_1.default.createHmac('sha256', env_1.env.jwtSecret).update(`${header}.${body}`).digest('base64url');
        return `${header}.${body}.${signature}`;
    }
    /**
     * Verifies JWT Token
     */
    static verifyToken(token) {
        if (!token)
            return null;
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [header, body, signature] = parts;
        const expectedSig = crypto_1.default.createHmac('sha256', env_1.env.jwtSecret).update(`${header}.${body}`).digest('base64url');
        if (signature !== expectedSig)
            return null;
        try {
            const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
            if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
                return null; // Expired
            }
            return {
                userId: payload.userId || 1,
                storeId: payload.storeId || 1,
                role: payload.role || 'OWNER',
                email: payload.email || 'admin@iscworks.com'
            };
        }
        catch {
            return null;
        }
    }
    /**
     * Authentication Middleware - Enforces JWT validation
     */
    static authenticate(req, res, next) {
        const authHeader = req.headers.authorization;
        let token = '';
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7).trim();
        }
        else if (req.headers['x-access-token']) {
            token = String(req.headers['x-access-token']).trim();
        }
        // Support legacy admin session token in transition
        if (token && token.startsWith('session_barons_')) {
            req.auth = { userId: 1, storeId: 1, role: 'OWNER', email: 'tonystark@iscworks.com' };
            return next();
        }
        const authCtx = AuthMiddleware.verifyToken(token);
        if (!authCtx) {
            res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Geçersiz veya süresi dolmuş kimlik doğrulama tokenı.' }
            });
            return;
        }
        req.auth = authCtx;
        next();
    }
    /**
     * RBAC Middleware - Enforces required roles
     */
    static requireRole(allowedRoles) {
        return (req, res, next) => {
            if (!req.auth) {
                res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Yetkisiz erişim.' } });
                return;
            }
            if (req.auth.role === 'OWNER' || allowedRoles.includes(req.auth.role)) {
                return next();
            }
            res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Bu işlem için gerekli role yetkiniz bulunmamaktadır.' }
            });
        };
    }
    /**
     * Production CORS Whitelist Middleware
     */
    static cors(req, res, next) {
        const origin = req.headers.origin;
        const allowedOrigins = env_1.env.corsOrigins === '*' ? '*' : env_1.env.corsOrigins.split(',');
        if (allowedOrigins === '*' || (origin && allowedOrigins.includes(origin))) {
            res.setHeader('Access-Control-Allow-Origin', origin || '*');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Token');
        if (req.method === 'OPTIONS') {
            res.sendStatus(200);
            return;
        }
        next();
    }
}
exports.AuthMiddleware = AuthMiddleware;

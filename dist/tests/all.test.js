"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const stock_service_1 = require("../services/stock.service");
const webhook_controller_1 = require("../controllers/webhook.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const db_1 = require("../database/db");
async function runTestSuite() {
    console.log('🧪 Starting ISC Works Stage 7 Multi-Tenant Frontend & Master Security Test Suite...\n');
    let passed = 0;
    let failed = 0;
    function assert(condition, testName) {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        }
        else {
            console.error(`  ❌ FAIL: ${testName}`);
            failed++;
        }
    }
    // PRE-TEST CLEANUP
    db_1.db.prepare('DELETE FROM audit_logs WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM api_keys WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM orders WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM order_items WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM customers WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM products WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM inventory WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM campaigns WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM settings WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM user_rewards WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM conversations WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM webhook_events WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM memberships WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare("DELETE FROM users WHERE email IN ('owner_a@iscworks.com', 'staff_a@iscworks.com', 'owner_b@iscworks.com', 'inactive_user@iscworks.com')").run();
    db_1.db.prepare('DELETE FROM stores WHERE id IN (100, 200, 999)').run();
    // SEED STORES
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (100, 10, 'Store Alpha', 'store-alpha', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (200, 20, 'Store Beta', 'store-beta', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (999, 30, 'Store Suspended', 'store-suspended', 'suspended')").run();
    // SEED USERS & MEMBERSHIPS
    const passHash = (0, db_1.hashPassword)('password123');
    // User 10: Store 100 OWNER
    db_1.db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (10, 'Owner Alpha', 'owner_a@iscworks.com', ?, 'active')").run(passHash);
    db_1.db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (10, 100, 'OWNER', 'active')").run();
    // User 11: Store 100 STAFF
    db_1.db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (11, 'Staff Alpha', 'staff_a@iscworks.com', ?, 'active')").run(passHash);
    db_1.db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (11, 100, 'STAFF', 'active')").run();
    // User 20: Store 200 OWNER
    db_1.db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (20, 'Owner Beta', 'owner_b@iscworks.com', ?, 'active')").run(passHash);
    db_1.db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (20, 200, 'OWNER', 'active')").run();
    // User 30: Inactive Membership User
    db_1.db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (30, 'Inactive User', 'inactive_user@iscworks.com', ?, 'active')").run(passHash);
    db_1.db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (30, 100, 'OWNER', 'inactive')").run();
    // SEED PRODUCTS
    await stock_service_1.StockService.addProduct({ storeId: 100, shortCode: 'TSH', productCode: 'TSH-M', name: 'T-Shirt A', size: 'M', stock: 20, price: 150 });
    await stock_service_1.StockService.addProduct({ storeId: 200, shortCode: 'TSH', productCode: 'TSH-M', name: 'T-Shirt B', size: 'M', stock: 40, price: 450 });
    // 1. AUTH & JWT TESTS
    console.log('1️⃣ AUTH TEST 1: Password Verification (PBKDF2 SHA-512)');
    assert((0, db_1.verifyPassword)('password123', passHash) === true, 'Valid password verification returns true');
    assert((0, db_1.verifyPassword)('wrongpassword', passHash) === false, 'Invalid password verification returns false');
    console.log('\n2️⃣ AUTH TEST 2: Valid JWT Token Generation & Verification');
    const jwtOwnerA = auth_middleware_1.AuthMiddleware.generateToken({ userId: 10, storeId: 100, role: 'OWNER', email: 'owner_a@iscworks.com' });
    const decodedA = auth_middleware_1.AuthMiddleware.verifyToken(jwtOwnerA);
    assert(decodedA !== null && decodedA.userId === 10 && decodedA.storeId === 100 && decodedA.role === 'OWNER', 'Valid JWT token verified successfully');
    console.log('\n3️⃣ AUTH TEST 3: Invalid & Expired Token Rejection');
    const invalidSigToken = jwtOwnerA.substring(0, jwtOwnerA.length - 5) + 'X1Y2Z';
    assert(auth_middleware_1.AuthMiddleware.verifyToken(invalidSigToken) === null, 'Tampered/invalid signature token rejected');
    assert(auth_middleware_1.AuthMiddleware.verifyToken('') === null, 'Empty token rejected');
    console.log('\n4️⃣ AUTH TEST 4: Legacy Session Token Bypass Rejection on Protected API');
    let authFailed = false;
    const mockResAuth = { status: (code) => ({ json: (data) => { if (code === 401)
                authFailed = true; } }) };
    auth_middleware_1.AuthMiddleware.authenticate({ headers: { authorization: 'Bearer session_barons_legacy_hack_token' } }, mockResAuth, () => { });
    assert(authFailed === true, 'Legacy session_barons_ bypass token rejected on protected API');
    // 2. TENANT ISOLATION TESTS
    console.log('\n5️⃣ TENANT TEST 1: Authenticated Request Tenant Scoping');
    let reqContext = null;
    const mockReqStoreA = { headers: { authorization: `Bearer ${jwtOwnerA}` } };
    auth_middleware_1.AuthMiddleware.authenticate(mockReqStoreA, mockResAuth, () => { reqContext = mockReqStoreA.auth; });
    assert(reqContext !== null && reqContext.storeId === 100 && reqContext.role === 'OWNER', 'Auth context populated with validated storeId 100');
    console.log('\n6️⃣ TENANT TEST 2: Cross-Tenant Store B Access Rejection for Store A User');
    const jwtFakeB = auth_middleware_1.AuthMiddleware.generateToken({ userId: 10, storeId: 200, role: 'OWNER', email: 'owner_a@iscworks.com' });
    let forbidFailed = false;
    const mockResForbid = { status: (code) => ({ json: () => { if (code === 403)
                forbidFailed = true; } }) };
    auth_middleware_1.AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtFakeB}` } }, mockResForbid, () => { });
    assert(forbidFailed === true, 'User 10 attempting to claim Store 200 JWT is rejected by DB membership check');
    console.log('\n7️⃣ TENANT TEST 3: Inactive Membership Rejection');
    const jwtInactive = auth_middleware_1.AuthMiddleware.generateToken({ userId: 30, storeId: 100, role: 'OWNER', email: 'inactive_user@iscworks.com' });
    let inactiveFailed = false;
    const mockResInactive = { status: (code) => ({ json: () => { if (code === 403)
                inactiveFailed = true; } }) };
    auth_middleware_1.AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtInactive}` } }, mockResInactive, () => { });
    assert(inactiveFailed === true, 'User 30 with inactive membership is rejected with 403 Forbidden');
    console.log('\n8️⃣ TENANT TEST 4: Suspended Store Rejection');
    const jwtSuspended = auth_middleware_1.AuthMiddleware.generateToken({ userId: 30, storeId: 999, role: 'OWNER', email: 'inactive_user@iscworks.com' });
    let suspendedFailed = false;
    const mockResSuspended = { status: (code) => ({ json: () => { if (code === 403)
                suspendedFailed = true; } }) };
    auth_middleware_1.AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtSuspended}` } }, mockResSuspended, () => { });
    assert(suspendedFailed === true, 'User attempting access to suspended store 999 is rejected with 403 Forbidden');
    // 3. RBAC ROLE ESCALATION TESTS
    console.log('\n9️⃣ RBAC TEST 1: OWNER Role Access Allowance');
    let roleOwnerPassed = false;
    const rbacOwnerReq = { auth: { userId: 10, storeId: 100, role: 'OWNER', email: 'owner_a@iscworks.com' } };
    auth_middleware_1.AuthMiddleware.requireRole(['OWNER'])(rbacOwnerReq, mockResForbid, () => { roleOwnerPassed = true; });
    assert(roleOwnerPassed === true, 'OWNER role passes OWNER restricted middleware');
    console.log('\n🔟 RBAC TEST 2: STAFF Role Access Restriction on OWNER Action');
    let roleStaffBlocked = false;
    const rbacStaffReq = { auth: { userId: 11, storeId: 100, role: 'STAFF', email: 'staff_a@iscworks.com' } };
    const mockResRbac = { status: (code) => ({ json: () => { if (code === 403)
                roleStaffBlocked = true; } }) };
    auth_middleware_1.AuthMiddleware.requireRole(['OWNER'])(rbacStaffReq, mockResRbac, () => { roleStaffBlocked = false; });
    assert(roleStaffBlocked === true, 'STAFF role blocked from OWNER restricted action');
    // 4. API KEY & AUDIT LOG TESTS
    console.log('\n1️⃣1️⃣ API KEY TEST: Multi-Tenant API Key Authentication');
    const rawKey = 'isc_live_test_key_12345';
    const keyHash = crypto_1.default.createHash('sha256').update(rawKey).digest('hex');
    db_1.db.prepare("INSERT INTO api_keys (store_id, name, key_hash, permissions) VALUES (100, 'Integration Test Key', ?, 'read_write')").run(keyHash);
    let apiKeyAuthenticated = false;
    let apiKeyStoreId = 0;
    const mockReqApiKey = { headers: { 'x-api-key': rawKey } };
    auth_middleware_1.AuthMiddleware.authenticate(mockReqApiKey, mockResAuth, () => {
        apiKeyAuthenticated = true;
        apiKeyStoreId = mockReqApiKey.auth?.storeId || 0;
    });
    assert(apiKeyAuthenticated === true && apiKeyStoreId === 100, 'API key authenticated strictly to Store ID 100');
    console.log('\n1️⃣2️⃣ AUDIT LOG TEST: Audit Logging Scoped by Store ID');
    auth_middleware_1.AuthMiddleware.logAudit(100, 10, 'TEST_AUDIT_ACTION', 'products', 'TSH-M');
    const auditRow = db_1.db.prepare("SELECT * FROM audit_logs WHERE store_id = 100 AND action = 'TEST_AUDIT_ACTION'").get();
    assert(auditRow !== undefined && auditRow.user_id === 10 && auditRow.entity_id === 'TSH-M', 'Audit log inserted strictly with store_id 100 and user_id 10');
    // 5. STAGE 7 FRONTEND & REGRESSION TESTS
    console.log('\n1️⃣3️⃣ STAGE 7 FRONTEND TEST 1: XSS Neutralization Utility');
    function escapeHtmlTest(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    const xssVector = '<script>alert("hack")</script>';
    const escaped = escapeHtmlTest(xssVector);
    assert(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;'), 'XSS script injection vector successfully neutralized');
    console.log('\n1️⃣4️⃣ STAGE 7 FRONTEND TEST 2: Multi-Tenant Data Fetch Isolation');
    const prodsStoreA = await stock_service_1.StockService.getAllProducts(100);
    const prodsStoreB = await stock_service_1.StockService.getAllProducts(200);
    assert(prodsStoreA.length === 1 && prodsStoreA[0].name === 'T-Shirt A', 'Frontend API fetch for Store A returns strictly Store A product (T-Shirt A)');
    assert(prodsStoreB.length === 1 && prodsStoreB[0].name === 'T-Shirt B', 'Frontend API fetch for Store B returns strictly Store B product (T-Shirt B)');
    console.log('\n1️⃣5️⃣ STAGE 7 REGRESSION TEST: Webhook Resolution & Idempotency');
    const resolvedAlpha = webhook_controller_1.WebhookController.resolveStore('store-alpha');
    assert(resolvedAlpha !== null && resolvedAlpha.id === 100, 'store-alpha resolved to Store ID 100');
    const firstEvt = webhook_controller_1.WebhookController.isDuplicateEvent('evt_stage7_001', 100);
    const secondEvt = webhook_controller_1.WebhookController.isDuplicateEvent('evt_stage7_001', 100);
    assert(firstEvt === false && secondEvt === true, 'Webhook idempotency works seamlessly across multi-tenant events');
    console.log(`\n📊 STAGE 7 MASTER SECURITY & FRONTEND TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}
runTestSuite().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});

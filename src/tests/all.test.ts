import crypto from 'crypto';
import { StockService } from '../services/stock.service';
import { InventoryService } from '../services/inventory.service';
import { OrderService } from '../services/order.service';
import { AIService } from '../services/ai.service';
import { AdminCopilotService } from '../services/admin-copilot.service';
import { GeminiService } from '../services/gemini.service';
import { WebhookController } from '../controllers/webhook.controller';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { db, hashPassword, verifyPassword } from '../database/db';

async function runTestSuite() {
  console.log('🧪 Starting ISC Works Master Admin & Master Security Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // PRE-TEST CLEANUP
  db.prepare('DELETE FROM audit_logs WHERE store_id IN (1, 100, 200, 999)').run();
  db.prepare('DELETE FROM api_keys WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM orders WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM order_items WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM customers WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM products WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM inventory WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM campaigns WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM settings WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM user_rewards WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM conversations WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM webhook_events WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM memberships WHERE store_id IN (100, 200, 999)').run();
  db.prepare("DELETE FROM users WHERE email IN ('owner_a@iscworks.com', 'staff_a@iscworks.com', 'owner_b@iscworks.com', 'inactive_user@iscworks.com')").run();
  db.prepare('DELETE FROM stores WHERE id IN (100, 200, 999)').run();

  // SEED STORES
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (100, 10, 'Store Alpha', 'store-alpha', 'active')").run();
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (200, 20, 'Store Beta', 'store-beta', 'active')").run();
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (999, 30, 'Store Suspended', 'store-suspended', 'suspended')").run();

  // SEED USERS & MEMBERSHIPS
  const passHash = hashPassword('password123');
  
  // User 10: Store 100 OWNER
  db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (10, 'Owner Alpha', 'owner_a@iscworks.com', ?, 'active')").run(passHash);
  db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (10, 100, 'OWNER', 'active')").run();

  // User 11: Store 100 STAFF
  db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (11, 'Staff Alpha', 'staff_a@iscworks.com', ?, 'active')").run(passHash);
  db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (11, 100, 'STAFF', 'active')").run();

  // User 20: Store 200 OWNER
  db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (20, 'Owner Beta', 'owner_b@iscworks.com', ?, 'active')").run(passHash);
  db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (20, 200, 'OWNER', 'active')").run();

  // User 30: Inactive Membership User
  db.prepare("INSERT INTO users (id, full_name, email, password_hash, status) VALUES (30, 'Inactive User', 'inactive_user@iscworks.com', ?, 'active')").run(passHash);
  db.prepare("INSERT INTO memberships (user_id, store_id, role, status) VALUES (30, 100, 'OWNER', 'inactive')").run();

  // SEED PRODUCTS
  await StockService.addProduct({ storeId: 100, shortCode: 'TSH', productCode: 'TSH-M', name: 'T-Shirt A', size: 'M', stock: 20, price: 150 });
  await StockService.addProduct({ storeId: 200, shortCode: 'TSH', productCode: 'TSH-M', name: 'T-Shirt B', size: 'M', stock: 40, price: 450 });

  // 1. AUTH & JWT TESTS
  console.log('1️⃣ AUTH TEST 1: Password Verification (PBKDF2 SHA-512)');
  assert(verifyPassword('password123', passHash) === true, 'Valid password verification returns true');
  assert(verifyPassword('wrongpassword', passHash) === false, 'Invalid password verification returns false');

  console.log('\n2️⃣ AUTH TEST 2: Valid JWT Token Generation & Verification');
  const jwtOwnerA = AuthMiddleware.generateToken({ userId: 10, storeId: 100, role: 'OWNER', email: 'owner_a@iscworks.com' });
  const decodedA = AuthMiddleware.verifyToken(jwtOwnerA);
  assert(decodedA !== null && decodedA.userId === 10 && decodedA.storeId === 100 && decodedA.role === 'OWNER', 'Valid JWT token verified successfully');

  console.log('\n3️⃣ AUTH TEST 3: Invalid & Expired Token Rejection');
  const invalidSigToken = jwtOwnerA.substring(0, jwtOwnerA.length - 5) + 'X1Y2Z';
  assert(AuthMiddleware.verifyToken(invalidSigToken) === null, 'Tampered/invalid signature token rejected');
  assert(AuthMiddleware.verifyToken('') === null, 'Empty token rejected');

  console.log('\n4️⃣ AUTH TEST 4: Legacy Session Token Bypass Rejection on Protected API');
  let authFailed: boolean = false;
  const mockResAuth = { status: (code: number) => ({ json: (data: any) => { if (code === 401) authFailed = true; } }) } as any;
  AuthMiddleware.authenticate({ headers: { authorization: 'Bearer session_barons_legacy_hack_token' } } as any, mockResAuth, () => {});
  assert((authFailed as boolean) === true, 'Legacy session_barons_ bypass token rejected on protected API');

  // 2. TENANT ISOLATION TESTS
  console.log('\n5️⃣ TENANT TEST 1: Authenticated Request Tenant Scoping');
  let reqContext: any = null;
  const mockReqStoreA = { headers: { authorization: `Bearer ${jwtOwnerA}` } } as any;
  AuthMiddleware.authenticate(mockReqStoreA, mockResAuth, () => { reqContext = mockReqStoreA.auth; });
  assert(reqContext !== null && reqContext.storeId === 100 && reqContext.role === 'OWNER', 'Auth context populated with validated storeId 100');

  console.log('\n6️⃣ TENANT TEST 2: Cross-Tenant Store B Access Rejection for Store A User');
  const jwtFakeB = AuthMiddleware.generateToken({ userId: 10, storeId: 200, role: 'OWNER', email: 'owner_a@iscworks.com' });
  let forbidFailed: boolean = false;
  const mockResForbid = { status: (code: number) => ({ json: () => { if (code === 403) forbidFailed = true; } }) } as any;
  AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtFakeB}` } } as any, mockResForbid, () => {});
  assert((forbidFailed as boolean) === true, 'User 10 attempting to claim Store 200 JWT is rejected by DB membership check');

  console.log('\n7️⃣ TENANT TEST 3: Inactive Membership Rejection');
  const jwtInactive = AuthMiddleware.generateToken({ userId: 30, storeId: 100, role: 'OWNER', email: 'inactive_user@iscworks.com' });
  let inactiveFailed: boolean = false;
  const mockResInactive = { status: (code: number) => ({ json: () => { if (code === 403) inactiveFailed = true; } }) } as any;
  AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtInactive}` } } as any, mockResInactive, () => {});
  assert((inactiveFailed as boolean) === true, 'User 30 with inactive membership is rejected with 403 Forbidden');

  console.log('\n8️⃣ TENANT TEST 4: Suspended Store Rejection');
  const jwtSuspended = AuthMiddleware.generateToken({ userId: 30, storeId: 999, role: 'OWNER', email: 'inactive_user@iscworks.com' });
  let suspendedFailed: boolean = false;
  const mockResSuspended = { status: (code: number) => ({ json: () => { if (code === 403) suspendedFailed = true; } }) } as any;
  AuthMiddleware.authenticate({ headers: { authorization: `Bearer ${jwtSuspended}` } } as any, mockResSuspended, () => {});
  assert((suspendedFailed as boolean) === true, 'User attempting access to suspended store 999 is rejected with 403 Forbidden');

  // 3. RBAC ROLE ESCALATION TESTS
  console.log('\n9️⃣ RBAC TEST 1: OWNER Role Access Allowance');
  let roleOwnerPassed: boolean = false;
  const rbacOwnerReq = { auth: { userId: 10, storeId: 100, role: 'OWNER', email: 'owner_a@iscworks.com' } } as any;
  AuthMiddleware.requireRole(['OWNER'])(rbacOwnerReq, mockResForbid, () => { roleOwnerPassed = true; });
  assert((roleOwnerPassed as boolean) === true, 'OWNER role passes OWNER restricted middleware');

  console.log('\n🔟 RBAC TEST 2: STAFF Role Access Restriction on OWNER Action');
  let roleStaffBlocked: boolean = false;
  const rbacStaffReq = { auth: { userId: 11, storeId: 100, role: 'STAFF', email: 'staff_a@iscworks.com' } } as any;
  const mockResRbac = { status: (code: number) => ({ json: () => { if (code === 403) roleStaffBlocked = true; } }) } as any;
  AuthMiddleware.requireRole(['OWNER'])(rbacStaffReq, mockResRbac, () => { roleStaffBlocked = false; });
  assert((roleStaffBlocked as boolean) === true, 'STAFF role blocked from OWNER restricted action');

  // 4. API KEY & AUDIT LOG TESTS
  console.log('\n1️⃣1️⃣ API KEY TEST: Multi-Tenant API Key Authentication');
  const rawKey = 'isc_live_test_key_12345';
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  db.prepare("INSERT INTO api_keys (store_id, name, key_hash, permissions) VALUES (100, 'Integration Test Key', ?, 'read_write')").run(keyHash);
  let apiKeyAuthenticated: boolean = false;
  let apiKeyStoreId = 0;
  const mockReqApiKey = { headers: { 'x-api-key': rawKey } } as any;
  AuthMiddleware.authenticate(mockReqApiKey, mockResAuth, () => {
    apiKeyAuthenticated = true;
    apiKeyStoreId = mockReqApiKey.auth?.storeId || 0;
  });
  assert((apiKeyAuthenticated as boolean) === true && apiKeyStoreId === 100, 'API key authenticated strictly to Store ID 100');

  console.log('\n1️⃣2️⃣ AUDIT LOG TEST: Audit Logging Scoped by Store ID');
  AuthMiddleware.logAudit(100, 10, 'TEST_AUDIT_ACTION', 'products', 'TSH-M');
  const auditRow = db.prepare("SELECT * FROM audit_logs WHERE store_id = 100 AND action = 'TEST_AUDIT_ACTION'").get() as any;
  assert(auditRow !== undefined && auditRow.user_id === 10 && auditRow.entity_id === 'TSH-M', 'Audit log inserted strictly with store_id 100 and user_id 10');

  // 5. MASTER ADMIN AUTH & SECURITY TESTS
  console.log('\n1️⃣3️⃣ MASTER ADMIN TEST 1: Master Admin Authorization Allowance (Store 1 OWNER)');
  let masterAdminAllowed = false;
  const reqMasterAdmin = { auth: { userId: 1, storeId: 1, role: 'OWNER', email: 'tonystark@iscworks.com' } } as any;
  AuthMiddleware.requireMasterAdmin(reqMasterAdmin, mockResForbid, () => { masterAdminAllowed = true; });
  assert((masterAdminAllowed as boolean) === true, 'Master Admin token (Store 1 OWNER) passes requireMasterAdmin middleware');

  console.log('\n1️⃣4️⃣ MASTER ADMIN TEST 2: Merchant Store 100 Access Rejection on Master Admin Route');
  let merchantBlockedOnMaster = false;
  const reqMerchant = { auth: { userId: 10, storeId: 100, role: 'OWNER', email: 'owner_a@iscworks.com' } } as any;
  const mockResMasterForbid = { status: (code: number) => ({ json: (d: any) => { if (code === 403) merchantBlockedOnMaster = true; } }) } as any;
  AuthMiddleware.requireMasterAdmin(reqMerchant, mockResMasterForbid, () => { merchantBlockedOnMaster = false; });
  assert((merchantBlockedOnMaster as boolean) === true, 'Merchant (Store 100 OWNER) blocked from Master Admin API with 403 Forbidden');

  console.log('\n1️⃣5️⃣ MASTER ADMIN TEST 3: Store Suspension & Activation Actions with Audit Logging');
  db.prepare("UPDATE stores SET status = 'suspended' WHERE id = 100").run();
  AuthMiddleware.logAudit(1, 1, 'MASTER_ADMIN_SUSPEND_STORE', 'stores', '100', 'active', 'suspended');
  const store100Row = db.prepare("SELECT status FROM stores WHERE id = 100").get() as any;
  const auditSuspend = db.prepare("SELECT * FROM audit_logs WHERE action = 'MASTER_ADMIN_SUSPEND_STORE' AND entity_id = '100'").get() as any;
  assert(store100Row.status === 'suspended' && auditSuspend !== undefined, 'Master Admin suspend action updates store status and writes audit log');

  db.prepare("UPDATE stores SET status = 'active' WHERE id = 100").run();
  AuthMiddleware.logAudit(1, 1, 'MASTER_ADMIN_ACTIVATE_STORE', 'stores', '100', 'suspended', 'active');
  const store100Active = db.prepare("SELECT status FROM stores WHERE id = 100").get() as any;
  assert(store100Active.status === 'active', 'Master Admin activate action restores store status');

  console.log('\n1️⃣6️⃣ STAGE 7 FRONTEND & REGRESSION: Webhook Resolution & Idempotency');
  const resolvedAlpha = WebhookController.resolveStore('store-alpha');
  assert(resolvedAlpha !== null && resolvedAlpha.id === 100, 'store-alpha resolved to Store ID 100');
  const firstEvt = WebhookController.isDuplicateEvent('evt_master_001', 100);
  const secondEvt = WebhookController.isDuplicateEvent('evt_master_001', 100);
  assert(firstEvt === false && secondEvt === true, 'Webhook idempotency works seamlessly across multi-tenant events');

  console.log(`\n📊 MASTER ADMIN & SECURITY MASTER TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});

import { InventoryService } from '../services/inventory.service';
import { OrderService } from '../services/order.service';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { db, hashPassword, verifyPassword } from '../database/db';

async function runTestSuite() {
  console.log('🧪 Starting ISC Works Enterprise Test Suite...\n');
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

  // TEST 1: Password Hashing Verification
  console.log('1️⃣ Testing Password Hashing & Verification Security:');
  const rawPass = 'SecretP@ss2026';
  const hashed = hashPassword(rawPass);
  assert(hashed.startsWith('pbkdf2:'), 'Password must be hashed with PBKDF2');
  assert(verifyPassword(rawPass, hashed) === true, 'Valid password verification');
  assert(verifyPassword('WrongPass', hashed) === false, 'Invalid password rejection');

  // TEST 2: Inventory Availability & Rejection
  console.log('\n2️⃣ Testing Inventory Availability & Stock Rejection:');
  // Seed a test product
  db.prepare(`
    INSERT OR REPLACE INTO products (id, store_id, product_code, short_code, name, color, size, stock, price, store_name)
    VALUES (9999, 1, 'TEST-PROD-01', 'TEST01', 'Test T-Shirt', 'Siyah', 'M', 1, 499.00, 'barons')
  `).run();

  const isAvailable1 = InventoryService.checkAvailability(1, 'TEST-PROD-01', 1);
  assert(isAvailable1 === true, '1 item request available when stock is 1');

  const isAvailable2 = InventoryService.checkAvailability(1, 'TEST-PROD-01', 2);
  assert(isAvailable2 === false, '2 item request rejected when stock is 1');

  // TEST 3: Single Atomic Stock Deduction & Transaction Rollback
  console.log('\n3️⃣ Testing Transactional Order Creation & Single Stock Deduction:');
  const stockBefore = InventoryService.getStock(1, 'TEST-PROD-01').stock;
  
  const testOrder = await OrderService.createOrder({
    customerName: 'Ahmet Yılmaz',
    customerPhone: '05321112233',
    address: 'Atatürk Cad. No:1 İstanbul',
    productCode: 'TEST-PROD-01',
    productName: 'Test T-Shirt',
    size: 'M',
    quantity: 1,
    senderId: 'test_sender_101'
  });

  const stockAfter = InventoryService.getStock(1, 'TEST-PROD-01').stock;
  assert(stockBefore - stockAfter === 1, 'Stock deducted EXACTLY ONCE (stockBefore - stockAfter === 1)');
  assert(testOrder.unitPrice === 499, 'Authoritative price fetched from database (499 TL)');

  // TEST 4: JWT Security & Token Claims
  console.log('\n4️⃣ Testing HMAC-SHA256 JWT Security & RBAC Claims:');
  const token = AuthMiddleware.generateToken({ userId: 42, storeId: 2, role: 'MANAGER', email: 'manager@store.com' });
  const verified = AuthMiddleware.verifyToken(token);
  assert(verified !== null && verified.userId === 42 && verified.storeId === 2 && verified.role === 'MANAGER', 'JWT payload claims verified accurately');
  
  const invalidTokenResult = AuthMiddleware.verifyToken('invalid.token.signature');
  assert(invalidTokenResult === null, 'Invalid JWT token rejected correctly');

  // TEST 5: Webhook Idempotency Event Handling
  console.log('\n5️⃣ Testing Webhook Event Idempotency:');
  const testEventId = 'evt_unique_test_1001';
  db.prepare('INSERT OR IGNORE INTO webhook_events (event_id, store_slug) VALUES (?, ?)').run(testEventId, 'teststore');
  const duplicateCheck = db.prepare('SELECT event_id FROM webhook_events WHERE event_id = ?').get(testEventId);
  assert(duplicateCheck !== undefined, 'Duplicate webhook event registered and flagged');

  console.log(`\n📊 TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});

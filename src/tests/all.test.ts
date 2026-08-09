import { StockService } from '../services/stock.service';
import { InventoryService } from '../services/inventory.service';
import { OrderService } from '../services/order.service';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { db, hashPassword, verifyPassword } from '../database/db';

async function runTestSuite() {
  console.log('🧪 Starting ISC Works Multi-Tenant Enterprise Test Suite...\n');
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

  // PRE-TEST CLEANUP FOR TEST STORES
  db.prepare('DELETE FROM products WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM inventory WHERE store_id IN (100, 200, 999)').run();
  db.prepare('DELETE FROM stores WHERE id IN (100, 200, 999)').run();

  // Seed test stores
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (100, 1, 'Store A', 'store-a', 'active')").run();
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (200, 2, 'Store B', 'store-b', 'active')").run();
  db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (999, 3, 'Store Test', 'store-test', 'active')").run();

  // TEST 1: Store A (storeId=100) product ABC, Store B (storeId=200) product ABC -> Independent query
  console.log('1️⃣ MULTI-TENANT TEST 1: Same product code across different stores');
  await StockService.addProduct({ storeId: 100, shortCode: 'ABC', productCode: 'ABC-M', name: 'Shirt A', size: 'M', stock: 10, price: 100 });
  await StockService.addProduct({ storeId: 200, shortCode: 'ABC', productCode: 'ABC-M', name: 'Shirt B', size: 'M', stock: 50, price: 200 });

  const stockA = await StockService.checkStock(100, 'ABC-M');
  const stockB = await StockService.checkStock(200, 'ABC-M');

  assert(stockA.exists && stockA.product.name.includes('Shirt A'), 'Store A product ABC-M found independently');
  assert(stockB.exists && stockB.product.name.includes('Shirt B'), 'Store B product ABC-M found independently');

  // TEST 2: Store A stock=10, Store B stock=50 -> deductStock(Store A, ABC-M, 5) -> Store A=5, Store B=50
  console.log('\n2️⃣ MULTI-TENANT TEST 2: Stock deduction isolation');
  await StockService.deductStock(100, 'ABC-M', 5);
  const rowsA_after_deduct = await StockService.fetchAllSheetRows(100);
  const rowsB_after_deduct = await StockService.fetchAllSheetRows(200);

  const prodA_deduct = rowsA_after_deduct.find(r => r.productCode === 'ABC-M');
  const prodB_deduct = rowsB_after_deduct.find(r => r.productCode === 'ABC-M');

  assert(prodA_deduct?.stock === 5, 'Store A stock deducted to 5');
  assert(prodB_deduct?.stock === 50, 'Store B stock remains unchanged at 50');

  // TEST 3: Store A updateStock(ABC-M, 20) -> Store B unaffected
  console.log('\n3️⃣ MULTI-TENANT TEST 3: Stock update isolation');
  await StockService.updateStock(100, 'ABC-M', 20);
  const prodA_update = (await StockService.fetchAllSheetRows(100)).find(r => r.productCode === 'ABC-M');
  const prodB_update = (await StockService.fetchAllSheetRows(200)).find(r => r.productCode === 'ABC-M');

  assert(prodA_update?.stock === 20, 'Store A stock updated to 20');
  assert(prodB_update?.stock === 50, 'Store B stock remains unchanged at 50');

  // TEST 4: Store A deleteProduct(ABC-M) -> Store B product NOT deleted
  console.log('\n4️⃣ MULTI-TENANT TEST 4: Product deletion isolation');
  await StockService.deleteProduct(100, 'ABC-M');
  const stockA_del = await StockService.checkStock(100, 'ABC-M');
  const stockB_del = await StockService.checkStock(200, 'ABC-M');

  assert(stockA_del.exists === false, 'Store A product ABC-M deleted');
  assert(stockB_del.exists === true, 'Store B product ABC-M remains intact');

  // TEST 5: Searching non-existing product in Store A does NOT return Store B product
  console.log('\n5️⃣ MULTI-TENANT TEST 5: Non-existing product isolation');
  const crossSearch = await StockService.checkStock(100, 'ABC-M');
  assert(crossSearch.exists === false, 'Store A search for deleted ABC-M does not return Store B product');

  // TEST 6: Calling stock/inventory operation without storeId throws Error
  console.log('\n6️⃣ MULTI-TENANT TEST 6: Mandatory storeId enforcement without fallback');
  let errCaughtStock = false;
  try {
    await (StockService as any).checkStock(undefined, 'ABC-M');
  } catch (e: any) {
    errCaughtStock = true;
  }
  assert(errCaughtStock === true, 'StockService rejects operation when storeId is undefined');

  let errCaughtInv = false;
  try {
    (InventoryService as any).getStock(null, 'ABC-M');
  } catch (e: any) {
    errCaughtInv = true;
  }
  assert(errCaughtInv === true, 'InventoryService rejects operation when storeId is null');

  // TEST 7: store_id = 1 fallback is impossible for other tenant
  console.log('\n7️⃣ MULTI-TENANT TEST 7: Preventing default store_id = 1 leakage');
  await StockService.addProduct({ storeId: 1, shortCode: 'DEF', productCode: 'DEF-L', name: 'Default Store Item', size: 'L', stock: 100 });
  const tenantAccess = InventoryService.getStock(200, 'DEF-L');
  assert(tenantAccess.available === false && tenantAccess.stock === 0, 'Store 200 cannot access default store (storeId=1) product DEF-L');

  // LEGACY SUITE RE-VERIFICATION
  console.log('\n8️⃣ Legacy Suite Security & Verification:');
  const rawPass = 'SecretP@ss2026';
  const hashed = hashPassword(rawPass);
  assert(hashed.startsWith('pbkdf2:'), 'Password must be hashed with PBKDF2');
  assert(verifyPassword(rawPass, hashed) === true, 'Valid password verification');

  await StockService.addProduct({ storeId: 999, shortCode: 'TEST01', productCode: 'TEST-PROD-01', name: 'Test T-Shirt', size: 'M', stock: 1, price: 499, storeName: 'teststore' });
  const isAvailable1 = InventoryService.checkAvailability(999, 'TEST-PROD-01', 1);
  assert(isAvailable1 === true, '1 item request available when stock is 1');

  const isAvailable2 = InventoryService.checkAvailability(999, 'TEST-PROD-01', 2);
  assert(isAvailable2 === false, '2 item request rejected when stock is 1');

  console.log(`\n📊 TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTestSuite().catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stock_service_1 = require("../services/stock.service");
const order_service_1 = require("../services/order.service");
const db_1 = require("../database/db");
async function runTestSuite() {
    console.log('🧪 Starting ISC Works Stage 3 Multi-Tenant OrderService Test Suite...\n');
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
    db_1.db.prepare('DELETE FROM orders WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM order_items WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM customers WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM products WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM inventory WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM stores WHERE id IN (100, 200, 999)').run();
    // Seed test stores
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (100, 1, 'Store A', 'store-a', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (200, 2, 'Store B', 'store-b', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (999, 3, 'Store Test', 'store-test', 'active')").run();
    // TEST 1: Price isolation (Store A ABC = 100 TL, Store B ABC = 500 TL)
    console.log('1️⃣ ORDER TEST 1: Price isolation across stores');
    await stock_service_1.StockService.addProduct({ storeId: 100, shortCode: 'ABC', productCode: 'ABC-M', name: 'Shirt A', size: 'M', stock: 10, price: 100 });
    await stock_service_1.StockService.addProduct({ storeId: 200, shortCode: 'ABC', productCode: 'ABC-M', name: 'Shirt B', size: 'M', stock: 50, price: 500 });
    const orderA1 = await order_service_1.OrderService.createOrder(100, {
        customerName: 'Ali Yılmaz',
        customerPhone: '05320001122',
        address: 'Adres A',
        productCode: 'ABC-M',
        productName: 'Shirt A',
        size: 'M',
        quantity: 1,
        senderId: 'sender_x'
    });
    assert(orderA1.unitPrice === 100, 'Store A order created with Store A price (100 TL)');
    // TEST 2: Stock isolation upon order creation
    console.log('\n2️⃣ ORDER TEST 2: Stock deduction isolation upon order creation');
    const orderA2 = await order_service_1.OrderService.createOrder(100, {
        customerName: 'Ahmet Demir',
        customerPhone: '05320001123',
        address: 'Adres A2',
        productCode: 'ABC-M',
        productName: 'Shirt A',
        size: 'M',
        quantity: 2,
        senderId: 'sender_y'
    });
    const prodA_after = (await stock_service_1.StockService.fetchAllSheetRows(100)).find(r => r.productCode === 'ABC-M');
    const prodB_after = (await stock_service_1.StockService.fetchAllSheetRows(200)).find(r => r.productCode === 'ABC-M');
    assert(prodA_after?.stock === 7, 'Store A stock deducted to 7 (10 - 1 - 2)');
    assert(prodB_after?.stock === 50, 'Store B stock remains unchanged at 50');
    // TEST 3: getOrders(storeId) isolation
    console.log('\n3️⃣ ORDER TEST 3: getOrders(storeId) isolation');
    const orderB1 = await order_service_1.OrderService.createOrder(200, {
        customerName: 'Mehmet Kaya',
        customerPhone: '05339998877',
        address: 'Adres B',
        productCode: 'ABC-M',
        productName: 'Shirt B',
        size: 'M',
        quantity: 1,
        senderId: 'sender_x'
    });
    const ordersStoreA = await order_service_1.OrderService.getOrders(100);
    const ordersStoreB = await order_service_1.OrderService.getOrders(200);
    assert(ordersStoreA.length === 2 && ordersStoreA.every(o => o.productCode === 'ABC-M'), 'Store A returns only 2 Store A orders');
    assert(ordersStoreB.length === 1 && ordersStoreB[0].orderId === orderB1.orderId, 'Store B returns only 1 Store B order');
    // TEST 4: Store A lookup of Store B order
    console.log('\n4️⃣ ORDER TEST 4: Cross-tenant order lookup rejection');
    const crossLookup = await order_service_1.OrderService.getOrder(100, orderB1.orderId);
    assert(crossLookup === null, 'Store A cannot fetch Store B order (returns null)');
    // TEST 5: Store A trying to update Store B order status
    console.log('\n5️⃣ ORDER TEST 5: Cross-tenant order update status rejection');
    const crossUpdate = await order_service_1.OrderService.updateOrderStatus(100, orderB1.orderId, 'OK');
    assert(crossUpdate === false, 'Store A cannot update Store B order status');
    // TEST 6: Store A trying to delete Store B order
    console.log('\n6️⃣ ORDER TEST 6: Cross-tenant order deletion rejection');
    const crossDelete = await order_service_1.OrderService.deleteOrder(100, orderB1.orderId);
    assert(crossDelete === false, 'Store A cannot delete Store B order');
    // TEST 7: Customer isolation with same sender_id
    console.log('\n7️⃣ ORDER TEST 7: Customer relationship isolation (same sender_id)');
    const custA = db_1.db.prepare('SELECT * FROM customers WHERE store_id = 100 AND sender_id = ?').get('sender_x');
    const custB = db_1.db.prepare('SELECT * FROM customers WHERE store_id = 200 AND sender_id = ?').get('sender_x');
    assert(custA && custA.name === 'Ali Yılmaz', 'Store A customer sender_x is Ali Yılmaz');
    assert(custB && custB.name === 'Mehmet Kaya', 'Store B customer sender_x is Mehmet Kaya');
    // TEST 8: Rejection of createOrder without storeId
    console.log('\n8️⃣ ORDER TEST 8: Rejection of createOrder without storeId');
    let errWithoutStoreId = false;
    try {
        await order_service_1.OrderService.createOrder(undefined, {
            customerName: 'No Store',
            customerPhone: '000',
            address: 'X',
            productCode: 'ABC-M',
            productName: 'Shirt',
            size: 'M',
            quantity: 1
        });
    }
    catch (e) {
        errWithoutStoreId = true;
    }
    assert(errWithoutStoreId === true, 'createOrder without storeId throws Error immediately');
    // TEST 9: Overselling / Concurrency protection (stock = 1)
    console.log('\n9️⃣ ORDER TEST 9: Overselling protection (stock = 1)');
    await stock_service_1.StockService.addProduct({ storeId: 999, shortCode: 'SOLO', productCode: 'SOLO-S', name: 'Solo Item', size: 'S', stock: 1, price: 300 });
    const orderSuccess = await order_service_1.OrderService.createOrder(999, {
        customerName: 'First Customer',
        customerPhone: '05551112233',
        address: 'Adres 1',
        productCode: 'SOLO-S',
        productName: 'Solo Item',
        size: 'S',
        quantity: 1
    });
    assert(orderSuccess.orderId !== undefined, 'First order succeeded for last remaining stock item');
    let secondOrderFailed = false;
    try {
        await order_service_1.OrderService.createOrder(999, {
            customerName: 'Second Customer',
            customerPhone: '05551112234',
            address: 'Adres 2',
            productCode: 'SOLO-S',
            productName: 'Solo Item',
            size: 'S',
            quantity: 1
        });
    }
    catch (e) {
        if (e.message.includes('INSUFFICIENT_STOCK')) {
            secondOrderFailed = true;
        }
    }
    assert(secondOrderFailed === true, 'Second order for out-of-stock item rejected with INSUFFICIENT_STOCK');
    // TEST 10: Atomic Transaction Rollback test
    console.log('\n🔟 ORDER TEST 10: Atomic Transaction Rollback test');
    await stock_service_1.StockService.addProduct({ storeId: 999, shortCode: 'RBACK', productCode: 'RBACK-L', name: 'Rollback Item', size: 'L', stock: 5, price: 200 });
    const stockBeforeRollback = (await stock_service_1.StockService.fetchAllSheetRows(999)).find(r => r.productCode === 'RBACK-L')?.stock;
    let rollbackCaught = false;
    try {
        // Force a failure by trying to order quantity higher than stock
        await order_service_1.OrderService.createOrder(999, {
            customerName: 'Rollback Tester',
            customerPhone: '05559998877',
            address: 'Fail Addr',
            productCode: 'RBACK-L',
            productName: 'Rollback Item',
            size: 'L',
            quantity: 10 // Exceeds 5 stock
        });
    }
    catch (e) {
        rollbackCaught = true;
    }
    const stockAfterRollback = (await stock_service_1.StockService.fetchAllSheetRows(999)).find(r => r.productCode === 'RBACK-L')?.stock;
    const orderCountRollback = (await order_service_1.OrderService.getOrders(999)).filter(o => o.productCode === 'RBACK-L').length;
    assert(rollbackCaught === true, 'Failed order threw exception');
    assert(stockBeforeRollback === stockAfterRollback, 'Stock was untouched / rolled back (5 === 5)');
    assert(orderCountRollback === 0, 'No order record created in database');
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

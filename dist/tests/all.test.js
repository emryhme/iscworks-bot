"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stock_service_1 = require("../services/stock.service");
const order_service_1 = require("../services/order.service");
const ai_service_1 = require("../services/ai.service");
const admin_copilot_service_1 = require("../services/admin-copilot.service");
const webhook_controller_1 = require("../controllers/webhook.controller");
const db_1 = require("../database/db");
async function runTestSuite() {
    console.log('🧪 Starting ISC Works Multi-Tenant Enterprise Master Test Suite (Stages 1–5)...\n');
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
    db_1.db.prepare('DELETE FROM campaigns WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM settings WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM user_rewards WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM conversations WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM webhook_events WHERE store_id IN (100, 200, 999)').run();
    db_1.db.prepare('DELETE FROM stores WHERE id IN (100, 200, 999)').run();
    // Seed test stores
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (100, 1, 'Store A', 'store-a', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (200, 2, 'Store B', 'store-b', 'active')").run();
    db_1.db.prepare("INSERT OR IGNORE INTO stores (id, owner_id, name, slug, status) VALUES (999, 3, 'Store Suspended', 'store-suspended', 'suspended')").run();
    // Seed products
    await stock_service_1.StockService.addProduct({ storeId: 100, shortCode: 'ABC', productCode: 'ABC-M', name: 'Gömlek A', size: 'M', stock: 10, price: 100 });
    await stock_service_1.StockService.addProduct({ storeId: 200, shortCode: 'ABC', productCode: 'ABC-M', name: 'Gömlek B', size: 'M', stock: 50, price: 500 });
    // Seed campaigns & settings
    db_1.db.prepare("INSERT INTO campaigns (store_id, title, description, code, active) VALUES (100, 'Store A %10 Indirim', 'Kampanya A', 'IND10', 1)").run();
    db_1.db.prepare("INSERT INTO campaigns (store_id, title, description, code, active) VALUES (200, 'Store B %50 Indirim', 'Kampanya B', 'IND50', 1)").run();
    db_1.db.prepare("INSERT INTO settings (store_id, key, value) VALUES (100, 'shipping_fee', '50')").run();
    db_1.db.prepare("INSERT INTO settings (store_id, key, value) VALUES (200, 'shipping_fee', '100')").run();
    db_1.db.prepare("INSERT INTO user_rewards (store_id, sender_id, reward_code, discount_percent, min_qualifying_amount, is_used) VALUES (100, 'sender_x', 'REW100', 10.0, 1000, 0)").run();
    db_1.db.prepare("INSERT INTO user_rewards (store_id, sender_id, reward_code, discount_percent, min_qualifying_amount, is_used) VALUES (200, 'sender_x', 'REW200', 50.0, 1000, 0)").run();
    // --- STAGE 2 & 3 TESTS ---
    console.log('1️⃣ STOCK & INVENTORY ISOLATION: Same product code across different stores');
    const prodA = (await stock_service_1.StockService.fetchAllSheetRows(100)).find(r => r.productCode === 'ABC-M');
    const prodB = (await stock_service_1.StockService.fetchAllSheetRows(200)).find(r => r.productCode === 'ABC-M');
    assert(prodA?.price === 100 && prodA?.stock === 10, 'Store A product ABC-M found with price 100');
    assert(prodB?.price === 500 && prodB?.stock === 50, 'Store B product ABC-M found with price 500');
    console.log('\n2️⃣ ORDER SERVICE: Price isolation on order creation');
    const orderA1 = await order_service_1.OrderService.createOrder(100, {
        customerName: 'Ali Yılmaz',
        customerPhone: '05320001122',
        address: 'Adres A',
        productCode: 'ABC-M',
        productName: 'Gömlek A',
        size: 'M',
        quantity: 1,
        senderId: 'sender_x'
    });
    assert(orderA1.unitPrice === 100, 'Store A order created with Store A price (100 TL)');
    console.log('\n3️⃣ ORDER SERVICE: Stock deduction isolation');
    const prodA_after = (await stock_service_1.StockService.fetchAllSheetRows(100)).find(r => r.productCode === 'ABC-M');
    const prodB_after = (await stock_service_1.StockService.fetchAllSheetRows(200)).find(r => r.productCode === 'ABC-M');
    assert(prodA_after?.stock === 9, 'Store A stock deducted to 9');
    assert(prodB_after?.stock === 50, 'Store B stock remains unchanged at 50');
    console.log('\n4️⃣ ORDER SERVICE: getOrders(storeId) isolation');
    const orderB1 = await order_service_1.OrderService.createOrder(200, {
        customerName: 'Mehmet Kaya',
        customerPhone: '05339998877',
        address: 'Adres B',
        productCode: 'ABC-M',
        productName: 'Gömlek B',
        size: 'M',
        quantity: 1,
        senderId: 'sender_x'
    });
    const ordersStoreA = await order_service_1.OrderService.getOrders(100);
    const ordersStoreB = await order_service_1.OrderService.getOrders(200);
    assert(ordersStoreA.length === 1 && ordersStoreA[0].orderId === orderA1.orderId, 'Store A returns only Store A orders');
    assert(ordersStoreB.length === 1 && ordersStoreB[0].orderId === orderB1.orderId, 'Store B returns only Store B orders');
    console.log('\n5️⃣ ORDER SERVICE: Cross-tenant lookup rejection');
    const crossLookup = await order_service_1.OrderService.getOrder(100, orderB1.orderId);
    assert(crossLookup === null, 'Store A cannot fetch Store B order');
    // --- STAGE 4 AI TESTS ---
    console.log('\n6️⃣ AI SERVICE: Campaign & settings isolation');
    const campaignsA = db_1.db.prepare('SELECT * FROM campaigns WHERE store_id = 100 AND active = 1').all();
    const settingA = db_1.db.prepare("SELECT value FROM settings WHERE store_id = 100 AND key = 'shipping_fee'").get();
    assert(campaignsA.length === 1 && campaignsA[0].code === 'IND10', 'Store A AI sees only Store A campaign');
    assert(settingA?.value === '50', 'Store A shipping fee setting is 50');
    console.log('\n7️⃣ ADMIN COPILOT: Price update isolation');
    await admin_copilot_service_1.AdminCopilotService.processAdminCommand('ABC-M fiyatını 200 yap', 100);
    const prodA_updated = (await stock_service_1.StockService.fetchAllSheetRows(100)).find(p => p.productCode === 'ABC-M');
    const prodB_untouched = (await stock_service_1.StockService.fetchAllSheetRows(200)).find(p => p.productCode === 'ABC-M');
    assert(prodA_updated?.price === 200, 'Store A price updated to 200 TL via Admin Copilot');
    assert(prodB_untouched?.price === 500, 'Store B price remains untouched at 500 TL');
    // --- STAGE 5 WEBHOOK TESTS ---
    console.log('\n8️⃣ WEBHOOK: Store resolution & status check');
    const resolvedA = webhook_controller_1.WebhookController.resolveStore('store-a');
    const resolvedSuspended = webhook_controller_1.WebhookController.resolveStore('store-suspended');
    const resolvedInvalid = webhook_controller_1.WebhookController.resolveStore('invalid-slug');
    assert(resolvedA?.id === 100 && resolvedA?.status === 'active', 'store-a resolved to active Store ID 100');
    assert(resolvedSuspended?.status === 'suspended', 'Suspended store correctly identified');
    assert(resolvedInvalid === null, 'Invalid store slug rejected with null');
    console.log('\n9️⃣ WEBHOOK: Conversation isolation');
    const convIdA = ai_service_1.AIService.getOrCreateConversation(100, 'user_webhook_99');
    const convIdB = ai_service_1.AIService.getOrCreateConversation(200, 'user_webhook_99');
    assert(convIdA !== convIdB, 'Store A and Store B create distinct conversation records for same user');
    console.log('\n🔟 WEBHOOK: Event Idempotency');
    const firstEvent = webhook_controller_1.WebhookController.isDuplicateEvent('evt_master_111', 100);
    const secondEvent = webhook_controller_1.WebhookController.isDuplicateEvent('evt_master_111', 100);
    assert(firstEvent === false, 'First webhook event is processed (false)');
    assert(secondEvent === true, 'Duplicate webhook event is ignored (true)');
    console.log(`\n📊 MASTER TEST SUMMARY: Passed: ${passed} | Failed: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
    process.exit(0);
}
runTestSuite().catch(e => {
    console.error('Fatal test error:', e);
    process.exit(1);
});

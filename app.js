const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
require('dotenv').config();

const app = express();

// Controllers
const UserController = require('./controllers/UserController');
const ProductController = require('./controllers/ProductController');
const AdminController = require('./controllers/AdminController');
const { checkAuthenticated, checkAdmin, validateRegistration } = require('./middleware/auth');
const Product = require('./models/Product');

// Payment Services
const paypal = require('./services/paypal');
const NETS = require('./services/nets-api');
const stripe = require('./services/stripe');
const airwallex = require('./services/airwallex');

const NETS_API_KEY = process.env.API_KEY;
const NETS_PROJECT_ID = process.env.PROJECT_ID;
const BASE_URL =
  process.env.NETS_BASE_URL || 'https://sandbox.nets.openapipaas.com';

// ===== Multer =====
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ===== View Engine =====
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ===== Session =====
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

app.use(flash());
app.use((req, res, next) => {
    res.locals.flash = req.flash();
    next();
});

// User middleware
app.use((req, res, next) => {
    if (req.session.user) {
      const paymentReference = session.payment_intent || session.id;
      const userId = req.session.user.id;
        Product.getCart(userId, (err, cart) => {
            req.session.user.cartCount = cart ? cart.length : 0;
            res.locals.user = req.session.user;
            next();
        });
    } else {
        res.locals.user = null;
        next();
    }
});

// ===============================
// USER ROUTES
// ===============================
app.get('/', (req, res) => {
  Product.getAllSorted('', '', '', (err, products) => {
    if (err) {
      return res.render('index', { user: req.session.user, products: [] });
    }
    res.render('index', { user: req.session.user, products });
  });
});
app.get('/register', UserController.showRegister);
app.post('/register', validateRegistration, UserController.register);
app.get('/login', UserController.showLogin);
app.post('/login', UserController.login);
app.get('/login/verify-email', UserController.showVerifyEmail);
app.post('/login/verify-email', UserController.verifyEmail);
app.get('/login/verify-phone', UserController.showVerifyPhone);
app.post('/login/verify-phone', UserController.verifyPhone);
app.get('/logout', UserController.logout);
app.get('/faq', (req, res) => res.render('faq', { user: req.session.user }));

// ===============================
// SHOPPER ROUTES
// ===============================
app.get('/shopping', checkAuthenticated, ProductController.showShopping);
app.get('/product/:id', checkAuthenticated, ProductController.showProduct);

// CART
app.post('/add-to-cart/:id', checkAuthenticated, ProductController.addToCart);
app.get('/cart', checkAuthenticated, ProductController.showCart);
app.get('/cart/remove/:id', checkAuthenticated, ProductController.removeCartItem);
app.post('/cart/update/:id', checkAuthenticated, ProductController.updateCartItem);

// Checkout
app.get('/checkout', checkAuthenticated, ProductController.showCheckout);
app.post('/checkout', checkAuthenticated, ProductController.processCheckout);
app.get('/payment', checkAuthenticated, ProductController.showPaymentPage);
app.post('/payment/confirm', checkAuthenticated, ProductController.confirmPayment);

// ===============================
// PAYPAL ROUTES
// ===============================
app.get('/payment/paypal/redirect', checkAuthenticated, async (req, res) => {
    try {
        const amount = req.session.paymentAmount;
        if (!amount) {
            req.flash('error', 'No payment amount');
            return res.redirect('/checkout');
        }
        
        const order = await paypal.createOrder(amount.toFixed(2));
        if (order && order.links) {
            const approveLink = order.links.find(link => link.rel === 'approve');
            if (approveLink) {
                req.session.paypalOrderId = order.id;
                res.redirect(approveLink.href);
            }
        }
    } catch (err) {
        req.flash('error', 'PayPal failed');
        res.redirect('/checkout');
    }
});

app.post('/api/paypal/create-order', checkAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        const order = await paypal.createOrder(amount);
        if (order && order.links) {
            const approveLink = order.links.find(link => link.rel === 'approve');
            if (approveLink) {
                req.session.paypalOrderId = order.id;
                res.json({ success: true, approveUrl: approveLink.href });
            }
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ===============================
// STRIPE ROUTES
// ===============================
app.get('/payment/stripe/redirect', checkAuthenticated, async (req, res) => {
  try {
    const cart = req.session.paymentCart;
    const total = req.session.paymentAmount;
    if (!cart || cart.length === 0 || !total) {
      req.flash('error', 'No payment amount');
      return res.redirect('/checkout');
    }

    const orderId = `STRIPE_${Date.now()}_${req.session.user.id}`;
    const session = await stripe.createCheckoutSession(cart, total, orderId);
    req.session.stripeSessionId = session.id;
    res.redirect(session.url);
  } catch (err) {
    req.flash('error', 'Stripe failed');
    res.redirect('/checkout');
  }
});

app.get('/payment/stripe/success', checkAuthenticated, async (req, res) => {
  try {
    const sessionId = req.query.session_id || req.session.stripeSessionId;
    if (!sessionId) {
      req.flash('error', 'No Stripe session');
      return res.redirect('/checkout');
    }

      const session = await stripe.retrieveSession(sessionId);
      if (session.payment_status !== 'paid') {
        req.flash('error', 'Stripe payment not completed');
        return res.redirect('/checkout');
      }

      const paymentReference = session.payment_intent || session.id;
      const userId = req.session.user.id;
      const cart = req.session.paymentCart;
      const checkoutData = req.session.checkoutData || {};
      const total = req.session.paymentAmount;

    const items = cart.map(i => ({
      product_id: i.id,
      quantity: i.quantity,
      price: i.price
    }));

    Product.createOrder(
      userId,
      checkoutData.delivery_method || 'standard',
      checkoutData.address || '',
      'STRIPE',
      total,
      items,
      (err, dbOrderId) => {
        if (err) {
          req.flash('error', 'Order failed');
          return res.redirect('/checkout');
        }

        Product.updateOrderPayment(
          dbOrderId,
          'PAID',
          'STRIPE',
          paymentReference,
          (updateErr) => {
            if (updateErr) {
              req.flash('error', 'Payment update failed');
              return res.redirect('/checkout');
            }

            Product.clearCart(userId, () => {
              req.session.paymentCart = null;
              req.session.paymentAmount = null;
              req.session.checkoutData = null;
              req.session.voucher = null;
              req.session.stripeSessionId = null;
              res.redirect('/invoice/' + dbOrderId);
            });
          }
        );
      }
    );
  } catch (err) {
    req.flash('error', 'Stripe payment failed');
    res.redirect('/checkout');
  }
});

app.get('/payment/stripe/cancel', checkAuthenticated, (req, res) => {
  req.session.stripeSessionId = null;
  req.flash('error', 'Stripe payment cancelled');
  res.redirect('/checkout');
});

// ===============================
// AIRWALLEX ROUTES
// ===============================
app.get('/payment/airwallex/redirect', checkAuthenticated, async (req, res) => {
  try {
    const cart = req.session.paymentCart;
    const total = req.session.paymentAmount;
    if (!cart || cart.length === 0 || !total) {
      req.flash('error', 'No payment amount');
      return res.redirect('/checkout');
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const orderId = `AIRWALLEX_${Date.now()}_${req.session.user.id}`;
    const intent = await airwallex.createPaymentIntent({
      amount: total,
      currency: process.env.AIRWALLEX_CURRENCY || 'SGD',
      merchantOrderId: orderId,
      returnUrl: `${baseUrl}/payment/airwallex/success`
    });

    req.session.airwallexPaymentIntentId = intent.id;
    req.session.airwallexClientSecret = intent.client_secret;

    res.render('payment/airwallex-redirect', {
      user: req.session.user,
      intentId: intent.id,
      clientSecret: intent.client_secret,
      currency: process.env.AIRWALLEX_CURRENCY || 'SGD',
      countryCode: process.env.AIRWALLEX_COUNTRY || 'SG',
      airwallexEnv: process.env.AIRWALLEX_ENV || 'demo',
      successUrl: `${baseUrl}/payment/airwallex/success`,
      failUrl: `${baseUrl}/payment/airwallex/cancel`
    });
  } catch (err) {
    req.flash('error', 'Airwallex failed');
    res.redirect('/checkout');
  }
});

app.get('/payment/airwallex/success', checkAuthenticated, async (req, res) => {
  try {
    const intentId =
      req.query.intent_id ||
      req.query.intentId ||
      req.query.payment_intent_id ||
      req.query.id ||
      req.session.airwallexPaymentIntentId;

    if (!intentId) {
      req.flash('error', 'No Airwallex payment intent');
      return res.redirect('/checkout');
    }

    const intent = await airwallex.retrievePaymentIntent(intentId);
    const status = (intent.status || '').toUpperCase();
    if (status !== 'SUCCEEDED' && status !== 'AUTHORIZED') {
      req.flash('error', 'Airwallex payment not completed');
      return res.redirect('/checkout');
    }

    const paymentReference =
      intent.latest_payment_attempt?.id || intent.id || intentId;
    const userId = req.session.user.id;
    const cart = req.session.paymentCart;
    const checkoutData = req.session.checkoutData || {};
    const total = req.session.paymentAmount;

    const items = cart.map(i => ({
      product_id: i.id,
      quantity: i.quantity,
      price: i.price
    }));

    Product.createOrder(
      userId,
      checkoutData.delivery_method || 'standard',
      checkoutData.address || '',
      'AIRWALLEX',
      total,
      items,
      (err, dbOrderId) => {
        if (err) {
          req.flash('error', 'Order failed');
          return res.redirect('/checkout');
        }

        Product.updateOrderPayment(
          dbOrderId,
          'PAID',
          'AIRWALLEX',
          paymentReference,
          (updateErr) => {
            if (updateErr) {
              req.flash('error', 'Payment update failed');
              return res.redirect('/checkout');
            }

            Product.clearCart(userId, () => {
              req.session.paymentCart = null;
              req.session.paymentAmount = null;
              req.session.checkoutData = null;
              req.session.voucher = null;
              req.session.airwallexPaymentIntentId = null;
              req.session.airwallexClientSecret = null;
              res.redirect('/invoice/' + dbOrderId);
            });
          }
        );
      }
    );
  } catch (err) {
    req.flash('error', 'Airwallex payment failed');
    res.redirect('/checkout');
  }
});

app.get('/payment/airwallex/cancel', checkAuthenticated, (req, res) => {
  req.session.airwallexPaymentIntentId = null;
  req.session.airwallexClientSecret = null;
  req.flash('error', 'Airwallex payment cancelled');
  res.redirect('/checkout');
});

app.get('/payment/paypal/success', checkAuthenticated, async (req, res) => {
    try {
        const { token } = req.query;
        const orderId = token || req.session.paypalOrderId;
        if (!orderId) {
            req.flash('error', 'No order ID');
            return res.redirect('/checkout');
        }
        
        const capture = await paypal.captureOrder(orderId);
        if (capture.status === "COMPLETED") {
            const paymentReference = capture.id || orderId;
            const userId = req.session.user.id;
            const cart = req.session.paymentCart;
            const checkoutData = req.session.checkoutData || {};
            const total = req.session.paymentAmount;
            
            const items = cart.map(i => ({
                product_id: i.id,
                quantity: i.quantity,
                price: i.price
            }));
            
            Product.createOrder(
                userId,
                checkoutData.delivery_method || 'standard',
                checkoutData.address || '',
                'PAYPAL',
                total,
                items,
                (err, dbOrderId) => {
                    if (err) {
                        req.flash('error', 'Order failed');
                        return res.redirect('/checkout');
                    }
                    
                    Product.updateOrderPayment(
                        dbOrderId,
                        'PAID',
                        'PAYPAL',
                        paymentReference,
                        (updateErr) => {
                            if (updateErr) {
                                req.flash('error', 'Payment update failed');
                                return res.redirect('/checkout');
                            }

                            Product.clearCart(userId, () => {
                                req.session.paymentCart = null;
                                req.session.paymentAmount = null;
                                req.session.checkoutData = null;
                                req.session.voucher = null;
                                req.session.paypalOrderId = null;
                                res.redirect('/invoice/' + dbOrderId);
                            });
                        }
                    );
                }
            );
        }
    } catch (err) {
        req.flash('error', 'Payment failed');
        res.redirect('/checkout');
    }
});

app.get('/payment/paypal/cancel', checkAuthenticated, (req, res) => {
    req.session.paypalOrderId = null;
    req.flash('error', 'Payment cancelled');
    res.redirect('/checkout');
});

// ===============================
// NETS OPENAPI ROUTES - COMPLETE FIX
// ===============================

// NETS QR支付页面 - 主要入口点
app.get('/payment/nets/qr', checkAuthenticated, async (req, res) => {
  try {
    console.log('🚀 NETS QR Payment Page Accessed');
    
    // 获取支付数据
    const amount = req.session.paymentAmount;
    const cart = req.session.paymentCart;
    const userId = req.session.user?.id;
    const checkoutData = req.session.checkoutData || {};
    
    console.log('📊 Payment Data:', {
      amount: amount,
      cartItems: cart?.length || 0,
      userId: userId,
      paymentMethod: checkoutData.payment_method
    });
    
    // 验证数据
    if (!amount || !cart || cart.length === 0 || !userId) {
      console.log('❌ Invalid payment data');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Error</title></head>
        <body>
          <h1>Payment Error</h1>
          <p>Invalid payment data. Please go back to checkout.</p>
          <a href="/checkout">Back to Checkout</a>
        </body>
        </html>
      `);
    }
    
    // 生成唯一订单ID
    const timestamp = Date.now();
    const orderId = `NETS_${timestamp}_${userId}`;
    const customerId = `CUST_${userId}`;
    
    console.log('🆔 Generated IDs:', { orderId, customerId });
    
    // 保存支付数据到session
    req.session.netsPaymentData = {
      amount: amount,
      orderId: orderId,
      customerId: customerId,
      cart: cart,
      checkoutData: checkoutData,
      timestamp: timestamp
    };
    
    console.log('📡 Calling NETS API to create payment...');
    
    // 调用NETS API创建支付
    const result = await NETS.createPayment(amount, orderId, customerId);
    
    console.log('🎯 NETS API Result:', {
      success: result.success,
      paymentId: result.paymentId,
      hasQR: !!result.qrCode
    });
    
    if (result.success) {
      // 保存支付ID
      req.session.netsPaymentId = result.paymentId;
      req.session.netsOrderId = orderId;
      
      console.log('✅ Payment created successfully!');
      
      // 渲染QR页面
      res.render('payment', {
        user: req.session.user,
        amount: parseFloat(amount), // Convert to number here
        orderId: orderId,
        paymentId: result.paymentId,
        qrCode: result.qrCode,
        qrImage: result.qrImage,
        // ...other properties
    });
      
    } else {
      console.error('❌ NETS API Failed:', result.error);
      
      // 显示API错误详情
      res.render('payment/nets-error', {
        user: req.session.user,
        error: result.error || 'NETS API failed',
        statusCode: result.statusCode,
        responseData: JSON.stringify(result.responseData, null, 2),
        config: JSON.stringify(result.config, null, 2),
        amount: amount,
        orderId: orderId
      });
    }
    
  } catch (error) {
    console.error('💥 NETS Route Error:', error);
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>System Error</title></head>
      <body>
        <h1>System Error</h1>
        <p><strong>Error:</strong> ${error.message}</p>
        <pre>${error.stack}</pre>
        <a href="/checkout">Back to Checkout</a>
      </body>
      </html>
    `);
  }
});

// NETS支付状态检查（用于前端轮询）
app.get('/payment/nets/status/:paymentId', checkAuthenticated, async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    console.log('🔄 Checking payment status:', paymentId);
    
    if (!paymentId || paymentId === 'undefined') {
      return res.json({
        success: false,
        error: 'Invalid payment ID',
        status: 'INVALID'
      });
    }
    
    // 调用NETS API检查状态
    const status = await NETS.checkStatus(paymentId);
    
    console.log('📊 Status Result:', {
      success: status.success,
      status: status.status
    });
    
    res.json(status);
    
  } catch (error) {
    console.error('❌ Status check error:', error);
    res.json({
      success: false,
      error: error.message,
      status: 'ERROR'
    });
  }
});

// NETS支付成功回调
app.get('/payment/nets/success', checkAuthenticated, async (req, res) => {
  try {
    const paymentId = req.query.payment_id || req.query.id || req.session.netsPaymentId;
    const userId = req.session.user.id;
    
    console.log('🎉 NETS Success Callback:', { paymentId, userId });
    
    if (!paymentId) {
      console.log('❌ No payment ID in callback');
      return res.redirect('/payment/nets/failed?error=No+payment+ID+found');
    }
    
    // 检查支付状态
    const status = await NETS.checkStatus(paymentId);
    
    console.log('🔍 Payment Status Check:', {
      success: status.success,
      status: status.status
    });
    
    if (status.success && (status.status === 'SUCCESS' || status.status === 'COMPLETED' || status.status === 'AUTHORIZED')) {
      // 支付成功，创建订单
      const paymentData = req.session.netsPaymentData || {
        amount: req.session.paymentAmount || 0,
        cart: req.session.paymentCart || [],
        checkoutData: req.session.checkoutData || {}
      };
      
      const items = paymentData.cart.map(item => ({
        product_id: item.id,
        quantity: item.quantity,
        price: item.price
      }));
      
      Product.createOrder(
        userId,
        paymentData.checkoutData.delivery_method || 'standard',
        paymentData.checkoutData.address || '',
        'NETS_QR',
        paymentData.amount,
        items,
        (err, dbOrderId) => {
          if (err) {
            console.error('❌ Order creation failed:', err);
            return res.redirect('/payment/nets/failed?error=Order+creation+failed');
          }
          
          console.log('✅ Order created:', dbOrderId);
          
          // 清空购物车
                    Product.updateOrderPayment(
            dbOrderId,
            'PAID',
            'NETS_QR',
            paymentId,
            (updateErr) => {
              if (updateErr) {
                console.error('??? Payment update failed:', updateErr);
                return res.redirect('/payment/nets/failed?error=Payment+update+failed');
              }

              // ???????????????
              Product.clearCart(userId, () => {
                // ??????session
                req.session.paymentCart = null;
                req.session.paymentAmount = null;
                req.session.checkoutData = null;
                req.session.voucher = null;
                req.session.netsPaymentId = null;
                req.session.netsOrderId = null;
                req.session.netsPaymentData = null;
                
                console.log('??? Redirecting to invoice:', dbOrderId);
                res.redirect('/invoice/' + dbOrderId);
              });
            }
          );
        }
      );
    } else {
      console.log('❌ Payment not successful:', status.status);
      res.redirect('/payment/nets/failed?error=Payment+status:' + (status.status || 'failed'));
    }
    
  } catch (error) {
    console.error('❌ Success callback error:', error);
    res.redirect('/payment/nets/failed?error=' + encodeURIComponent(error.message));
  }
});

// NETS支付失败页面
app.get('/payment/nets/failed', checkAuthenticated, (req, res) => {
  const error = req.query.error || 'Payment failed';
  const paymentId = req.session.netsPaymentId || 'N/A';
  const orderId = req.session.netsOrderId || 'N/A';
  const amount = req.session.paymentAmount || 0;
  
  res.render('payment/nets-fail', {
    user: req.session.user,
    error: error,
    paymentId: paymentId,
    orderId: orderId,
    amount: amount.toFixed(2)
  });
});

// NETS支付取消页面
app.get('/payment/nets/cancel', checkAuthenticated, (req, res) => {
  req.flash('info', 'NETS payment was cancelled');
  res.redirect('/checkout');
});

// NETS Webhook端点（NETS服务器回调）
app.post('/payment/nets/webhook', express.json(), async (req, res) => {
  try {
    const webhookData = req.body;
    console.log('🌐 NETS Webhook Received:', JSON.stringify(webhookData, null, 2));
    
    // 验证签名（在实际应用中需要实现）
    
    // 处理webhook事件
    const eventType = webhookData.event || webhookData.type;
    const paymentId =
      webhookData.paymentId ||
      webhookData.data?.id ||
      webhookData.data?.txn_retrieval_ref ||
      webhookData.txn_retrieval_ref;
    
    console.log(`dY"" Webhook Event: ${eventType} for Payment: ${paymentId}`);
    
    let normalizedStatus = null;
    
    switch (eventType) {
      case 'payment.completed':
      case 'payment.succeeded':
        normalizedStatus = 'COMPLETED';
        console.log(`Payment ${paymentId} completed via webhook`);
        break;
      case 'payment.failed':
      case 'payment.declined':
        normalizedStatus = 'FAILED';
        console.log(`Payment ${paymentId} failed via webhook`);
        break;
      default:
        break;
    }
    
    if (!normalizedStatus) {
      const txnStatus = webhookData.txn_status ?? webhookData.data?.txn_status;
      const rawStatus = webhookData.status || webhookData.data?.status;
    
      if (typeof txnStatus === 'number') {
        normalizedStatus = txnStatus === 1 ? 'COMPLETED' : 'FAILED';
      } else if (typeof rawStatus === 'string') {
        normalizedStatus = rawStatus.toUpperCase();
      }
    }
    
    if (paymentId && normalizedStatus) {
      NETS.recordStatus(paymentId, normalizedStatus, webhookData);
    }
    res.status(200).json({ received: true, timestamp: new Date().toISOString() });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 测试NETS API连接
app.get('/nets-api-test', checkAuthenticated, async (req, res) => {
  try {
    const testAmount = 1.00;
    const testOrderId = `TEST_${Date.now()}`;
    const testCustomerId = `TEST_CUST_${req.session.user.id}`;
    
    console.log('🧪 Testing NETS API connection...');
    
    const result = await NETS.createPayment(testAmount, testOrderId, testCustomerId);
    
    res.json({
      test: 'NETS API Connection Test',
      timestamp: new Date().toISOString(),
      config: {
        apiKey: NETS_API_KEY ? 'Present' : 'Missing',
        projectId: NETS_PROJECT_ID ? 'Present' : 'Missing',
        baseURL: BASE_URL
      },
      request: {
        amount: testAmount,
        orderId: testOrderId,
        customerId: testCustomerId
      },
      result: result
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
});

// 快速测试路由
app.get('/test-nets', checkAuthenticated, (req, res) => {
  // 设置测试数据
  req.session.paymentAmount = 1.00;
  req.session.paymentCart = [{
    id: 1,
    name: 'Test Product',
    quantity: 1,
    price: 1.00
  }];
  req.session.checkoutData = {
    delivery_method: 'standard',
    address: 'Test Address',
    payment_method: 'NETS_QR'
  };
  
  console.log('🔧 Test route - redirecting to NETS QR');
  res.redirect('/payment/nets/qr');
});

// ===============================
// INVOICE & ORDERS
// ===============================
app.get('/invoice/:id', checkAuthenticated, ProductController.showInvoice);
app.get('/orders', checkAuthenticated, ProductController.showOrderHistory);
app.get('/reorder/:id', checkAuthenticated, ProductController.reorder);

// ===============================
// REVIEWS
// ===============================
app.get('/review/:productId', checkAuthenticated, ProductController.showReviewPage);
app.post('/review/:productId', checkAuthenticated, ProductController.submitReview);

// ===============================
// ADMIN ROUTES
// ===============================
app.get('/admin', checkAuthenticated, checkAdmin, AdminController.showDashboard);
app.get('/admin/inventory', checkAuthenticated, checkAdmin, AdminController.showInventory);
app.get('/admin/add-product', checkAuthenticated, checkAdmin, AdminController.showAddProduct);
app.post('/admin/add-product', checkAuthenticated, checkAdmin, upload.single('image'), AdminController.addProduct);
app.get('/admin/update-product/:id', checkAuthenticated, checkAdmin, AdminController.showUpdateProduct);
app.post('/admin/update-product/:id', checkAuthenticated, checkAdmin, upload.single('image'), AdminController.updateProduct);
app.get('/admin/orders', checkAuthenticated, checkAdmin, AdminController.showOrders);
app.post('/admin/orders/:id/status', checkAuthenticated, checkAdmin, AdminController.updateOrderStatus);
app.get('/admin/reviews', checkAuthenticated, checkAdmin, AdminController.showReviews);
app.post('/admin/reviews/:id/delete', checkAuthenticated, checkAdmin, AdminController.deleteReview);
app.get('/admin/users', checkAuthenticated, checkAdmin, AdminController.showUsers);
app.post('/admin/users/:id/role', checkAuthenticated, checkAdmin, AdminController.changeRole);
app.post('/admin/users/:id/active', checkAuthenticated, checkAdmin, AdminController.toggleUserActive);

// VOUCHERS
app.get('/admin/vouchers', checkAuthenticated, checkAdmin, AdminController.showVouchers);
app.get('/admin/vouchers/add', checkAuthenticated, checkAdmin, AdminController.showAddVoucher);
app.post('/admin/vouchers/add', checkAuthenticated, checkAdmin, AdminController.addVoucher);
app.get('/admin/vouchers/edit/:id', checkAuthenticated, checkAdmin, AdminController.showEditVoucher);
app.post('/admin/vouchers/edit/:id', checkAuthenticated, checkAdmin, AdminController.editVoucher);
app.get('/admin/vouchers/delete/:id', checkAuthenticated, checkAdmin, AdminController.deleteVoucher);

app.post('/apply-voucher', ProductController.applyVoucher);
app.get('/remove-voucher', ProductController.removeVoucher);

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    res.redirect('/admin/inventory');
});

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const Product = require('../models/Product');
const Voucher = require('../models/voucher');

const ProductController = {

  showShopping: function (req, res) {
    const search = req.query.search || "";
    const category = req.query.category || "";
    const sort = req.query.sort || "";

    Product.getAllSorted(search, category, sort, (err, products) => {
      if (err) return res.status(500).send("Error loading shopping");

      Voucher.getActive((err2, vouchers) => {
        if (err2) return res.status(500).send(err2);
        res.render("shopping", {
          products,
          vouchers,
          search,
          category,
          sort,
          user: req.session.user
        });
      });
    });
  },

  showProduct: function (req, res) {
    const id = req.params.id;
    Product.getById(id, (err, product) => {
      if (!product) return res.status(404).send("Product not found");

      Product.getReviews(id, (err2, reviews) => {
        Product.getRatingSummary(id, (err3, summary) => {
          Product.hasBoughtProduct(req.session.user.id, id, (err4, bought) => {
            const avg = summary && summary.avgRating ? Number(summary.avgRating) : 0;
            const count = summary && summary.reviewCount ? Number(summary.reviewCount) : 0;

            res.render("product", {
              product,
              reviews,
              user: req.session.user,
              avgRating: avg,
              reviewCount: count,
              canReview: bought
            });
          });
        });
      });
    });
  },

  addToCart: function (req, res) {
    const userId = req.session.user.id;
    const productId = req.params.id;
    const qtyRequested = parseInt(req.body.quantity) || 1;

    Product.getById(productId, (err, product) => {
      if (!product) return res.send("Product not found.");

      const stock = parseInt(product.quantity);

      if (stock <= 0) {
        req.session.message = `${product.productName} is SOLD OUT`;
        return res.redirect("/shopping");
      }

      if (qtyRequested > stock) {
        req.session.message = `Only ${stock} left in stock. Reduce your quantity.`;
        req.flash('error', `Only ${stock} left in stock.`);
        return res.redirect("/shopping");
      }

      Product.addToCart(userId, productId, qtyRequested, () => {
        req.flash('success', 'Item added to cart.');
        res.redirect("/cart");
      });
    });
  },

  showCart: function (req, res) {
    Product.getCart(req.session.user.id, (err, cart) => {
      res.render("cart", {
        cart,
        user: req.session.user
      });
    });
  },

  removeCartItem: function (req, res) {
    Product.removeFromCart(req.params.id, () => {
      req.flash('info', 'Item removed from cart.');
      res.redirect("/cart");
    });
  },

  updateCartItem: function (req, res) {
    const cartItemId = req.params.id;
    const qtyRequested = parseInt(req.body.quantity);

    Product.getCart(req.session.user.id, (err, cart) => {
      const item = cart.find(i => i.cart_id == cartItemId);
      if (!item) return res.redirect("/cart");

      const stock = parseInt(item.quantity_available);

      if (qtyRequested > stock) {
        req.session.message = `Only ${stock} left in stock.`;
        req.flash('error', `Only ${stock} left in stock.`);
        return res.redirect("/cart");
      }

      Product.updateCartQuantity(cartItemId, qtyRequested, () => {
        req.flash('success', 'Cart updated.');
        res.redirect("/cart");
      });
    });
  },

  showCheckout: function (req, res) {
    Product.getCart(req.session.user.id, (err, cart) => {
      const voucher = req.session.voucher || null;
      const message = req.session.message || "";

      req.session.message = null;

      res.render("checkout", {
        cart,
        voucher,
        message,
        user: req.session.user
      });
    });
  },

  applyVoucher: function (req, res) {
    const { voucherCode } = req.body;
    const userId = req.session.user.id;

    Product.getCart(userId, (err, cart) => {
      if (!cart || cart.length === 0) {
        req.session.message = "Cart is empty";
        return res.redirect("/checkout");
      }

      const subtotal = cart.reduce(
        (sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)),
        0
      );

      Voucher.getByCode(voucherCode, (err2, voucher) => {
        if (!voucher) {
          req.session.message = "Invalid or expired voucher";
          req.session.voucher = null;
          return res.redirect("/checkout");
        }

        const minSpend = parseFloat(voucher.minSpend) || 0;
        const amount = parseFloat(voucher.amount) || 0;

        if (subtotal < minSpend) {
          req.session.message = `Minimum spend $${minSpend.toFixed(2)} required`;
          return res.redirect("/checkout");
        }

        let discount = 0;

        if (voucher.type.toLowerCase() === "percent") {
          discount = subtotal * (amount / 100);
        } else {
          discount = amount;
        }

        discount = Math.min(discount, subtotal);
        discount = Math.round(discount * 100) / 100;

        req.session.voucher = {
          code: voucher.code,
          type: voucher.type,
          calculatedDiscount: discount
        };

        req.session.message = `Voucher applied: -$${discount.toFixed(2)}`;
        res.redirect("/checkout");
      });
    });
  },

  removeVoucher: function (req, res) {
    req.session.voucher = null;
    req.session.message = "Voucher removed";
    res.redirect("/checkout");
  },

  processCheckout: function (req, res) {
    const userId = req.session.user.id;
    const { delivery_method, address } = req.body;
    const paymentRaw = req.body.payment_method || req.body.payment_method_fallback || "";
    const paymentNormalized = paymentRaw.toString().trim().toUpperCase();
    const paymentMap = {
      PAYPAL: "PAYPAL",
      NETS: "NETS_QR",
      NETS_QR: "NETS_QR",
      STRIPE: "STRIPE",
      AIRWALLEX: "AIRWALLEX"
    };
    const payment_method = paymentMap[paymentNormalized] || "";

    if (!delivery_method) {
      req.session.message = "Please select a delivery method.";
      req.flash('error', 'Please select a delivery method.');
      return res.redirect("/checkout");
    }

    if (delivery_method === "delivery" && (!address || !address.trim())) {
      req.session.message = "Please provide a delivery address.";
      req.flash('error', 'Please provide a delivery address.');
      return res.redirect("/checkout");
    }

    if (!payment_method) {
      req.session.message = "Please select a payment method.";
      req.flash('error', 'Please select a payment method.');
      return res.redirect("/checkout");
    }

    req.session.checkoutData = { delivery_method, address, payment_method };

    Product.getCart(userId, (err, cart) => {
      if (!cart || cart.length === 0) return res.redirect("/cart");

      const subtotal = cart.reduce(
        (sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)),
        0
      );

      const voucher = req.session.voucher;
      const discount = voucher ? voucher.calculatedDiscount : 0;
      const total = Math.max(0, subtotal - discount);

      req.session.paymentAmount = total;
      req.session.paymentCart = cart;

      if (payment_method === "PAYPAL") {
        return res.redirect("/payment/paypal/redirect");
      }

      if (payment_method === "NETS_QR") {
        return res.redirect("/payment/nets/qr");
      }

      if (payment_method === "STRIPE") {
        return res.redirect("/payment/stripe/redirect");
      }

      if (payment_method === "AIRWALLEX") {
        return res.redirect("/payment/airwallex/redirect");
      }

      req.session.message = "Unsupported payment method.";
      req.flash('error', 'Unsupported payment method.');
      res.redirect("/checkout");
    });
  },

  showPaymentPage: function (req, res) {
    res.render("payment", {
      amount: req.session.paymentAmount,
      user: req.session.user
    });
  },

  confirmPayment: function (req, res) {
    const userId = req.session.user.id;
    const cart = req.session.paymentCart;
    const { delivery_method, address, payment_method } = req.session.checkoutData;
    const total = req.session.paymentAmount;

    const items = cart.map(i => ({
      product_id: i.id,
      quantity: i.quantity,
      price: i.price
    }));

    Product.createOrder(
      userId,
      delivery_method,
      address,
      payment_method,
      total,
      items,
      function (err, orderId) {
        if (err) return res.status(500).send("Order creation failed");

        Product.clearCart(userId, () => {
          req.session.paymentCart = null;
          req.session.paymentAmount = null;
          req.session.checkoutData = null;
          req.session.voucher = null;

          res.redirect("/invoice/" + orderId);
        });
      }
    );
  },

  showInvoice: function (req, res) {
    const orderId = req.params.id;

    Product.getOrderById(orderId, (err, rows) => {
      if (!rows || rows.length === 0) return res.status(404).send("Invoice not found");

      Product.getOrderItems(orderId, (err2, items) => {
        res.render("invoice", {
          order: rows[0],
          items,
          user: req.session.user
        });
      });
    });
  },

  showOrderHistory: function (req, res) {
    Product.getUserOrders(req.session.user.id, (err, orders) => {
      res.render("orderhistory", {
        orders,
        user: req.session.user
      });
    });
  },

  reorder: function (req, res) {
    const orderId = req.params.id;
    const userId = req.session.user.id;

    Product.getOrderItems(orderId, (err, items) => {
      items.forEach(i => {
        Product.addToCart(userId, i.product_id, i.quantity, () => {});
      });
      res.redirect("/cart");
    });
  },

  showReviewPage: function (req, res) {
    const productId = req.params.productId;
    const userId = req.session.user.id;

    Product.hasBoughtProduct(userId, productId, (err, bought) => {
      if (!bought) return res.send("You can review only after purchasing.");

      Product.getById(productId, (err2, product) => {
        res.render("review", {
          user: req.session.user,
          product
        });
      });
    });
  },

  submitReview: function (req, res) {
    const userId = req.session.user.id;
    const productId = req.params.productId;

    Product.hasBoughtProduct(userId, productId, (err, bought) => {
      if (!bought) return res.send("You can review only after purchasing.");

      Product.addReview(
        userId,
        productId,
        req.body.rating,
        req.body.comment,
        () => res.redirect("/product/" + productId)
      );
    });
  }
};

module.exports = ProductController;

const Product = require('../models/Product');
const db = require('../db');

const ProductController = {

  showShopping: function (req, res) {
    const search = req.query.search || "";
    const category = req.query.category || "";
    const sort = req.query.sort || "";
    const inStock = req.query.inStock === "1";

    Product.getAllSorted(search, category, sort, inStock, (err, products) => {
      if (err) return res.status(500).send("Error loading shopping");

      res.render("shopping", {
        products,
        vouchers: [],
        search,
        category,
        sort,
        inStock,
        user: req.session.user
      });
    });
  },

  showProduct: function (req, res) {
    const id = req.params.id;
    Product.getById(id, (err, product) => {
      if (!product) return res.status(404).send("Product not found");

      Product.getReviews(id, (err2, reviews) => {
        Product.getRatingSummary(id, (err3, summary) => {
          const avg = summary && summary.avgRating ? Number(summary.avgRating) : 0;
          const count = summary && summary.reviewCount ? Number(summary.reviewCount) : 0;

          if (!req.session.user) {
            return res.render("product", {
              product,
              reviews,
              user: null,
              avgRating: avg,
              reviewCount: count,
              canReview: false
            });
          }

          Product.hasBoughtProduct(req.session.user.id, id, (err4, bought) => {
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
    const productId = req.params.id;
    const qtyRequested = parseInt(req.body.quantity) || 1;
    const addDustBag = req.body.add_dust_bag === "1";

    Product.getById(productId, (err, product) => {
      if (!product) return res.send("Product not found.");

      const stock = parseInt(product.quantity);
      if (stock <= 0) {
        req.session.message = `${product.productName} is SOLD OUT`;
        return res.redirect("/shopping");
      }

      if (qtyRequested > stock) {
        req.session.message = `Only ${stock} left in stock. Reduce your quantity.`;
        return res.redirect("/shopping");
      }

      if (!req.session.cart) req.session.cart = [];
      const cart = req.session.cart;
      const existing = cart.find((i) => String(i.id) === String(product.id));
      if (existing) {
        existing.quantity = Math.min(existing.quantity + qtyRequested, stock);
      } else {
        cart.push({
          id: product.id,
          productName: product.productName,
          price: Number(product.price),
          image: product.image,
          quantity: qtyRequested,
          stock: stock
        });
      }

      const finalize = () => {
        req.session.cart = cart;
        res.redirect("/cart");
      };

      if (!addDustBag) {
        return finalize();
      }

      Product.getDustBag((dustErr, dustBag) => {
        if (dustErr || !dustBag) {
          return finalize();
        }

        const dustExisting = cart.find((i) => String(i.id) === String(dustBag.id) && i.isAddon);
        if (dustExisting) {
          dustExisting.quantity += 1;
        } else {
          cart.push({
            id: dustBag.id,
            productName: "Dust Bag (Add-on)",
            price: 3,
            image: dustBag.image,
            quantity: 1,
            stock: dustBag.quantity,
            isAddon: true
          });
        }

        finalize();
      });
    });
  },

  showCart: function (req, res) {
    const cart = req.session.cart || [];
    res.render("cart", { cart, user: req.session.user });
  },

  removeCartItem: function (req, res) {
    const id = req.params.id;
    const cart = req.session.cart || [];
    req.session.cart = cart.filter((i) => String(i.id) !== String(id));
    res.redirect("/cart");
  },

  updateCartItem: function (req, res) {
    const productId = req.params.id;
    const qtyRequested = parseInt(req.body.quantity);
    const cart = req.session.cart || [];
    const item = cart.find((i) => String(i.id) === String(productId));
    if (!item) return res.redirect("/cart");

    const stock = parseInt(item.stock || item.quantity);
    if (qtyRequested > stock) {
      req.session.message = `Only ${stock} left in stock.`;
      return res.redirect("/cart");
    }

    item.quantity = qtyRequested;
    req.session.cart = cart;
    res.redirect("/cart");
  },

  showCheckout: function (req, res) {
    const cart = req.session.cart || [];
    const message = req.session.message || "";
    req.session.message = null;

    res.render("checkout", {
      cart,
      voucher: null,
      message,
      user: req.session.user
    });
  },

  processCheckout: function (req, res) {
    const { delivery_method, address, buyer_name, buyer_email, buyer_phone } = req.body;
    const payment_method = (req.body.payment_method || "").toString().trim();
    const cart = req.session.cart || [];

    if (!cart.length) return res.redirect("/cart");

    if (!buyer_name || !buyer_name.trim()) {
      req.session.message = "Please enter your name.";
      return res.redirect("/checkout");
    }

    if (!buyer_email || !buyer_email.trim()) {
      req.session.message = "Please enter your email.";
      return res.redirect("/checkout");
    }

    if (!buyer_phone || !buyer_phone.trim()) {
      req.session.message = "Please enter your phone number.";
      return res.redirect("/checkout");
    }

    if (!delivery_method) {
      req.session.message = "Please select a delivery method.";
      return res.redirect("/checkout");
    }

    if (delivery_method === "delivery" && (!address || !address.trim())) {
      req.session.message = "Please provide a delivery address.";
      return res.redirect("/checkout");
    }

    const finalPaymentMethod = "PayNow";

    const subtotal = cart.reduce(
      (sum, item) => sum + (parseFloat(item.price) * parseInt(item.quantity)),
      0
    );

    const deliveryFee = delivery_method === "delivery" ? 4 : 0;
    const total = Math.max(0, subtotal) + deliveryFee;

    const insertOrderSql = `
      INSERT INTO orders (buyer_name, buyer_email, buyer_phone, total_amount, payment_method, payment_status)
      VALUES (?, ?, ?, ?, ?, 'Pending')
    `;

    db.query(
      insertOrderSql,
      [buyer_name, buyer_email, buyer_phone, total, finalPaymentMethod],
      (err, result) => {
        if (err) {
          return res.status(500).send("Order creation failed");
        }

        const orderId = result.insertId;
        const itemValues = cart.map((item) => [
          orderId,
          item.id,
          item.quantity,
          item.price
        ]);

        const insertItemsSql = `
          INSERT INTO order_items (order_id, product_id, quantity, price_at_purchase)
          VALUES ?
        `;

        db.query(insertItemsSql, [itemValues], (err2) => {
          if (err2) {
            return res.status(500).send("Order items creation failed");
          }

          req.session.cart = [];
          res.redirect("/invoice/" + orderId);
        });
      }
    );
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

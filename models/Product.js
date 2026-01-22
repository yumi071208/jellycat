const db = require('../db');

const Product = {

  // ========= PRODUCTS ========= //
  getAll: function(callback) {
    db.query("SELECT * FROM products", callback);
  },

  getAllFiltered: function(search, category, callback) {
    let sql = "SELECT * FROM products WHERE 1=1";
    let params = [];

    if (search) {
      sql += " AND productName LIKE ?";
      params.push("%" + search + "%");
    }

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    db.query(sql, params, callback);
  },

  getById: function(id, callback) {
    db.query("SELECT * FROM products WHERE id=?", [id], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0]);
    });
  },

  add: function(data, callback) {
    const sql = `
      INSERT INTO products (productName, quantity, price, image, category)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.query(sql, [
      data.productName,
      data.quantity,
      data.price,
      data.image,
      data.category
    ], callback);
  },

  update: function(id, data, callback) {
    const sql = `
      UPDATE products SET productName=?, quantity=?, price=?, image=?, category=?
      WHERE id=?
    `;
    db.query(sql, [
      data.productName,
      data.quantity,
      data.price,
      data.image,
      data.category,
      id
    ], callback);
  },

  delete: function(id, callback) {
    db.query("DELETE FROM products WHERE id=?", [id], callback);
  },

  // ========= CART ========= //
  addToCart: function(userId, productId, qty, callback) {
    const check = "SELECT * FROM cart WHERE user_id=? AND product_id=?";

    db.query(check, [userId, productId], (err, rows) => {
      if (err) return callback(err);

      if (rows.length === 0) {
        const insert = `
          INSERT INTO cart (user_id, product_id, quantity)
          VALUES (?, ?, ?)
        `;
        db.query(insert, [userId, productId, qty], callback);
      } else {
        const update = `
          UPDATE cart SET quantity = quantity + ?
          WHERE user_id=? AND product_id=?
        `;
        db.query(update, [qty, userId, productId], callback);
      }
    });
  },

  getCart: function(userId, callback) {
    const sql = `
      SELECT c.id AS cart_id, c.quantity,
             p.id, p.productName, p.price, p.image
      FROM cart c
      JOIN products p ON c.product_id=p.id
      WHERE c.user_id = ?
    `;
    db.query(sql, [userId], callback);
  },

  removeFromCart: function(cartId, callback) {
    db.query("DELETE FROM cart WHERE id=?", [cartId], callback);
  },

  updateCartQuantity: function(cartId, qty, callback) {
    db.query("UPDATE cart SET quantity=? WHERE id=?", [qty, cartId], callback);
  },

  clearCart: function(userId, callback) {
    db.query("DELETE FROM cart WHERE user_id=?", [userId], callback);
  },

  // ========= ORDERS ========= //
  createOrder: function(userId, delivery, address, payment, total, items, callback) {
    const sqlOrder = `
      INSERT INTO orders 
      (user_id, delivery_method, address, payment_method, total, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;

    db.query(sqlOrder, [userId, delivery, address, payment, total], (err, result) => {
      if (err) return callback(err);

      const orderId = result.insertId;

      const sqlItems = `
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES ?
      `;

      const values = items.map(i => [
        orderId, i.product_id, i.quantity, i.price
      ]);

      db.query(sqlItems, [values], (err2) => {
        if (err2) return callback(err2);

        // 🔥 Reduce stock
        let pending = items.length;

        items.forEach(i => {
          const updateStock = `
            UPDATE products
            SET quantity = quantity - ?
            WHERE id = ?
          `;
          db.query(updateStock, [i.quantity, i.product_id], (err3) => {
            if (err3) return callback(err3);
            pending--;
            if (pending === 0) callback(null, orderId);
          });
        });
      });
    });
  },

  // ========= REQUIRED FOR INVOICE ========= //
  getOrderById: function(orderId, callback) {
    const sql = `
      SELECT o.*, u.username, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.id = ?
    `;
    db.query(sql, [orderId], callback);
  },

  getOrderItems: function(orderId, callback) {
    const sql = `
      SELECT oi.*, p.productName, p.image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `;
    db.query(sql, [orderId], callback);
  },

  // ========= ⭐ FIXED: USER ORDER HISTORY ========= //
  getUserOrders: function(userId, callback) {
    const sql = `
      SELECT * FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;
    db.query(sql, [userId], callback);
  },

  // ========= REVIEWS ========= //
  addReview: function(userId, productId, rating, comment, callback) {
    const sql = `
      INSERT INTO reviews (user_id, product_id, rating, comment)
      VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [userId, productId, rating, comment], callback);
  },

  getReviews: function(productId, callback) {
    const sql = `
      SELECT r.*, u.username 
      FROM reviews r
      JOIN users u ON r.user_id=u.id
      WHERE r.product_id=? 
      ORDER BY r.created_at DESC
    `;
    db.query(sql, [productId], callback);
  },

  // ========= SORTING ========= //
  getAllSorted: function (search, category, sort, callback) {
    let sql = `
      SELECT 
        p.*, 
        (SELECT AVG(r.rating) FROM reviews r WHERE r.product_id = p.id) AS avgRating,
        (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS reviewCount,
        (SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.product_id = p.id) AS popularity
      FROM products p
      WHERE 1=1
    `;

    let params = [];

    if (search) {
      sql += " AND p.productName LIKE ?";
      params.push("%" + search + "%");
    }

    if (category) {
      sql += " AND p.category = ?";
      params.push(category);
    }

    if (sort === "popular") sql += " ORDER BY popularity DESC";
    else if (sort === "rating") sql += " ORDER BY avgRating DESC";
    else if (sort === "lowhigh") sql += " ORDER BY p.price ASC";
    else if (sort === "highlow") sql += " ORDER BY p.price DESC";
    else sql += " ORDER BY p.productName ASC";

    db.query(sql, params, callback);
  },

  // ========= RATING SUMMARY ========= //
  getRatingSummary: function (productId, callback) {
    const sql = `
      SELECT AVG(r.rating) AS avgRating, COUNT(*) AS reviewCount
      FROM reviews r
      WHERE r.product_id=?
    `;
    db.query(sql, [productId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0]);
    });
  },

  // ========= CAN USER REVIEW? ========= //
  hasBoughtProduct: function (userId, productId, callback) {
    const sql = `
      SELECT COUNT(*) AS bought 
      FROM order_items oi
      JOIN orders o ON oi.order_id=o.id
      WHERE o.user_id=? AND oi.product_id=?
    `;
    db.query(sql, [userId, productId], (err, rows) => {
      if (err) return callback(err);
      callback(null, rows[0].bought > 0);
    });
  }
};

module.exports = Product;

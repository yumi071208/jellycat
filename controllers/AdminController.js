const db = require('../db');
const Product = require('../models/Product');
const Voucher = require('../models/voucher');

const AdminController = {

  // ========== DASHBOARD ==========
  showDashboard(req, res) {
    const stats = {};

    db.query('SELECT COUNT(*) AS totalProducts FROM products', (err, prodRows) => {
      stats.totalProducts = prodRows[0].totalProducts;

      db.query('SELECT COUNT(*) AS totalUsers FROM users', (err2, userRows) => {
        stats.totalUsers = userRows[0].totalUsers;

        db.query('SELECT COUNT(*) AS totalOrders FROM orders', (err3, orderRows) => {
          stats.totalOrders = orderRows[0].totalOrders;

          db.query('SELECT IFNULL(SUM(total),0) AS revenueToday FROM orders WHERE DATE(created_at)=CURDATE()', (err4, revTodayRows) => {
            stats.revenueToday = revTodayRows[0].revenueToday;

            db.query('SELECT IFNULL(SUM(total),0) AS revenueWeek FROM orders WHERE created_at>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)', (err5, revWeekRows) => {
              stats.revenueWeek = revWeekRows[0].revenueWeek;

              const bestSql = `
                SELECT p.product_id AS id, p.name AS productName, p.image_url AS image,
                       IFNULL(SUM(oi.quantity),0) AS soldQty
                FROM products p
                LEFT JOIN order_items oi ON oi.product_id = p.product_id
                GROUP BY p.product_id
                ORDER BY soldQty DESC
                LIMIT 5
              `;

              db.query(bestSql, (err6, bestRows) => {
                const lowStockSql = `
                  SELECT product_id AS id, name AS productName, description, price, image_url AS image, stock AS quantity, category
                  FROM products
                  WHERE stock <= 10
                  ORDER BY stock ASC
                  LIMIT 5
                `;
                db.query(lowStockSql, (err7, lowRows) => {

                    const monthlySql = `
                        SELECT 
                            DATE_FORMAT(created_at, '%Y-%m') AS month,
                            SUM(total) AS revenue
                        FROM orders
                        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                        ORDER BY month;
                    `;

                    db.query(monthlySql, (err8, monthlyRows) => {
                        if (err8) {
                            console.log("Monthly revenue error:", err8);
                        }

                        res.render("adminDashboard", {
                            user: req.session.user,
                            stats,
                            bestProducts: bestRows || [],
                            lowStock: lowRows || [],
                            monthlyRevenue: monthlyRows || []
                        });
                    });
                });
              });
            });
          });
        });
      });
    });
  },
  

  // ========== INVENTORY ==========
  showInventory(req, res) {
    const category = req.query.category || '';
    const lowFirst = req.query.lowFirst === '1';

    let sql = `
      SELECT product_id AS id, name AS productName, description, price, image_url AS image, stock AS quantity, category
      FROM products
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += lowFirst ? " ORDER BY stock ASC" : " ORDER BY name ASC";

    db.query(sql, params, (err, rows) => {
      res.render("adminInventory", {
        user: req.session.user,
        products: rows,
        category,
        lowFirst
      });
    });
  },

  // ========== UPDATE PRODUCT ==========
  showUpdateProduct(req, res) {
    Product.getById(req.params.id, (err, product) => {
      if (!product) return res.send("Product not found");
      res.render("update-product", { user: req.session.user, product });
    });
  },

  updateProduct(req, res) {
    const id = req.params.id;
    const data = {
      productName: req.body.name,
      quantity: req.body.quantity,
      price: req.body.price,
      category: req.body.category,
      image: req.file ? req.file.filename : req.body.existingImage
    };

    Product.update(id, data, () => res.redirect("/admin/inventory"));
  },

  // ========== ADD PRODUCT ==========
  showAddProduct(req, res) {
    res.render("addProduct", { user: req.session.user });
  },

  addProduct(req, res) {
    const data = {
      productName: req.body.name,
      quantity: req.body.quantity,
      price: req.body.price,
      image: req.file ? req.file.filename : null,
      category: req.body.category
    };

    Product.add(data, () => res.redirect("/admin/inventory"));
  },

  // ========== ORDERS ==========
  showOrders(req, res) {
    const sql = `
      SELECT o.*, u.username, u.email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `;
    db.query(sql, (err, rows) =>
      res.render("adminOrders", { user: req.session.user, orders: rows })
    );
  },

  updateOrderStatus(req, res) {
    const sql = "UPDATE orders SET status=? WHERE id=?";
    db.query(sql, [req.body.status, req.params.id], () =>
      res.redirect("/admin/orders")
    );
  },

  // ========== REVIEWS ==========
  showReviews(req, res) {
    const sql = `
      SELECT r.*, u.username, p.name AS productName
      FROM reviews r
      JOIN users u ON r.user_id=u.id
      JOIN products p ON r.product_id=p.product_id
      ORDER BY r.created_at DESC
    `;
    db.query(sql, (err, rows) =>
      res.render("adminReviews", { user: req.session.user, reviews: rows })
    );
  },

  deleteReview(req, res) {
    db.query("DELETE FROM reviews WHERE id=?", [req.params.id], () =>
      res.redirect("/admin/reviews")
    );
  },

  // ========== USERS ==========
  showUsers(req, res) {
    const sql = `
      SELECT u.*,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) AS orderCount
      FROM users u
      ORDER BY u.created_at DESC
    `;
    db.query(sql, (err, rows) =>
      res.render("adminUsers", { user: req.session.user, users: rows })
    );
  },

  changeRole(req, res) {
    db.query("UPDATE users SET role=? WHERE id=?", [req.body.role, req.params.id], () =>
      res.redirect("/admin/users")
    );
  },

  toggleUserActive(req, res) {
    const active = req.body.active === "1" ? 1 : 0;
    db.query("UPDATE users SET active=? WHERE id=?", [active, req.params.id], () =>
      res.redirect("/admin/users")
    );
  },
  
  async getMonthlyRevenue(req, res) {
      try {
          const [rows] = await db.execute(`
              SELECT 
                  DATE_FORMAT(created_at, '%Y-%m') AS month,
                  SUM(total) AS revenue
              FROM orders
              GROUP BY DATE_FORMAT(created_at, '%Y-%m')
              ORDER BY month ASC;
          `);

          return rows;
      } catch (err) {
          console.error(err);
          return [];
      }
  },

  // VOUCHER MANAGEMENT
  showVouchers(req, res) {
    Voucher.getAll((err, vouchers) => {
      if (err) {
        console.error("Error loading vouchers:", err);
        return res.render("adminVouchers", { user: req.session.user, vouchers: [] });
      }

      console.log("ADMIN VOUCHERS:", vouchers);

      res.render("adminVouchers", {
        user: req.session.user,
        vouchers: vouchers || []   // prevents undefined
      });
    });
  },


  showAddVoucher(req, res) {
    res.render("addVoucher", { user: req.session.user });
  },

  addVoucher(req, res) {
  const data = {
    code: req.body.code,
    type: req.body.type,
    amount: req.body.amount,
    minSpend: req.body.minSpend,
    publish_at: req.body.publish_at,
    expire_at: req.body.expire_at
  };


    Voucher.add(data, () => res.redirect("/admin/vouchers"));
  },

  showEditVoucher(req, res) {
    Voucher.getById(req.params.id, (err, voucher) =>
      res.render("editVoucher", {
        user: req.session.user,
        voucher
      })
    );
  },

  editVoucher(req, res) {
  const data = {
    code: req.body.code,
    type: req.body.type,
    amount: req.body.amount,
    minSpend: req.body.minSpend,
    publish_at: req.body.publish_at,
    expire_at: req.body.expire_at
  };

  Voucher.update(req.params.id, data, () =>
    res.redirect("/admin/vouchers")
  );
},


  deleteVoucher(req, res) {
    Voucher.delete(req.params.id, () =>
      res.redirect("/admin/vouchers")
    );
  }
};

module.exports = AdminController;

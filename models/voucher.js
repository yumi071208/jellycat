const db = require('../db');

const Voucher = {
  // ADMIN — see all vouchers
  getAll(callback) {
    db.query("SELECT * FROM vouchers ORDER BY publish_at DESC", callback);
  },

  // USER — only active vouchers
  getActive(callback) {
    db.query(
      `SELECT * FROM vouchers
       WHERE publish_at <= NOW()
       AND expire_at >= NOW()
       ORDER BY publish_at DESC`,
      callback
    );
  },

  getById(id, callback) {
    db.query("SELECT * FROM vouchers WHERE id = ?", [id], (err, rows) => {
      callback(err, rows[0]);
    });
  },

  getByCode(code, callback) {
    db.query(
      "SELECT * FROM vouchers WHERE code = ? AND expire_at >= NOW()",
      [code],
      (err, rows) => callback(err, rows[0])
    );
  },

  add(data, callback) {
    const sql = `
      INSERT INTO vouchers (code, type, amount, minSpend, publish_at, expire_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [
      data.code,
      data.type,
      data.amount,
      data.minSpend,
      data.publish_at,
      data.expire_at
    ], callback);
  },

  update(id, data, callback) {
    const sql = `
      UPDATE vouchers
      SET code=?, type=?, amount=?, minSpend=?, publish_at=?, expire_at=?
      WHERE id=?
    `;
    db.query(sql, [
      data.code,
      data.type,
      data.amount,
      data.minSpend,
      data.publish_at,
      data.expire_at,
      id
    ], callback);
  },

  delete(id, callback) {
    db.query("DELETE FROM vouchers WHERE id=?", [id], callback);
  }
};

module.exports = Voucher;

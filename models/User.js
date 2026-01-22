const db = require('../db');

const User = {

  create: function(user, callback) {
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [user.username, user.email, user.password, user.address, user.contact, user.role];

    db.query(sql, params, function(err, result) {
      if (err) return callback(err);
      return callback(null, { insertId: result.insertId });
    });
  },

  findByEmail: function(email, callback) {
    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], function(err, results) {
      if (err) return callback(err);
      return callback(null, results[0]);
    });
  },

  findByEmailAndPassword: function(email, password, callback) {
    const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';
    db.query(sql, [email, password], function(err, results) {
      if (err) return callback(err);
      return callback(null, results[0]);
    });
  }
};

module.exports = User;

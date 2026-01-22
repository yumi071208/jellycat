const User = require('../models/User');

const UserController = {
  showRegister: function(req, res) {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
  },

  register: function(req, res) {
    const user = {
      username: req.body.username,
      email: req.body.email,
      password: req.body.password,
      address: req.body.address,
      contact: req.body.contact,
      role: req.body.role
    };

    User.create(user, (err) => {
      if (err) {
        req.flash('error', 'Registration failed');
        return res.redirect('/register');
      }
      req.flash('success', 'Registration successful! Please log in.');
      res.redirect('/login');
    });
  },

  showLogin: function(req, res) {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
  },

  login: function(req, res) {
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/login');
    }

    User.findByEmailAndPassword(email, password, (err, user) => {
      if (err) {
        req.flash('error', 'Login failed');
        return res.redirect('/login');
      }

      if (user) {
        req.session.user = user;

        // Redirect based on role
        if (user.role === 'admin') {
          return res.redirect('/admin');   // FIXED
        }
        return res.redirect('/shopping');
      }

      req.flash('error', 'Invalid email or password.');
      res.redirect('/login');
    });
  },

  logout: function(req, res) {
    req.session.destroy();
    res.redirect('/');
  }
};

module.exports = UserController;

const User = require('../models/User');

const UserController = {
  maskEmail: function(email) {
    if (!email || !email.includes('@')) return email || '';
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
      return `${local[0] || ''}**@${domain}`;
    }
    const first = local[0];
    const last = local[local.length - 1];
    const masked = `${first}${'*'.repeat(Math.max(local.length - 2, 1))}${last}`;
    return `${masked}@${domain}`;
  },
  maskPhone: function(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/[^0-9]/g, '');
    if (digits.length <= 4) return digits.replace(/\d/g, '*');
    const last4 = digits.slice(-4);
    return `***-***-${last4}`;
  },

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
        const demoCode = String(Math.floor(100000 + Math.random() * 900000));
        req.session.pendingUser = user;
        req.session.pending2faEmailCode = demoCode;
        req.session.pending2faPhoneCode = null;
        req.session.pending2faEmailVerified = false;
        return res.redirect('/login/verify-email');
      }

      req.flash('error', 'Invalid email or password.');
      res.redirect('/login');
    });
  },

  showVerifyEmail: function(req, res) {
    if (!req.session.pendingUser) {
      req.flash('error', 'Please log in first.');
      return res.redirect('/login');
    }

    const maskedEmail = UserController.maskEmail(req.session.pendingUser.email);
    res.render('verify-2fa', {
      emailMasked: maskedEmail,
      demoCode: req.session.pending2faEmailCode,
      errors: req.flash('error')
    });
  },

  verifyEmail: function(req, res) {
    if (!req.session.pendingUser) {
      req.flash('error', 'Please log in first.');
      return res.redirect('/login');
    }

    const code = (req.body.code || '').trim();
    if (!code || code !== req.session.pending2faEmailCode) {
      req.flash('error', 'Invalid code. This is a mock verification.');
      return res.redirect('/login/verify-email');
    }

    req.session.pending2faEmailVerified = true;
    req.session.pending2faPhoneCode = String(Math.floor(100000 + Math.random() * 900000));
    return res.redirect('/login/verify-phone');
  },

  showVerifyPhone: function(req, res) {
    if (!req.session.pendingUser || !req.session.pending2faEmailVerified) {
      req.flash('error', 'Please verify your email first.');
      return res.redirect('/login/verify-email');
    }

    const maskedPhone = UserController.maskPhone(req.session.pendingUser.contact);
    res.render('verify-2fa-phone', {
      phoneMasked: maskedPhone,
      demoCode: req.session.pending2faPhoneCode,
      errors: req.flash('error')
    });
  },

  verifyPhone: function(req, res) {
    if (!req.session.pendingUser || !req.session.pending2faEmailVerified) {
      req.flash('error', 'Please verify your email first.');
      return res.redirect('/login/verify-email');
    }

    const code = (req.body.code || '').trim();
    if (!code || code !== req.session.pending2faPhoneCode) {
      req.flash('error', 'Invalid code. This is a mock verification.');
      return res.redirect('/login/verify-phone');
    }

    const user = req.session.pendingUser;
    req.session.user = user;
    req.session.pendingUser = null;
    req.session.pending2faEmailCode = null;
    req.session.pending2faPhoneCode = null;
    req.session.pending2faEmailVerified = null;

    if (user.role === 'admin') {
      return res.redirect('/admin');
    }
    return res.redirect('/shopping');
  },

  logout: function(req, res) {
    req.session.destroy();
    res.redirect('/');
  }
};

module.exports = UserController;

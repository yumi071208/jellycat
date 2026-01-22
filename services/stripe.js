const Stripe = require('stripe');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function createCheckoutSession(cart, totalAmount, orderId) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  const lineItems = cart.map((item) => ({
    price_data: {
      currency: 'sgd',
      product_data: {
        name: item.productName
      },
      unit_amount: Math.round(Number(item.price) * 100)
    },
    quantity: Number(item.quantity)
  }));

  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    metadata: {
      order_id: orderId
    },
    success_url: `${BASE_URL}/payment/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/payment/stripe/cancel`
  });
}

async function retrieveSession(sessionId) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  return stripe.checkout.sessions.retrieve(sessionId);
}

module.exports = {
  createCheckoutSession,
  retrieveSession
};

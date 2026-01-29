const axios = require('axios');
const { randomUUID } = require('crypto');

const AIRWALLEX_ENV = process.env.AIRWALLEX_ENV || 'demo';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY;
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const BASE_URL =
  process.env.AIRWALLEX_BASE_URL ||
  (AIRWALLEX_ENV === 'prod'
    ? 'https://api.airwallex.com'
    : 'https://api-demo.airwallex.com');

let cachedToken = null;
let tokenExpiresAt = 0;

function createRequestId() {
  try {
    return randomUUID();
  } catch (err) {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

async function getAccessToken() {
  if (!AIRWALLEX_API_KEY || !AIRWALLEX_CLIENT_ID) {
    throw new Error('Airwallex is not configured');
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt - 60000 > now) {
    return cachedToken;
  }

  const response = await axios.post(
    `${BASE_URL}/api/v1/authentication/login`,
    {},
    {
      headers: {
        'x-api-key': AIRWALLEX_API_KEY,
        'x-client-id': AIRWALLEX_CLIENT_ID
      }
    }
  );

  const token = response.data.token || response.data.access_token;
  const expiresAt = response.data.expires_at || response.data.expiresAt;
  cachedToken = token;
  tokenExpiresAt = expiresAt ? new Date(expiresAt).getTime() : now + 25 * 60 * 1000;
  return token;
}

async function createPaymentIntent({ amount, currency, merchantOrderId, returnUrl }) {
  const token = await getAccessToken();
  const payload = {
    request_id: createRequestId(),
    amount: Number(amount),
    currency,
    merchant_order_id: merchantOrderId,
    return_url: returnUrl
  };

  const response = await axios.post(
    `${BASE_URL}/api/v1/pa/payment_intents/create`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

async function retrievePaymentIntent(intentId) {
  const token = await getAccessToken();
  const response = await axios.get(`${BASE_URL}/api/v1/pa/payment_intents/${intentId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return response.data;
}

module.exports = {
  createPaymentIntent,
  retrievePaymentIntent
};

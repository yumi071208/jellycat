const axios = require('axios');
<<<<<<< HEAD
const crypto = require('crypto');

const API_KEY = process.env.API_KEY;
const PROJECT_ID = process.env.PROJECT_ID;
const NETS_BASE_URL = process.env.NETS_BASE_URL || 'https://sandbox.nets.openapipaas.com';

const statusStore = new Map();

class NetsAPI {
    /**
     * Create a payment with NETS OpenAPI
     */
    static async createPayment(amount, orderId, customerId) {
        if (!API_KEY || !PROJECT_ID) {
            return {
                success: false,
                error: 'Missing NETS API credentials',
                statusCode: 500
            };
        }

        const uuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
        const txnId = `sandbox_nets|m|${uuid}`;
        const requestBody = {
            txn_id: txnId,
            amt_in_dollars: Number(amount).toFixed(2),
            notify_mobile: 0
        };

        try {
            const response = await axios.post(
                `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/request`,
                requestBody,
                {
                    headers: {
                        'api-key': API_KEY,
                        'project-id': PROJECT_ID
                    }
                }
            );

            const qrData = response.data?.result?.data || {};
            const hasQr = qrData.response_code === '00' && qrData.txn_status === 1 && qrData.qr_code;
            const paymentId = qrData.txn_retrieval_ref || qrData.txn_id || orderId;

            if (!hasQr) {
                return {
                    success: false,
                    error: qrData.error_message || 'NETS QR request failed',
                    statusCode: response.status,
                    responseData: response.data
                };
            }

            const qrImage = `data:image/png;base64,${qrData.qr_code}`;

            statusStore.set(paymentId, {
                status: 'PENDING',
                rawResponse: qrData
            });

            return {
                success: true,
                paymentId: paymentId,
                qrCode: qrImage,
                qrImage: qrImage,
                rawResponse: response.data,
                txnId: qrData.txn_id || txnId
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                statusCode: error.response?.status,
                responseData: error.response?.data
            };
        }
    }

    /**
     * Check payment status (updated via webhook)
     */
    static async checkStatus(paymentId) {
        const cached = statusStore.get(paymentId);
        if (cached) {
            return {
                success: true,
                status: cached.status,
                rawResponse: cached.rawResponse
            };
        }

        return {
            success: true,
            status: 'PENDING',
            rawResponse: { paymentId }
        };
    }

    static async checkPaymentStatus(paymentId) {
        return this.checkStatus(paymentId);
    }

    static recordStatus(paymentId, status, rawResponse) {
        if (!paymentId || !status) {
            return;
        }

        statusStore.set(paymentId, {
            status: status,
            rawResponse: rawResponse
        });
    }
}

module.exports = NetsAPI;
=======
const QRCode = require('qrcode');
const { generateNETSReference } = require('../utils/generate_course_init_id');

const NETS_API_KEY = process.env.API_KEY;
const NETS_PROJECT_ID = process.env.PROJECT_ID;
const BASE_URL =
  process.env.NETS_BASE_URL || 'https://sandbox.nets.openapipaas.com';

const statusStore = new Map();

function isConfigured() {
  return Boolean(NETS_API_KEY && NETS_PROJECT_ID);
}

function normalizeStatus(rawStatus, txnStatus) {
  if (typeof txnStatus === 'number') {
    return txnStatus === 1 ? 'COMPLETED' : 'FAILED';
  }

  if (typeof rawStatus === 'string') {
    return rawStatus.toUpperCase();
  }

  return 'PENDING';
}

function buildTxnId(orderId) {
  if (process.env.NETS_TXN_ID_OVERRIDE) {
    return process.env.NETS_TXN_ID_OVERRIDE;
  }

  if (typeof orderId === 'string' && orderId.startsWith('sandbox_nets|m|')) {
    return orderId;
  }

  if (BASE_URL.includes('sandbox')) {
    if (process.env.NETS_SANDBOX_TXN_ID) {
      return process.env.NETS_SANDBOX_TXN_ID;
    }

    // Sandbox default used by the project starter to satisfy NETS format checks.
    return 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b';
  }

  return generateNETSReference();
}

async function createPayment(amount, orderId, customerId) {
  if (!isConfigured()) {
    return {
      success: false,
      error: 'NETS API is not configured. Set API_KEY and PROJECT_ID.',
      statusCode: 500,
      config: { baseURL: BASE_URL }
    };
  }

  try {
    const requestBody = {
      txn_id: buildTxnId(orderId),
      amt_in_dollars: Number(amount),
      notify_mobile: 0
    };

    if (process.env.NETS_DEBUG === '1') {
      console.log('NETS request payload:', requestBody);
    }

    const response = await axios.post(
      `${BASE_URL}/api/v1/common/payments/nets-qr/request`,
      requestBody,
      {
        headers: {
          'api-key': NETS_API_KEY,
          'project-id': NETS_PROJECT_ID
        }
      }
    );

    const qrData = response?.data?.result?.data || {};
    const qrBase64 = qrData.qr_code || null;
    const paymentId = qrData.txn_retrieval_ref || qrData.txn_id || orderId;

    let qrImage = null;
    if (qrBase64) {
      qrImage = `data:image/png;base64,${qrBase64}`;
    } else if (qrData.qr_payload) {
      try {
        qrImage = await QRCode.toDataURL(qrData.qr_payload);
      } catch (error) {
        qrImage = null;
      }
    }

    const success =
      qrData.response_code === '00' || qrData.txn_status === 1 || Boolean(qrImage);

    if (!success) {
      return {
        success: false,
        error: qrData.error_message || 'NETS API failed to create payment',
        statusCode: response.status,
        responseData: response.data,
        config: {
          baseURL: BASE_URL,
          endpoint: '/api/v1/common/payments/nets-qr/request'
        }
      };
    }

    return {
      success: true,
      paymentId,
      qrCode: qrBase64,
      qrImage,
      statusCode: response.status,
      responseData: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data,
      config: {
        baseURL: BASE_URL,
        endpoint: '/api/v1/common/payments/nets-qr/request'
      }
    };
  }
}

async function checkStatus(paymentId) {
  if (!paymentId) {
    return {
      success: false,
      status: 'INVALID',
      error: 'Invalid payment ID'
    };
  }

  const stored = statusStore.get(paymentId);
  if (stored) {
    return {
      success: true,
      status: stored.status,
      source: 'webhook',
      updatedAt: stored.updatedAt,
      raw: stored.raw
    };
  }

  if (!isConfigured()) {
    return {
      success: false,
      status: 'PENDING',
      error: 'NETS API is not configured.'
    };
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/api/v1/common/payments/nets-qr/query`,
      { txn_retrieval_ref: paymentId },
      {
        headers: {
          'api-key': NETS_API_KEY,
          'project-id': NETS_PROJECT_ID
        }
      }
    );

    const statusData = response?.data?.result?.data || {};
    const normalized = normalizeStatus(statusData.status, statusData.txn_status);

    return {
      success: true,
      status: normalized,
      responseData: response.data
    };
  } catch (error) {
    return {
      success: false,
      status: 'ERROR',
      error: error.message,
      responseData: error.response?.data
    };
  }
}

function recordStatus(paymentId, status, raw) {
  if (!paymentId || !status) return;
  statusStore.set(paymentId, {
    status,
    raw,
    updatedAt: new Date().toISOString()
  });
}

module.exports = {
  createPayment,
  checkStatus,
  recordStatus
};
>>>>>>> feature/payment-methods

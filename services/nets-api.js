const axios = require('axios');
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

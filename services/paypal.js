const https = require('https');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const BASE_URL = process.env.PAYPAL_MODE === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsedData);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                } catch (error) {
                    reject(new Error(`Parse error: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        if (postData) {
            req.write(postData);
        }
        
        req.end();
    });
}

async function getAccessToken() {
    try {
        const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_CLIENT_SECRET).toString('base64');
        
        const options = {
            hostname: process.env.PAYPAL_MODE === 'sandbox' ? 'api-m.sandbox.paypal.com' : 'api-m.paypal.com',
            port: 443,
            path: '/v1/oauth2/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        };
        
        const data = await makeRequest(options, 'grant_type=client_credentials');
        return data.access_token;
    } catch (error) {
        console.error('Error getting PayPal access token:', error);
        throw error;
    }
}

async function createOrder(amount) {
    try {
        const accessToken = await getAccessToken();
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        
        const orderData = JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'SGD',
                    value: amount
                }
            }],
            application_context: {
                brand_name: 'Supermarket App',
                return_url: `${baseUrl}/payment/paypal/success`,
                cancel_url: `${baseUrl}/payment/paypal/cancel`
            }
        });
        
        const options = {
            hostname: process.env.PAYPAL_MODE === 'sandbox' ? 'api-m.sandbox.paypal.com' : 'api-m.paypal.com',
            port: 443,
            path: '/v2/checkout/orders',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Prefer': 'return=representation',
                'Accept': 'application/json'
            }
        };
        
        const order = await makeRequest(options, orderData);
        console.log('PayPal order created:', order.id);
        return order;
    } catch (error) {
        console.error('Error creating PayPal order:', error);
        throw error;
    }
}

async function captureOrder(orderId) {
    try {
        const accessToken = await getAccessToken();
        
        const options = {
            hostname: process.env.PAYPAL_MODE === 'sandbox' ? 'api-m.sandbox.paypal.com' : 'api-m.paypal.com',
            port: 443,
            path: `/v2/checkout/orders/${orderId}/capture`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        };
        
        const capture = await makeRequest(options);
        console.log('PayPal order captured:', capture.id);
        return capture;
    } catch (error) {
        console.error('Error capturing PayPal order:', error);
        throw error;
    }
}

module.exports = {
    createOrder,
    captureOrder
};
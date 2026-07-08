'use strict';
// Mobile-money layer for Lonestar Cell MTN (MoMo) and Orange Money Liberia.
//
// Reality check: both providers require a signed merchant agreement before
// API credentials are issued, and school bursars overwhelmingly reconcile
// against SMS confirmations. So the design is:
//   1. "manual" mode (default): the bursar records the payment with the momo
//      transaction ID from the confirmation SMS; the payment is flagged
//      momo_status='confirmed' after supervisor reconciliation.
//   2. API mode: when keys are configured, requestToPay() initiates a
//      collection and confirm() polls status. The endpoints below follow the
//      public MTN MoMo Collections API shape; Orange uses their WebPay API.
const config = require('../config');

function providerFor(method) {
  if (method === 'momo_mtn') return { name: 'Lonestar Cell MTN MoMo', key: config.momo.mtnKey };
  if (method === 'momo_orange') return { name: 'Orange Money', key: config.momo.orangeKey };
  return null;
}

function apiAvailable(method) {
  const p = providerFor(method);
  return Boolean(p && p.key);
}

// Initiate a collection request (push USSD prompt to the payer's phone).
// Returns { mode: 'manual' } when no API keys are configured.
async function requestToPay({ method, phone, amountCents, currency, reference }) {
  const p = providerFor(method);
  if (!p || !p.key) return { mode: 'manual' };
  try {
    // MTN MoMo Collections requesttopay-compatible call. The sandbox/live
    // base URL and subscription key come from the merchant onboarding pack.
    const base = method === 'momo_mtn'
      ? 'https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay'
      : 'https://api.orange.com/orange-money-webpay/lr/v1/webpayment';
    const resp = await fetch(base, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.key}`,
        'Content-Type': 'application/json',
        'X-Reference-Id': reference,
      },
      body: JSON.stringify({
        amount: (amountCents / 100).toFixed(2),
        currency: currency || 'LRD',
        externalId: reference,
        payer: { partyIdType: 'MSISDN', partyId: phone },
        payerMessage: 'School fee payment',
        payeeNote: reference,
      }),
    });
    if (resp.status === 202 || resp.ok) return { mode: 'api', status: 'pending', reference };
    return { mode: 'api', status: 'failed', error: `provider returned ${resp.status}` };
  } catch (e) {
    return { mode: 'api', status: 'failed', error: e.message };
  }
}

module.exports = { requestToPay, apiAvailable, providerFor };

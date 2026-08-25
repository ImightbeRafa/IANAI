/**
 * TiloPay one-time (non-subscription) checkout via processPayment API.
 * Returns a hosted securepayment URL — no static tp.cr link required.
 */

const TILOPAY_LOGIN = 'https://app.tilopay.com/api/v1/login'
const TILOPAY_PROCESS = 'https://app.tilopay.com/api/v1/processPayment'

export type TilopayOneTimeResult =
  | { ok: true; checkoutUrl: string; orderNumber: string }
  | { ok: false; error: string }

export async function createTilopayOneTimeCheckout(options: {
  amountUsd: number
  email: string
  description: string
  orderNumber: string
  redirectUrl: string
  currency?: string
}): Promise<TilopayOneTimeResult> {
  const key = process.env.TILOPAY_API_KEY
  const apiuser = process.env.TILOPAY_API_USER
  const password = process.env.TILOPAY_API_PASSWORD
  if (!key || !apiuser || !password) {
    return { ok: false, error: 'TiloPay API credentials not configured' }
  }

  const loginRes = await fetch(TILOPAY_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiuser, password, key }),
  })
  if (!loginRes.ok) {
    return { ok: false, error: `TiloPay login failed (${loginRes.status})` }
  }
  const loginJson = (await loginRes.json()) as { access_token?: string }
  if (!loginJson.access_token) {
    return { ok: false, error: 'TiloPay login missing access_token' }
  }

  const processRes = await fetch(TILOPAY_PROCESS, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${loginJson.access_token}`,
    },
    body: JSON.stringify({
      key,
      amount: options.amountUsd,
      currency: options.currency || 'USD',
      billToEmail: options.email,
      redirect: options.redirectUrl,
      capture: 1,
      orderNumber: options.orderNumber,
      description: options.description,
    }),
  })

  const processJson = (await processRes.json()) as {
    type?: string | number
    url?: string
    message?: string
    html?: string
  }

  if (!processRes.ok || !processJson.url) {
    return {
      ok: false,
      error: processJson.message || `TiloPay processPayment failed (${processRes.status})`,
    }
  }

  return {
    ok: true,
    checkoutUrl: processJson.url,
    orderNumber: options.orderNumber,
  }
}

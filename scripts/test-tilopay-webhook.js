/**
 * TiloPay Webhook Test Script
 * 
 * This script tests the webhook signature verification locally.
 * It simulates how TiloPay sends webhooks with HMAC-SHA256 signatures.
 * 
 * Usage:
 *   1. Set TILOPAY_WEBHOOK_SECRET in your .env.local
 *   2. Run: node scripts/test-tilopay-webhook.js
 *   3. (Optional) Start dev server and test against live endpoint
 */

import crypto from 'crypto'

// Configuration
const WEBHOOK_SECRET = process.env.TILOPAY_WEBHOOK_SECRET || 'test-secret-key-for-development'
const WEBHOOK_URL = 'http://localhost:3000/api/tilopay/webhook'

// Sample webhook payloads
const samplePayloads = {
  'payment.succeeded': {
    event: 'payment.succeeded',
    data: {
      id: 'pay_test_123456',
      customer_id: 'cus_test_789',
      subscription_id: 'sub_test_456',
      amount: 9900,
      currency: 'CRC',
      status: 'succeeded',
      metadata: {
        user_id: 'test-user-uuid-here',
        plan: 'starter'
      }
    },
    timestamp: new Date().toISOString()
  },
  'subscription.created': {
    event: 'subscription.created',
    data: {
      id: 'sub_test_456',
      customer_id: 'cus_test_789',
      status: 'active',
      metadata: {
        user_id: 'test-user-uuid-here',
        plan: 'starter'
      }
    },
    timestamp: new Date().toISOString()
  },
  'subscription.cancelled': {
    event: 'subscription.cancelled',
    data: {
      id: 'sub_test_456',
      status: 'cancelled'
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload, secret) {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString, 'utf8')
    .digest('hex')
}

/**
 * Verify signature matches expected
 */
function verifySignature(payload, providedHash, secret) {
  const expectedHash = generateSignature(payload, secret)
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHash, 'hex'),
      Buffer.from(providedHash, 'hex')
    )
  } catch {
    return false
  }
}

/**
 * Test signature generation and verification
 */
function testSignatureLogic() {
  console.log('\n=== Testing Signature Logic ===\n')
  
  const payload = samplePayloads['payment.succeeded']
  const payloadString = JSON.stringify(payload)
  
  console.log('Payload:', JSON.stringify(payload, null, 2))
  console.log('\nSecret:', WEBHOOK_SECRET)
  
  const signature = generateSignature(payloadString, WEBHOOK_SECRET)
  console.log('\nGenerated Signature:', signature)
  
  // Test valid signature
  const isValid = verifySignature(payloadString, signature, WEBHOOK_SECRET)
  console.log('\n✅ Valid signature test:', isValid ? 'PASSED' : 'FAILED')
  
  // Test invalid signature
  const isInvalid = verifySignature(payloadString, 'invalid-signature-here', WEBHOOK_SECRET)
  console.log('❌ Invalid signature test:', !isInvalid ? 'PASSED' : 'FAILED')
  
  // Test wrong secret
  const wrongSecret = verifySignature(payloadString, signature, 'wrong-secret')
  console.log('🔑 Wrong secret test:', !wrongSecret ? 'PASSED' : 'FAILED')
  
  return isValid && !isInvalid && !wrongSecret
}

/**
 * Send test webhook to local server
 */
async function sendTestWebhook(eventType) {
  const payload = samplePayloads[eventType]
  if (!payload) {
    console.error(`Unknown event type: ${eventType}`)
    return
  }
  
  const payloadString = JSON.stringify(payload)
  const signature = generateSignature(payloadString, WEBHOOK_SECRET)
  
  console.log(`\n=== Sending ${eventType} webhook ===`)
  console.log('URL:', WEBHOOK_URL)
  console.log('Signature:', signature)
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'hash-tilopay': signature
      },
      body: payloadString
    })
    
    const result = await response.json()
    console.log('Response status:', response.status)
    console.log('Response body:', result)
    
    return response.status === 200
  } catch (error) {
    console.error('Request failed:', error.message)
    console.log('\n💡 Make sure the dev server is running: npm run dev')
    return false
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('╔════════════════════════════════════════════╗')
  console.log('║     TiloPay Webhook Test Script            ║')
  console.log('╚════════════════════════════════════════════╝')
  
  // Test 1: Signature logic
  const signatureTestPassed = testSignatureLogic()
  
  if (!signatureTestPassed) {
    console.error('\n❌ Signature tests failed!')
    process.exit(1)
  }
  
  console.log('\n✅ All signature tests passed!')
  
  // Test 2: Send to local server (optional)
  const args = process.argv.slice(2)
  
  if (args.includes('--live')) {
    console.log('\n=== Live Webhook Tests ===')
    
    for (const eventType of Object.keys(samplePayloads)) {
      await sendTestWebhook(eventType)
      await new Promise(r => setTimeout(r, 500)) // Small delay between requests
    }
  } else {
    console.log('\n💡 To test against live server, run:')
    console.log('   node scripts/test-tilopay-webhook.js --live')
    console.log('\n   (Make sure dev server is running first)')
  }
  
  console.log('\n=== Test Complete ===\n')
}

main().catch(console.error)

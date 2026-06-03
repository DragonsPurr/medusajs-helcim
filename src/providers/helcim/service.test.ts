import { createHmac } from "crypto"
import { describe, expect, it, vi } from "vitest"
import {
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { buildHelcimPayHash } from "../../lib/build-helcim-pay-hash"
import type { HelcimClient } from "../../lib/helcim-client"
import {
  approvedPreauthTransaction,
  approvedPurchaseTransaction,
  declinedTransaction,
  sampleSecretToken,
} from "../../test/fixtures"
import HelcimPaymentProviderService from "./service"

function createMockClient(
  overrides: Partial<HelcimClient> = {}
): HelcimClient {
  return {
    initializeCheckout: vi.fn().mockResolvedValue({
      checkoutToken: "checkout-token-123",
      secretToken: "secret-token-456",
    }),
    getCardTransaction: vi.fn(),
    captureTransaction: vi.fn().mockResolvedValue({ captured: true }),
    refundTransaction: vi.fn().mockResolvedValue({ refunded: true }),
    reverseTransaction: vi.fn().mockResolvedValue({ reversed: true }),
    createCustomer: vi
      .fn()
      .mockResolvedValue({ customerCode: "CST1000" }),
    updateCustomer: vi.fn().mockResolvedValue({ customerCode: "CST1000" }),
    ...overrides,
  } as unknown as HelcimClient
}

function createProvider(
  client: HelcimClient,
  options: Record<string, unknown> = {}
) {
  return new HelcimPaymentProviderService(
    {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        panic: vi.fn(),
        shouldLog: vi.fn(),
        setLogLevel: vi.fn(),
        unsetLogLevel: vi.fn(),
        activity: vi.fn(),
        progress: vi.fn(),
        failure: vi.fn(),
        success: vi.fn(),
        log: vi.fn(),
      },
    },
    {
      apiToken: "test-token",
      ...options,
    },
    client
  )
}

describe("HelcimPaymentProviderService.validateOptions", () => {
  it("throws when apiToken is missing", () => {
    expect(() =>
      HelcimPaymentProviderService.validateOptions({ apiToken: "" })
    ).toThrow("requires `apiToken`")
  })
})

describe("HelcimPaymentProviderService.initiatePayment", () => {
  it("returns checkout tokens from Helcim initialize", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    const result = await provider.initiatePayment({
      amount: 99.99,
      currency_code: "cad",
      data: { session_id: "ps_01" },
      context: {},
    })

    expect(client.initializeCheckout).toHaveBeenCalledWith({
      amount: 99.99,
      currency: "CAD",
      paymentType: "purchase",
      paymentMethod: "cc",
      customerCode: undefined,
      idempotencyKey: undefined,
    })
    expect(result).toMatchObject({
      id: "checkout-token-123",
      status: PaymentSessionStatus.PENDING,
      data: {
        checkoutToken: "checkout-token-123",
        secretToken: "secret-token-456",
        amount: 99.99,
        currency: "CAD",
      },
    })
  })
})

describe("HelcimPaymentProviderService.updatePayment", () => {
  it("accepts helcimPayResponse with valid hash and marks purchase as captured", async () => {
    const client = createMockClient()
    const provider = createProvider(client)
    const hash = buildHelcimPayHash(
      approvedPurchaseTransaction,
      sampleSecretToken
    )

    const result = await provider.updatePayment({
      amount: 100,
      currency_code: "CAD",
      data: {
        secretToken: sampleSecretToken,
        helcimPayResponse: {
          hash,
          data: approvedPurchaseTransaction,
        },
      },
      context: {},
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(result.data).toMatchObject({
      transactionId: "44158194",
      status: "APPROVED",
    })
    expect(client.getCardTransaction).not.toHaveBeenCalled()
  })

  it("marks preauth as authorized", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    const result = await provider.updatePayment({
      amount: 100,
      currency_code: "CAD",
      data: {
        helcimPayResponse: { data: approvedPreauthTransaction },
      },
      context: {},
    })

    expect(result.status).toBe(PaymentSessionStatus.AUTHORIZED)
  })

  it("rejects invalid helcimPayResponse hash", async () => {
    const provider = createProvider(createMockClient())

    await expect(
      provider.updatePayment({
        amount: 100,
        currency_code: "CAD",
        data: {
          secretToken: sampleSecretToken,
          helcimPayResponse: {
            hash: "invalid-hash",
            data: approvedPurchaseTransaction,
          },
        },
        context: {},
      })
    ).rejects.toThrow(MedusaError)
  })

  it("re-initializes checkout when amount and currency change", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    const result = await provider.updatePayment({
      amount: 50,
      currency_code: "USD",
      data: { checkoutToken: "old-token" },
      context: {},
    })

    expect(client.initializeCheckout).toHaveBeenCalled()
    expect(result.data).toMatchObject({
      checkoutToken: "checkout-token-123",
      amount: 50,
      currency: "USD",
    })
  })
})

describe("HelcimPaymentProviderService.authorizePayment", () => {
  it("authorizes from embedded transaction without API call", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    const result = await provider.authorizePayment({
      data: { transaction: approvedPurchaseTransaction },
      context: {},
    })

    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
    expect(client.getCardTransaction).not.toHaveBeenCalled()
  })

  it("fetches transaction by id when not embedded", async () => {
    const client = createMockClient({
      getCardTransaction: vi
        .fn()
        .mockResolvedValue(approvedPurchaseTransaction),
    })
    const provider = createProvider(client)

    const result = await provider.authorizePayment({
      data: { transactionId: "44158194" },
      context: {},
    })

    expect(client.getCardTransaction).toHaveBeenCalledWith("44158194")
    expect(result.status).toBe(PaymentSessionStatus.CAPTURED)
  })

  it("returns error status for declined transactions", async () => {
    const provider = createProvider(
      createMockClient({
        getCardTransaction: vi.fn().mockResolvedValue(declinedTransaction),
      })
    )

    const result = await provider.authorizePayment({
      data: { transactionId: "44158196" },
      context: {},
    })

    expect(result.status).toBe(PaymentSessionStatus.ERROR)
  })
})

describe("HelcimPaymentProviderService.capturePayment", () => {
  it("skips capture API for purchase transactions", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    await provider.capturePayment({
      data: {
        paymentType: "purchase",
        transaction: approvedPurchaseTransaction,
      },
      context: {},
    })

    expect(client.captureTransaction).not.toHaveBeenCalled()
  })

  it("calls capture API for preauth transactions", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    const result = await provider.capturePayment({
      data: {
        paymentType: "preauth",
        transaction: approvedPreauthTransaction,
      },
      context: { idempotency_key: "cap-1" },
    })

    expect(client.captureTransaction).toHaveBeenCalledWith(
      "44158195",
      "cap-1"
    )
    expect(result.data).toMatchObject({ capture: { captured: true } })
  })
})

describe("HelcimPaymentProviderService.getWebhookActionAndData", () => {
  it("returns NOT_SUPPORTED for non cardTransaction events", async () => {
    const provider = createProvider(createMockClient())

    const result = await provider.getWebhookActionAndData({
      data: { type: "terminalCancel", id: "1" },
      rawData: "{}",
      headers: {},
    })

    expect(result.action).toBe(PaymentActions.NOT_SUPPORTED)
  })

  it("returns SUCCESSFUL for approved purchase webhook", async () => {
    const client = createMockClient({
      getCardTransaction: vi
        .fn()
        .mockResolvedValue(approvedPurchaseTransaction),
    })
    const provider = createProvider(client)

    const result = await provider.getWebhookActionAndData({
      data: { type: "cardTransaction", id: "44158194", session_id: "ps_1" },
      rawData: '{"id":"44158194","type":"cardTransaction"}',
      headers: {},
    })

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
    expect(result.data).toMatchObject({ session_id: "ps_1" })
  })

  it("returns AUTHORIZED for approved preauth webhook", async () => {
    const provider = createProvider(
      createMockClient({
        getCardTransaction: vi
          .fn()
          .mockResolvedValue(approvedPreauthTransaction),
      })
    )

    const result = await provider.getWebhookActionAndData({
      data: { type: "cardTransaction", id: "44158195" },
      rawData: "{}",
      headers: {},
    })

    expect(result.action).toBe(PaymentActions.AUTHORIZED)
  })

  it("rejects webhooks with invalid signature when verifier token is set", async () => {
    const provider = createProvider(createMockClient(), {
      webhookVerifierToken: Buffer.from("verifier-secret").toString("base64"),
    })

    await expect(
      provider.getWebhookActionAndData({
        data: { type: "cardTransaction", id: "1" },
        rawData: '{"id":"1","type":"cardTransaction"}',
        headers: {
          "webhook-id": "msg_1",
          "webhook-timestamp": "1716412291",
          "webhook-signature": "v1,invalid",
        },
      })
    ).rejects.toThrow("Invalid Helcim webhook signature")
  })

  it("accepts webhooks with valid signature", async () => {
    const verifierSecret = "verifier-secret"
    const verifierToken = Buffer.from(verifierSecret).toString("base64")
    const webhookId = "msg_test"
    const webhookTimestamp = "1716412291"
    const rawData = '{"id":"44158194","type":"cardTransaction"}'
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawData}`
    const signature = createHmac("sha256", Buffer.from(verifierToken, "base64"))
      .update(signedContent)
      .digest("base64")

    const client = createMockClient({
      getCardTransaction: vi
        .fn()
        .mockResolvedValue(approvedPurchaseTransaction),
    })
    const provider = createProvider(client, { webhookVerifierToken: verifierToken })

    const result = await provider.getWebhookActionAndData({
      data: { type: "cardTransaction", id: "44158194" },
      rawData,
      headers: {
        "webhook-id": webhookId,
        "webhook-timestamp": webhookTimestamp,
        "webhook-signature": `v1,${signature}`,
      },
    })

    expect(result.action).toBe(PaymentActions.SUCCESSFUL)
  })
})

describe("HelcimPaymentProviderService.refundPayment", () => {
  it("calls Helcim refund with transaction id and amount", async () => {
    const client = createMockClient()
    const provider = createProvider(client)

    await provider.refundPayment({
      amount: 25,
      data: { transactionId: "44158194", currency: "CAD" },
      context: { idempotency_key: "ref-1" },
    })

    expect(client.refundTransaction).toHaveBeenCalledWith(
      "44158194",
      25,
      "ref-1"
    )
  })

  it("throws when transaction id is missing", async () => {
    const provider = createProvider(createMockClient())

    await expect(
      provider.refundPayment({
        amount: 10,
        data: {},
        context: {},
      })
    ).rejects.toThrow("Cannot refund Helcim payment")
  })
})

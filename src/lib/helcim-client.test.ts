import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HelcimClient } from "./helcim-client"

describe("HelcimClient", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  function mockJsonResponse(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })
  }

  it("uses sandbox base URL when testMode is true", async () => {
    mockJsonResponse({
      checkoutToken: "checkout-token",
      secretToken: "secret-token",
    })

    const client = new HelcimClient({
      apiToken: "test-api-token",
      testMode: true,
    })

    await client.initializeCheckout({
      amount: 10,
      currency: "CAD",
      paymentType: "purchase",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.helcim.test/v2/helcim-pay/initialize",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "api-token": "test-api-token",
          "Content-Type": "application/json",
        }),
      })
    )
  })

  it("uses production base URL when testMode is false", async () => {
    mockJsonResponse({
      checkoutToken: "checkout-token",
      secretToken: "secret-token",
    })

    const client = new HelcimClient({
      apiToken: "prod-token",
      testMode: false,
    })

    await client.initializeCheckout({
      amount: 25.5,
      currency: "USD",
      paymentType: "preauth",
      paymentMethod: "cc-ach",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.helcim.com/v2/helcim-pay/initialize",
      expect.any(Object)
    )

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({
      paymentType: "preauth",
      amount: 25.5,
      currency: "USD",
      paymentMethod: "cc-ach",
    })
  })

  it("throws with Helcim error messages on failure", async () => {
    mockJsonResponse({ errors: ["Invalid token"] }, 401)

    const client = new HelcimClient({ apiToken: "bad-token" })

    await expect(
      client.initializeCheckout({
        amount: 1,
        currency: "CAD",
        paymentType: "purchase",
      })
    ).rejects.toThrow("Invalid token")
  })

  it("normalizes getCardTransaction response", async () => {
    mockJsonResponse({
      transactionId: 44158194,
      amount: 100,
      status: "APPROVED",
      type: "purchase",
      currency: "CAD",
    })

    const client = new HelcimClient({ apiToken: "token" })
    const tx = await client.getCardTransaction("44158194")

    expect(tx.transactionId).toBe("44158194")
    expect(tx.amount).toBe("100")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.helcim.com/v2/card-transactions/44158194",
      expect.objectContaining({ method: "GET" })
    )
  })

  it("sends refund payload with cardTransactionId and amount", async () => {
    mockJsonResponse({ status: "APPROVED" })

    const client = new HelcimClient({ apiToken: "token" })
    await client.refundTransaction("99", 10.5, "idempotency-key-1")

    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({
      "idempotency-key": "idempotency-key-1",
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({ cardTransactionId: 99, amount: 10.5 })
  })
})

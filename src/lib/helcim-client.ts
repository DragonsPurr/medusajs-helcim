import { randomUUID } from "crypto"
import type {
  HelcimApiError,
  HelcimInitializeResponse,
  HelcimOptions,
  HelcimPaymentMethod,
  HelcimPaymentType,
  HelcimTransactionResponse,
} from "./types"

const PRODUCTION_BASE = "https://api.helcim.com/v2"
const SANDBOX_BASE = "https://api.helcim.test/v2"

export class HelcimClient {
  private readonly baseUrl: string
  private readonly apiToken: string

  constructor(options: HelcimOptions) {
    this.apiToken = options.apiToken
    this.baseUrl = options.testMode ? SANDBOX_BASE : PRODUCTION_BASE
  }

  async initializeCheckout(params: {
    amount: number
    currency: "CAD" | "USD"
    paymentType: HelcimPaymentType
    paymentMethod?: HelcimPaymentMethod
    customerCode?: string
    invoiceNumber?: string
    idempotencyKey?: string
  }): Promise<HelcimInitializeResponse> {
    const body: Record<string, unknown> = {
      paymentType: params.paymentType,
      amount: params.amount,
      currency: params.currency,
      paymentMethod: params.paymentMethod ?? "cc",
    }

    if (params.customerCode) {
      body.customerCode = params.customerCode
    }
    if (params.invoiceNumber) {
      body.invoiceNumber = params.invoiceNumber
    }

    return this.request<HelcimInitializeResponse>("/helcim-pay/initialize", {
      method: "POST",
      body,
      idempotencyKey: params.idempotencyKey,
    })
  }

  async getCardTransaction(
    transactionId: string
  ): Promise<HelcimTransactionResponse> {
    const response = await this.request<
      HelcimTransactionResponse & { transactionId?: number | string; amount?: number | string }
    >(`/card-transactions/${transactionId}`, { method: "GET" })

    return {
      ...response,
      transactionId: String(response.transactionId ?? transactionId),
      amount: String(response.amount ?? ""),
    }
  }

  async captureTransaction(
    transactionId: string,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    return this.request("/payment/capture", {
      method: "POST",
      body: { cardTransactionId: Number(transactionId) },
      idempotencyKey,
    })
  }

  async refundTransaction(
    transactionId: string,
    amount: number,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    return this.request("/payment/refund", {
      method: "POST",
      body: {
        cardTransactionId: Number(transactionId),
        amount,
      },
      idempotencyKey,
    })
  }

  async reverseTransaction(
    transactionId: string,
    idempotencyKey?: string
  ): Promise<Record<string, unknown>> {
    return this.request("/payment/reverse", {
      method: "POST",
      body: { cardTransactionId: Number(transactionId) },
      idempotencyKey,
    })
  }

  async createCustomer(params: {
    contactName: string
    businessName?: string
    email?: string
    idempotencyKey?: string
  }): Promise<{ customerCode: string } & Record<string, unknown>> {
    return this.request("/customers/", {
      method: "POST",
      body: {
        contactName: params.contactName,
        businessName: params.businessName,
      },
      idempotencyKey: params.idempotencyKey,
    })
  }

  async updateCustomer(
    customerCode: string,
    params: {
      contactName?: string
      email?: string
      idempotencyKey?: string
    }
  ): Promise<Record<string, unknown>> {
    return this.request(`/customers/${customerCode}`, {
      method: "PATCH",
      body: {
        contactName: params.contactName,
      },
      idempotencyKey: params.idempotencyKey,
    })
  }

  private async request<T>(
    path: string,
    init: {
      method: "GET" | "POST" | "PATCH"
      body?: Record<string, unknown>
      idempotencyKey?: string
    }
  ): Promise<T> {
    const headers: Record<string, string> = {
      "api-token": this.apiToken,
      Accept: "application/json",
    }

    if (init.body) {
      headers["Content-Type"] = "application/json"
    }

    if (init.idempotencyKey) {
      headers["idempotency-key"] = init.idempotencyKey
    } else if (init.method === "POST") {
      headers["idempotency-key"] = randomUUID()
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    const text = await response.text()
    let payload: T & HelcimApiError

    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(
        `Helcim API returned invalid JSON (${response.status}): ${text}`
      )
    }

    if (!response.ok) {
      const message =
        payload.errors?.join(", ") ??
        payload.message ??
        `Helcim API error (${response.status})`
      throw new Error(message)
    }

    return payload as T
  }
}

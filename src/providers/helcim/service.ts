import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CreateAccountHolderInput,
  CreateAccountHolderOutput,
  DeleteAccountHolderInput,
  DeleteAccountHolderOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ListPaymentMethodsInput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdateAccountHolderInput,
  UpdateAccountHolderOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
  isDefined,
} from "@medusajs/framework/utils"
import { createHmac, timingSafeEqual } from "crypto"
import { HelcimClient } from "../../lib/helcim-client"
import { helcimCurrency, toHelcimAmount } from "../../lib/amount"
import { validateHelcimPayHash } from "../../lib/validate-hash"
import type {
  HelcimOptions,
  HelcimPayEventMessage,
  HelcimTransactionResponse,
} from "../../lib/types"

type InjectedDependencies = {
  logger: Logger
}

type HelcimPaymentData = {
  checkoutToken?: string
  secretToken?: string
  paymentType?: string
  amount?: number
  currency?: string
  transactionId?: string
  transaction?: HelcimTransactionResponse
  hash?: string
  id?: string
}

const APPROVED_STATUSES = new Set(["APPROVED", "APPROVAL"])

class HelcimPaymentProviderService extends AbstractPaymentProvider<HelcimOptions> {
  static override identifier = "helcim"

  protected readonly logger_: Logger
  protected readonly options_: HelcimOptions
  protected readonly client_: HelcimClient

  static override validateOptions(options: HelcimOptions): void {
    if (!isDefined(options.apiToken) || !options.apiToken) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Helcim payment provider requires `apiToken` in options."
      )
    }
  }

  constructor(
    container: InjectedDependencies,
    options: HelcimOptions,
    client?: HelcimClient
  ) {
    super(container, options)

    this.logger_ = container.logger
    this.options_ = {
      paymentType: "purchase",
      paymentMethod: "cc",
      ...options,
    }
    this.client_ = client ?? new HelcimClient(this.options_)
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const currency = helcimCurrency(input.currency_code)
    const amount = toHelcimAmount(input.amount)
    const paymentType = this.options_.paymentType ?? "purchase"

    const checkout = await this.client_.initializeCheckout({
      amount,
      currency,
      paymentType,
      paymentMethod: this.options_.paymentMethod,
      customerCode: input.context?.account_holder?.data?.customerCode as
        | string
        | undefined,
      idempotencyKey: input.context?.idempotency_key,
    })

    return {
      id: checkout.checkoutToken,
      status: PaymentSessionStatus.PENDING,
      data: {
        checkoutToken: checkout.checkoutToken,
        secretToken: checkout.secretToken,
        paymentType,
        amount,
        currency,
        session_id: input.data?.session_id,
      },
    }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const transaction = await this.resolveTransaction(input.data)
    const status = this.mapTransactionToSessionStatus(transaction)

    if (status !== PaymentSessionStatus.AUTHORIZED) {
      return {
        status,
        data: this.buildPaymentData(input.data, transaction),
      }
    }

    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: this.buildPaymentData(input.data, transaction),
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const data = input.data as HelcimPaymentData
    const transaction = await this.resolveTransaction(data)
    const paymentType =
      data.paymentType ?? transaction.type ?? this.options_.paymentType

    if (paymentType === "purchase" || transaction.type === "purchase") {
      return { data: this.buildPaymentData(data, transaction) }
    }

    const transactionId = transaction.transactionId ?? data.transactionId
    if (!transactionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot capture Helcim payment without a transaction id."
      )
    }

    const captureResult = await this.client_.captureTransaction(
      transactionId,
      input.context?.idempotency_key
    )

    return {
      data: {
        ...this.buildPaymentData(data, transaction),
        capture: captureResult,
      },
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const data = input.data as HelcimPaymentData
    const transactionId = data.transactionId ?? data.transaction?.transactionId

    if (!transactionId) {
      return { data: input.data ?? {} }
    }

    try {
      const result = await this.client_.reverseTransaction(
        transactionId,
        input.context?.idempotency_key
      )
      return { data: { ...data, reverse: result } }
    } catch (error) {
      this.logger_.warn(
        `Helcim reverse failed for transaction ${transactionId}: ${(error as Error).message}`
      )
      return { data: input.data ?? {} }
    }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data ?? {} }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    try {
      const transaction = await this.resolveTransaction(input.data, false)
      return {
        status: this.mapTransactionToSessionStatus(transaction),
        data: this.buildPaymentData(input.data, transaction),
      }
    } catch {
      return { status: PaymentSessionStatus.PENDING }
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = input.data as HelcimPaymentData
    const transactionId = data.transactionId ?? data.transaction?.transactionId

    if (!transactionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot refund Helcim payment without a transaction id."
      )
    }

    const amount = toHelcimAmount(input.amount)
    await this.client_.refundTransaction(
      transactionId,
      amount,
      input.context?.idempotency_key
    )

    return { data: input.data ?? {} }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const transaction = await this.resolveTransaction(input.data)
    return { data: this.buildPaymentData(input.data, transaction) }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const existing = (input.data ?? {}) as HelcimPaymentData
    const helcimResponse = input.data?.helcimPayResponse as
      | HelcimPayEventMessage
      | undefined

    if (helcimResponse?.data) {
      const secretToken = existing.secretToken
      const hash = helcimResponse.hash ?? (input.data?.hash as string | undefined)

      if (secretToken && hash) {
        const valid = validateHelcimPayHash(
          helcimResponse.data,
          secretToken,
          hash
        )
        if (!valid) {
          throw new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "HelcimPay transaction hash validation failed."
          )
        }
      }

      const merged: HelcimPaymentData = {
        ...existing,
        transaction: helcimResponse.data,
        transactionId: helcimResponse.data.transactionId,
        hash,
      }

      return {
        status: this.mapTransactionToSessionStatus(helcimResponse.data),
        data: this.buildPaymentData(merged, helcimResponse.data),
      }
    }

    if (isDefined(input.amount) && isDefined(input.currency_code)) {
      const currency = helcimCurrency(input.currency_code)
      const amount = toHelcimAmount(input.amount)
      const paymentType = existing.paymentType ?? this.options_.paymentType ?? "purchase"

      const checkout = await this.client_.initializeCheckout({
        amount,
        currency,
        paymentType: paymentType as "purchase" | "preauth" | "verify",
        paymentMethod: this.options_.paymentMethod,
        idempotencyKey: input.context?.idempotency_key,
      })

      return {
        status: PaymentSessionStatus.PENDING,
        data: {
          ...existing,
          checkoutToken: checkout.checkoutToken,
          secretToken: checkout.secretToken,
          amount,
          currency,
          paymentType,
        },
      }
    }

    return {
      status: PaymentSessionStatus.PENDING,
      data: existing,
    }
  }

  async createAccountHolder(
    input: CreateAccountHolderInput
  ): Promise<CreateAccountHolderOutput> {
    const { account_holder, customer } = input.context

    if (account_holder?.data?.customerCode) {
      return {
        id: account_holder.data.customerCode as string,
        data: account_holder.data as Record<string, unknown>,
      }
    }

    if (!customer?.email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Customer email is required to create a Helcim account holder."
      )
    }

    const contactName =
      [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
      customer.email

    const response = await this.client_.createCustomer({
      contactName,
      businessName: customer.company_name ?? undefined,
      email: customer.email,
      idempotencyKey: input.context.idempotency_key,
    })

    return {
      id: response.customerCode,
      data: response as unknown as Record<string, unknown>,
    }
  }

  async deleteAccountHolder(
    _input: DeleteAccountHolderInput
  ): Promise<DeleteAccountHolderOutput> {
    return {}
  }

  async updateAccountHolder(
    input: UpdateAccountHolderInput
  ): Promise<UpdateAccountHolderOutput> {
    const customerCode = input.context.account_holder?.data?.customerCode as
      | string
      | undefined

    if (!customerCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing Helcim customer code on account holder."
      )
    }

    const customer = input.context.customer
    const contactName = customer
      ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
      : undefined

    const response = await this.client_.updateCustomer(customerCode, {
      contactName: contactName || undefined,
      email: customer?.email,
    })

    return {
      data: {
        customerCode,
        ...response,
      },
    }
  }

  async listPaymentMethods(_input: ListPaymentMethodsInput) {
    return []
  }

  async savePaymentMethod(): Promise<never> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Saving payment methods is not supported by the Helcim Medusa provider."
    )
  }

  async retrieveAccountHolder(): Promise<never> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "retrieveAccountHolder is not implemented for Helcim."
    )
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    if (
      !this.verifyWebhookSignature(
        payload.headers ?? {},
        payload.rawData ?? ""
      )
    ) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Invalid Helcim webhook signature."
      )
    }

    const body = payload.data as {
      id?: string
      type?: string
    }

    if (body?.type !== "cardTransaction" || !body.id) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    try {
      const transaction = await this.client_.getCardTransaction(body.id)
      const sessionId = payload.data?.session_id as string | undefined
      const amount = new BigNumber(transaction.amount)

      if (APPROVED_STATUSES.has(transaction.status)) {
        if (transaction.type === "preauth") {
          return {
            action: PaymentActions.AUTHORIZED,
            data: {
              session_id: sessionId ?? "",
              amount,
            },
          }
        }

        return {
          action: PaymentActions.SUCCESSFUL,
          data: {
            session_id: sessionId ?? "",
            amount,
          },
        }
      }

      return {
        action: PaymentActions.FAILED,
        data: {
          session_id: sessionId ?? "",
          amount,
        },
      }
    } catch (error) {
      this.logger_.error(
        `Helcim webhook processing failed: ${(error as Error).message}`
      )
      return { action: PaymentActions.FAILED }
    }
  }

  protected verifyWebhookSignature(
    headers: Record<string, unknown>,
    rawData: string | Buffer
  ): boolean {
    const verifierToken = this.options_.webhookVerifierToken
    if (!verifierToken) {
      return true
    }

    const webhookId = headers["webhook-id"] as string | undefined
    const webhookTimestamp = headers["webhook-timestamp"] as string | undefined
    const webhookSignature = headers["webhook-signature"] as string | undefined

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return false
    }

    const body =
      typeof rawData === "string" ? rawData : rawData.toString("utf8")
    const signedContent = `${webhookId}.${webhookTimestamp}.${body}`
    const verifierTokenBytes = Buffer.from(verifierToken, "base64")
    const expected = createHmac("sha256", verifierTokenBytes)
      .update(signedContent)
      .digest("base64")

    const signatures = webhookSignature.split(" ")
    for (const entry of signatures) {
      const [, sig] = entry.split(",")
      if (!sig) {
        continue
      }
      try {
        const a = Buffer.from(sig)
        const b = Buffer.from(expected)
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return true
        }
      } catch {
        continue
      }
    }

    return false
  }

  protected async resolveTransaction(
    data?: Record<string, unknown>,
    fetchIfMissing = true
  ): Promise<HelcimTransactionResponse> {
    const paymentData = (data ?? {}) as HelcimPaymentData

    if (paymentData.transaction) {
      return paymentData.transaction
    }

    const transactionId = paymentData.transactionId ?? paymentData.id
    if (!transactionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Helcim payment session is missing transaction data. Complete HelcimPay.js checkout and update the payment session first."
      )
    }

    if (!fetchIfMissing) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Transaction not available locally."
      )
    }

    return this.client_.getCardTransaction(String(transactionId))
  }

  protected mapTransactionToSessionStatus(
    transaction: HelcimTransactionResponse
  ): PaymentSessionStatus {
    if (APPROVED_STATUSES.has(transaction.status)) {
      if (transaction.type === "preauth") {
        return PaymentSessionStatus.AUTHORIZED
      }
      return PaymentSessionStatus.CAPTURED
    }

    if (
      transaction.statusAuth === "PENDING" ||
      transaction.statusClearing === "OPENED"
    ) {
      return PaymentSessionStatus.PENDING
    }

    return PaymentSessionStatus.ERROR
  }

  protected buildPaymentData(
    existing: Record<string, unknown> | undefined,
    transaction: HelcimTransactionResponse
  ): Record<string, unknown> {
    const base = (existing ?? {}) as HelcimPaymentData
    return {
      ...base,
      id: transaction.transactionId,
      transactionId: transaction.transactionId,
      transaction,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      type: transaction.type,
    }
  }
}

export default HelcimPaymentProviderService

export type HelcimPaymentType = "purchase" | "preauth" | "verify"

export type HelcimPaymentMethod = "cc" | "ach" | "cc-ach"

export type HelcimOptions = {
  /**
   * Helcim API Access Token from your API Access Configuration.
   * @see https://devdocs.helcim.com/docs/creating-an-api-access-configuration
   */
  apiToken: string
  /**
   * Use the Helcim sandbox API (`api.helcim.test`).
   */
  testMode?: boolean
  /**
   * HelcimPay.js payment type. Defaults to `purchase` (capture on approval).
   */
  paymentType?: HelcimPaymentType
  /**
   * Payment methods shown in the HelcimPay modal. Defaults to `cc`.
   */
  paymentMethod?: HelcimPaymentMethod
  /**
   * Base64 verifier token from Helcim webhook settings (optional).
   */
  webhookVerifierToken?: string
}

export type HelcimInitializeResponse = {
  checkoutToken: string
  secretToken: string
}

export type HelcimTransactionResponse = {
  transactionId: string
  dateCreated?: string
  cardBatchId?: string
  status: string
  type: string
  amount: string
  currency: string
  avsResponse?: string
  cvvResponse?: string
  approvalCode?: string
  cardToken?: string
  cardNumber?: string
  cardHolderName?: string
  cardType?: string
  customerCode?: string
  invoiceNumber?: string
  warning?: string
  statusAuth?: string
  statusClearing?: string
}

export type HelcimPayEventMessage = {
  hash?: string
  data?: HelcimTransactionResponse
}

export type HelcimCardTransactionWebhook = {
  id: string
  type: "cardTransaction"
}

export type HelcimApiError = {
  errors?: string[]
  message?: string
}

import type { HelcimTransactionResponse } from "../lib/types"

export const sampleSecretToken = "sample-secret"

export const approvedPurchaseTransaction: HelcimTransactionResponse = {
  transactionId: "44158194",
  dateCreated: "2026-02-04 11:40:21",
  cardBatchId: "6005228",
  status: "APPROVED",
  type: "purchase",
  amount: "100",
  currency: "CAD",
  avsResponse: "X",
  cvvResponse: "M",
  approvalCode: "T3E3ST",
  cardToken: "LFEY40ReTNOXkBu0y9LDDA",
  cardNumber: "5454545454",
  cardHolderName: "Helcim Test",
  cardType: "MC",
  customerCode: "CST65559",
  invoiceNumber: "INV100101",
  warning: "",
}

export const approvedPreauthTransaction: HelcimTransactionResponse = {
  ...approvedPurchaseTransaction,
  transactionId: "44158195",
  type: "preauth",
}

export const declinedTransaction: HelcimTransactionResponse = {
  ...approvedPurchaseTransaction,
  transactionId: "44158196",
  status: "DECLINED",
}

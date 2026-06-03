import { describe, expect, it } from "vitest"
import { buildHelcimPayHash } from "./build-helcim-pay-hash"
import { validateHelcimPayHash } from "./validate-hash"
import {
  approvedPurchaseTransaction,
  sampleSecretToken,
} from "../test/fixtures"

describe("validateHelcimPayHash", () => {
  it("returns true when hash matches transaction data and secret", () => {
    const hash = buildHelcimPayHash(
      approvedPurchaseTransaction,
      sampleSecretToken
    )

    expect(
      validateHelcimPayHash(
        approvedPurchaseTransaction,
        sampleSecretToken,
        hash
      )
    ).toBe(true)
  })

  it("returns false for wrong hash", () => {
    expect(
      validateHelcimPayHash(
        approvedPurchaseTransaction,
        sampleSecretToken,
        "deadbeef"
      )
    ).toBe(false)
  })

  it("returns false when secret token differs", () => {
    const hash = buildHelcimPayHash(
      approvedPurchaseTransaction,
      sampleSecretToken
    )

    expect(
      validateHelcimPayHash(approvedPurchaseTransaction, "other-secret", hash)
    ).toBe(false)
  })

  it("validates hash when payload is parsed from compact JSON (HelcimPay event shape)", () => {
    const compactJson =
      '{"amount":"1234","approvalCode":"T355ST","avsResponse":"X","cardBatchId":"123456789","cardHolderName":"John Smith","cardType":"MC","cardNumber":"4000000028","cardToken":"abcdefghijkl1234567890","currency":"CAD","customerCode":"CST1234","cvvResponse":"","dateCreated":"2025-01-01 11:11:11","invoiceNumber":"INV1234","status":"APPROVAL","transactionId":"123456789","type":"purchase","warning":""}'
    const transactionData = JSON.parse(compactJson)
    const hash = buildHelcimPayHash(transactionData, sampleSecretToken)

    expect(validateHelcimPayHash(transactionData, sampleSecretToken, hash)).toBe(
      true
    )
  })
})

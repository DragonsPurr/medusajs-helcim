import { createHash } from "crypto"
import type { HelcimTransactionResponse } from "./types"

/**
 * Validates the HelcimPay.js transaction response hash.
 * @see https://devdocs.helcim.com/docs/validate-helcimpayjs
 */
export function validateHelcimPayHash(
  transactionData: HelcimTransactionResponse,
  secretToken: string,
  hash: string
): boolean {
  const cleanedJson = JSON.stringify(transactionData)
  const computed = createHash("sha256")
    .update(cleanedJson + secretToken)
    .digest("hex")

  return computed === hash
}

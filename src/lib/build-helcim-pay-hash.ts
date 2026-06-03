import { createHash } from "crypto"
import type { HelcimTransactionResponse } from "./types"

/**
 * Builds the HelcimPay.js response hash (for validation and tests).
 * @see https://devdocs.helcim.com/docs/validate-helcimpayjs
 */
export function buildHelcimPayHash(
  transactionData: HelcimTransactionResponse,
  secretToken: string
): string {
  const cleanedJson = JSON.stringify(transactionData)
  return createHash("sha256")
    .update(cleanedJson + secretToken)
    .digest("hex")
}

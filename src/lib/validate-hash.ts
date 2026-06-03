import type { HelcimTransactionResponse } from "./types"
import { buildHelcimPayHash } from "./build-helcim-pay-hash"

/**
 * Validates the HelcimPay.js transaction response hash.
 * @see https://devdocs.helcim.com/docs/validate-helcimpayjs
 */
export function validateHelcimPayHash(
  transactionData: HelcimTransactionResponse,
  secretToken: string,
  hash: string
): boolean {
  return buildHelcimPayHash(transactionData, secretToken) === hash
}

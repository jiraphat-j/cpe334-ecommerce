/**
 * Order Quantity Validation Logic (Issue #26)
 * Fixed: Explicitly validates integer quantities >= 1 and rejects 0, negatives, or non-numeric values
 */
export function parseAndValidateQuantity(inputValue: any): { valid: boolean; quantity?: number; error?: string } {
  if (inputValue === undefined || inputValue === null || inputValue === "") {
    return { valid: false, error: "Quantity must be at least 1." };
  }
  const parsed = typeof inputValue === "number" ? inputValue : Number(inputValue);
  if (isNaN(parsed)) {
    return { valid: false, error: "Quantity must be a valid number." };
  }
  if (!Number.isInteger(parsed)) {
    return { valid: false, error: "Quantity must be an integer." };
  }
  if (parsed <= 0) {
    return { valid: false, error: "Quantity must be at least 1." };
  }
  return { valid: true, quantity: parsed };
}

/**
 * Order Quantity Validation Logic (Issue #26)
 * Initial state: Demonstrates the reported defective behavior in App.tsx (parseInt(val) || 1)
 */
export function parseAndValidateQuantity(inputValue: any): { valid: boolean; quantity: number; error?: string } {
  // Existing defective behavior from App.tsx:
  const qty = parseInt(inputValue, 10) || 1;
  return { valid: true, quantity: qty };
}

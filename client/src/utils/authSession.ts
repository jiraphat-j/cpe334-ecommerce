export interface UserSessionState {
  currentUser: { id: string; email: string; role: "CUSTOMER" | "OPERATOR" } | null;
  token: string;
  activeTab: "catalog" | "my-orders" | "operator";
  myOrders: any[];
  operatorOrders: any[];
}

/**
 * Clean unauthenticated initial state (Guest mode)
 * Security rule: Guest users start with no elevated privilege or order history.
 */
export function getInitialAuthState(): UserSessionState {
  return {
    currentUser: null,
    token: "",
    activeTab: "catalog",
    myOrders: [],
    operatorOrders: [],
  };
}

/**
 * Security policy check: Never auto-login as privileged operator on initial load
 */
export function shouldAutoLoginPrivilegedOnLoad(): boolean {
  return false;
}

/**
 * Resets all session state, tokens, and cached orders upon logout
 */
export function resetSessionOnLogout(state: UserSessionState): UserSessionState {
  return {
    ...state,
    currentUser: null,
    token: "",
    activeTab: "catalog",
    myOrders: [],
    operatorOrders: [],
  };
}

/**
 * Purges prior user's orders from memory when switching accounts
 */
export function clearOrdersOnAccountSwitch<T extends { myOrders: any[]; operatorOrders: any[] }>(state: T): T {
  return {
    ...state,
    myOrders: [],
    operatorOrders: [],
  };
}

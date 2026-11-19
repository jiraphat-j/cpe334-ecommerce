export interface UserSessionState {
  currentUser: { id: string; email: string; role: "CUSTOMER" | "OPERATOR" } | null;
  token: string;
  activeTab: "catalog" | "my-orders" | "operator";
  myOrders: any[];
  operatorOrders: any[];
}

/**
 * Baseline representing current defective behavior in App.tsx prior to Issue #27 fix
 */
export function getInitialAuthState(): UserSessionState {
  // Defect: App.tsx automatically logged in operator on mount
  return {
    currentUser: { id: "op-1", email: "operator@store.com", role: "OPERATOR" },
    token: "mock-operator-token",
    activeTab: "operator",
    myOrders: [],
    operatorOrders: [],
  };
}

export function shouldAutoLoginPrivilegedOnLoad(): boolean {
  // Defect: useEffect called loginAs("operator@store.com", "OPERATOR")
  return true;
}

export function resetSessionOnLogout(state: UserSessionState): UserSessionState {
  // Defect: App.tsx only cleared currentUser and token, leaking orders
  return {
    ...state,
    currentUser: null,
    token: "",
  };
}

export function clearOrdersOnAccountSwitch<T extends { myOrders: any[]; operatorOrders: any[] }>(state: T): T {
  // Defect: App.tsx did not reset myOrders when logging in as another user
  return state;
}

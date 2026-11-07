import React, { useState, useEffect } from "react";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
}

interface OrderItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  product: Product;
}

interface Order {
  id: string;
  customer_id: string;
  status: "PENDING" | "CONFIRMED" | "SHIPPED" | "CANCELLED";
  total_amount: number;
  created_at: string;
  customer?: { id: string; email: string };
  items: OrderItem[];
}

interface User {
  id: string;
  email: string;
  role: "CUSTOMER" | "OPERATOR";
}

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"catalog" | "my-orders" | "operator">("catalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [operatorOrders, setOperatorOrders] = useState<Order[]>([]);
  const [orderQuantity, setOrderQuantity] = useState<{ [productId: string]: number }>({});
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Quick switch role login for demo
  const loginAs = async (email: string, role: "CUSTOMER" | "OPERATOR") => {
    setMessage(null);
    setLoading(true);
    try {
      const password = role === "OPERATOR" ? "OperatorPass123!" : "CustomerPass123!";
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToken(data.data.token);
        setCurrentUser(data.data.user);
        setMessage({ text: `Logged in as ${data.data.user.email} (${data.data.user.role})`, type: "success" });
        if (role === "OPERATOR") {
          setActiveTab("operator");
        } else {
          setActiveTab("catalog");
        }
      } else {
        setMessage({ text: data.error?.message || "Login failed", type: "error" });
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Network error", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Fetch product catalog (AC-04)
  const loadProducts = async () => {
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (data.success) {
        setProducts(data.data.products);
      }
    } catch (err) {
      console.error("Failed to load products:", err);
    }
  };

  // Fetch my orders (AC-07)
  const loadMyOrders = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/orders/my-orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setMyOrders(data.data.orders);
      }
    } catch (err) {
      console.error("Failed to load my orders:", err);
    }
  };

  // Fetch all orders for Operator (AC-08)
  const loadOperatorOrders = async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/operator/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setOperatorOrders(data.data.orders);
      } else {
        setMessage({ text: data.error?.message || "Failed to fetch operator orders", type: "error" });
      }
    } catch (err) {
      console.error("Failed to load operator orders:", err);
    }
  };

  useEffect(() => {
    loadProducts();
    // Default login as Operator to showcase Issue #4
    loginAs("operator@store.com", "OPERATOR");
  }, []);

  useEffect(() => {
    if (activeTab === "catalog") loadProducts();
    if (activeTab === "my-orders") loadMyOrders();
    if (activeTab === "operator") loadOperatorOrders();
  }, [activeTab, token]);

  // Customer: Place order (AC-05, AC-06)
  const handlePlaceOrder = async (productId: string) => {
    if (!token) {
      setMessage({ text: "Please log in to place an order.", type: "error" });
      return;
    }
    const qty = orderQuantity[productId] || 1;
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ productId, quantity: qty }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          text: `🎉 Order placed successfully! Order ID: ${data.data.order.id}. Stock decremented by ${qty}.`,
          type: "success",
        });
        await loadProducts();
      } else {
        setMessage({
          text: `❌ Order rejected: ${data.error?.message || "Unknown error"}`,
          type: "error",
        });
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to place order", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // Operator: Update order status (AC-09, AC-10)
  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    if (!token) return;
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/operator/orders/${orderId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ text: `✅ Order ${orderId} successfully updated to ${newStatus}`, type: "success" });
        await loadOperatorOrders();
      } else {
        setMessage({ text: `❌ Status update failed: ${data.error?.message || "Unknown error"}`, type: "error" });
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Network error", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      {/* Header with User Info and Quick Switcher */}
      <header className="header">
        <div>
          <h1 className="header-title">🛒 CPE 334 E-Commerce System</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Sprint 1: Issue #4 - Operator Order Management & Status Transitions
          </p>
        </div>
        <div className="auth-bar">
          {currentUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "0.9rem" }}>{currentUser.email}</span>
              <span className={`badge ${currentUser.role === "OPERATOR" ? "badge-operator" : "badge-customer"}`}>
                {currentUser.role}
              </span>
            </div>
          ) : (
            <span>Not logged in</span>
          )}
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              className="btn btn-secondary"
              onClick={() => loginAs("operator@store.com", "OPERATOR")}
              disabled={loading}
            >
              Login Operator
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => loginAs("alice@customer.com", "CUSTOMER")}
              disabled={loading}
            >
              Login Alice (Customer)
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        {currentUser?.role === "OPERATOR" && (
          <button
            className={`tab-btn ${activeTab === "operator" ? "active" : ""}`}
            onClick={() => setActiveTab("operator")}
          >
            Operator Order Management ({operatorOrders.length})
          </button>
        )}
        <button
          className={`tab-btn ${activeTab === "catalog" ? "active" : ""}`}
          onClick={() => setActiveTab("catalog")}
        >
          Product Catalog & Buy
        </button>
        {currentUser?.role === "CUSTOMER" && (
          <button
            className={`tab-btn ${activeTab === "my-orders" ? "active" : ""}`}
            onClick={() => setActiveTab("my-orders")}
          >
            My Orders ({myOrders.length})
          </button>
        )}
      </nav>

      {/* Global Alert Notification */}
      {message && (
        <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
          {message.text}
        </div>
      )}

      {/* TAB 1: Operator Order Management Board */}
      {activeTab === "operator" && currentUser?.role === "OPERATOR" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "1.25rem" }}>Operator Order Fulfillment Board</h2>
            <button className="btn btn-secondary" onClick={loadOperatorOrders} disabled={loading}>
              Refresh Orders
            </button>
          </div>
          {operatorOrders.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No customer orders found in the system.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer Email</th>
                  <th>Order Items</th>
                  <th>Total Amount</th>
                  <th>Current Status</th>
                  <th>Operator Actions</th>
                </tr>
              </thead>
              <tbody>
                {operatorOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{order.id}</td>
                    <td>{order.customer?.email || order.customer_id}</td>
                    <td>
                      {order.items.map((i) => (
                        <div key={i.id}>
                          {i.product?.name || "Product"} × {i.quantity} (${i.unit_price.toFixed(2)})
                        </div>
                      ))}
                    </td>
                    <td style={{ fontWeight: 600 }}>${order.total_amount.toFixed(2)}</td>
                    <td>
                      <span className={`status-badge status-${order.status}`}>{order.status}</span>
                    </td>
                    <td>
                      {order.status === "PENDING" ? (
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            className="btn btn-success"
                            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                            onClick={() => handleUpdateStatus(order.id, "CONFIRMED")}
                            disabled={loading}
                          >
                            Confirm
                          </button>
                          <button
                            className="btn btn-danger"
                            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                            onClick={() => handleUpdateStatus(order.id, "CANCELLED")}
                            disabled={loading}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          No further action ({order.status})
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 2: Product Catalog & Buy */}
      {activeTab === "catalog" && (
        <div>
          <h2 style={{ marginBottom: "16px", fontSize: "1.25rem" }}>Available Products</h2>
          <div className="grid-products">
            {products.map((product) => {
              const qty = orderQuantity[product.id] || 1;
              return (
                <div key={product.id} className="card">
                  <h3 className="card-title">{product.name}</h3>
                  <p className="card-desc">{product.description || "No description provided."}</p>
                  <div>
                    <span className={`stock-tag ${product.stock > 0 ? "stock-in" : "stock-out"}`}>
                      {product.stock > 0 ? `In Stock: ${product.stock}` : "Out of Stock"}
                    </span>
                  </div>
                  <div className="card-footer">
                    <div className="price">${product.price.toFixed(2)}</div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="number"
                        min="1"
                        value={qty}
                        onChange={(e) =>
                          setOrderQuantity({
                            ...orderQuantity,
                            [product.id]: parseInt(e.target.value) || 1,
                          })
                        }
                        style={{
                          width: "60px",
                          padding: "6px 8px",
                          borderRadius: "4px",
                          border: "1px solid var(--border)",
                        }}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={() => handlePlaceOrder(product.id)}
                        disabled={loading || product.stock <= 0}
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Customer My Orders */}
      {activeTab === "my-orders" && currentUser?.role === "CUSTOMER" && (
        <div>
          <h2 style={{ marginBottom: "16px", fontSize: "1.25rem" }}>My Order History</h2>
          {myOrders.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No past orders found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {myOrders.map((order) => (
                  <tr key={order.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{order.id}</td>
                    <td>{new Date(order.created_at).toLocaleString()}</td>
                    <td>
                      {order.items.map((i) => (
                        <div key={i.id}>
                          {i.product?.name || "Product"} × {i.quantity} (${i.unit_price.toFixed(2)})
                        </div>
                      ))}
                    </td>
                    <td style={{ fontWeight: 600 }}>${order.total_amount.toFixed(2)}</td>
                    <td>
                      <span className={`status-badge status-${order.status}`}>{order.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

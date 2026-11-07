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
  const [activeTab, setActiveTab] = useState<"catalog" | "my-orders">("catalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [orderQuantity, setOrderQuantity] = useState<{ [productId: string]: number }>({});
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Quick switch customer login for demo
  const loginAsCustomer = async (email: string) => {
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "CustomerPass123!" }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToken(data.data.token);
        setCurrentUser(data.data.user);
        setMessage({ text: `Logged in as Customer: ${data.data.user.email}`, type: "success" });
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

  useEffect(() => {
    loadProducts();
    // Default login as Alice for fast demo
    loginAsCustomer("alice@customer.com");
  }, []);

  useEffect(() => {
    if (activeTab === "catalog") loadProducts();
    if (activeTab === "my-orders") loadMyOrders();
  }, [activeTab, token]);

  // Place order with atomic stock deduction (AC-05, AC-06)
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
        await loadProducts(); // Refresh catalog stock immediately
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

  return (
    <div className="container">
      {/* Header with User Info and Quick Switcher */}
      <header className="header">
        <div>
          <h1 className="header-title">🛒 CPE 334 E-Commerce Store</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Issue #3: Product Catalog & Customer Order Workflow
          </p>
        </div>
        <div className="auth-bar">
          {currentUser ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "0.9rem" }}>{currentUser.email}</span>
              <span className="badge badge-customer">{currentUser.role}</span>
            </div>
          ) : (
            <span>Not logged in</span>
          )}
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              className="btn btn-secondary"
              onClick={() => loginAsCustomer("alice@customer.com")}
              disabled={loading}
            >
              Login Alice
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => loginAsCustomer("bob@customer.com")}
              disabled={loading}
            >
              Login Bob
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`tab-btn ${activeTab === "catalog" ? "active" : ""}`}
          onClick={() => setActiveTab("catalog")}
        >
          Product Catalog & Buy
        </button>
        <button
          className={`tab-btn ${activeTab === "my-orders" ? "active" : ""}`}
          onClick={() => setActiveTab("my-orders")}
        >
          My Orders ({myOrders.length})
        </button>
      </nav>

      {/* Global Alert Notification */}
      {message && (
        <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
          {message.text}
        </div>
      )}

      {/* TAB 1: Product Catalog & Buy */}
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

      {/* TAB 2: Customer My Orders */}
      {activeTab === "my-orders" && (
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

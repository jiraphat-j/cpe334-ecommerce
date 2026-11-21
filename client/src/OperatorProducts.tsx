import { type FormEvent, useEffect, useState } from "react";

interface ManagedProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  archived_at: string | null;
}

type Editor = { mode: "create" } | { mode: "details" | "stock" | "archive"; id: string };

export function OperatorProducts({ token }: { token: string }) {
  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/operator/products", {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load products.");
        setProducts(data.data.products);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setAlert({ text: error.message, error: true });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);

  const selected = editor && "id" in editor ? products.find((product) => product.id === editor.id) : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || loading) return;

    const fields = new FormData(event.currentTarget);
    const details = () => ({
      name: String(fields.get("name") ?? ""),
      description: String(fields.get("description") ?? "").trim() || null,
      price: Number(fields.get("price")),
    });
    const base = "/api/operator/products";
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    let url = base;
    let method = "POST";
    let payload: object | undefined;
    if (editor.mode === "create") {
      payload = { ...details(), stock: Number(fields.get("stock")) };
    } else if (selected) {
      url = `${base}/${encodeURIComponent(selected.id)}`;
      if (editor.mode === "archive") {
        url += "/archive";
      } else {
        method = "PATCH";
        if (editor.mode === "stock") {
          url += "/stock";
          payload = { stock: Number(fields.get("stock")), expectedStock: selected.stock };
        } else {
          payload = details();
        }
      }
    } else {
      return;
    }

    setLoading(true);
    setAlert(null);
    try {
      const response = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetch(base, { headers });
          if (latest.ok) {
            setProducts((await latest.json()).data.products);
            setEditor(null);
          }
        }
        throw new Error(data.error?.message ?? "Could not save the product.");
      }
      const saved: ManagedProduct = data.data.product;
      setProducts((current) => editor.mode === "create"
        ? [...current, saved]
        : current.map((product) => product.id === saved.id ? saved : product));
      setEditor(null);
      setAlert({ text: `${saved.name} ${editor.mode === "archive" ? "archived" : "saved"}.`, error: false });
    } catch (error) {
      setAlert({ text: error instanceof Error ? error.message : "Could not save the product.", error: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="operator-products-heading" aria-busy={loading}>
      <div className="product-management-heading">
        <h2 id="operator-products-heading">Product Management</h2>
        <button type="button" className="btn btn-primary" disabled={loading}
          onClick={() => setEditor({ mode: "create" })}>Add Product</button>
      </div>
      {alert && (
        <p role={alert.error ? "alert" : "status"} className={`alert ${alert.error ? "alert-error" : "alert-success"}`}>
          {alert.text}
        </p>
      )}
      {editor && (
        <form key={editor.mode === "create" ? "create" : `${editor.id}/${editor.mode}`}
          className="card product-management-form" onSubmit={save}>
          <h3>
            {editor.mode === "create" ? "Add product" : `${{ details: "Edit", stock: "Adjust stock for", archive: "Archive" }[editor.mode]} ${selected?.name}`}
          </h3>
          {(editor.mode === "create" || editor.mode === "details") && (
            <>
              <label>Name<input name="name" required defaultValue={selected?.name} /></label>
              <label>Description<textarea name="description" rows={2} defaultValue={selected?.description ?? ""} /></label>
              <label>Price (THB)<input name="price" type="number" min="0.01" step="0.01" required defaultValue={selected?.price} /></label>
            </>
          )}
          {(editor.mode === "create" || editor.mode === "stock") && (
            <label>Stock<input name="stock" type="number" min="0" max="2147483647" step="1" required
              defaultValue={selected?.stock ?? 0} /></label>
          )}
          {editor.mode === "archive" && (
            <p>The product will be removed from the storefront. Existing orders will remain available.</p>
          )}
          <div className="product-management-actions">
            <button className={`btn ${editor.mode === "archive" ? "btn-danger" : "btn-primary"}`}
              disabled={loading} type="submit">
              {editor.mode === "archive" ? "Confirm archive" : "Save"}
            </button>
            <button className="btn btn-secondary" type="button" disabled={loading}
              onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </form>
      )}
      {loading && products.length === 0 && <p role="status">Loading products…</p>}
      {!loading && !alert?.error && products.length === 0 && <p>No products found.</p>}
      {products.length > 0 && (
        <div className="grid-products">
          {products.map((product) => (
            <article className="card" key={product.id}>
              <h3 className="card-title">{product.name}</h3>
              {product.description && <p className="card-desc">{product.description}</p>}
              <p>฿{product.price.toLocaleString()} · Stock: {product.stock} · {product.archived_at ? "Archived" : "Active"}</p>
              {!product.archived_at && (
                <div className="product-management-actions">
                  <button type="button" className="btn btn-secondary" disabled={loading}
                    onClick={() => setEditor({ mode: "details", id: product.id })}>Edit</button>
                  <button type="button" className="btn btn-secondary" disabled={loading}
                    onClick={() => setEditor({ mode: "stock", id: product.id })}>Adjust Stock</button>
                  <button type="button" className="btn btn-danger" disabled={loading}
                    onClick={() => setEditor({ mode: "archive", id: product.id })}>Archive</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

# Sprint 1 Engineering Contracts & Test Specifications

> **Document ID:** CONTRACT-SPRINT-01  
> **Milestone:** Deliverable 1 (Part E)  
> **Course:** CPE 334 Introduction to Software Engineering in the Age of AI Agents  
> **Theme:** E-Commerce or Ordering System (Customer / Operator)  
> **Version:** 1.1.0 (Aligned with Traceability Matrix)

---

## 1. Feature Contracts & Acceptance Criteria

### Feature Contract 1: User Authentication & Role RBAC (`F-01`)
- **Linked Requirements:** `FR-01`, `FR-02`, `BR-01`, `BR-06`, `NFR-01`
- **Component Changes:**
  - Database: `User` model (`id`, `email`, `password_hash`, `role`).
  - API Routes:
    - `POST /api/auth/register`: Accepts `{ "email", "password" }`. Defaults `role` to `CUSTOMER`.
    - `POST /api/auth/login`: Accepts `{ "email", "password" }`. Verifies bcrypt hash, returns `{ "token", "user": { "id", "email", "role" } }`.
    - `GET /api/auth/me`: Requires Bearer token. Returns current authenticated user record.
- **Acceptance Criteria (AC):**
  - **AC-01 (Customer Registration):** Given a valid email and strong password ($\ge 6$ chars), when `POST /api/auth/register` is called, then a new `User` is created with role `CUSTOMER`, password hashed with bcrypt, and HTTP 201 is returned.
  - **AC-02 (Authentication & Token Issuance):** Given valid registered credentials, when `POST /api/auth/login` is called, then system returns HTTP 200 with JWT token and user profile. Given invalid credentials, returns HTTP 401.
  - **AC-03 (Identity Verification):** Given an authenticated request with Bearer token to `GET /api/auth/me`, system returns HTTP 200 with matching user profile. Given unauthenticated request, returns HTTP 401.

---

### Feature Contract 2: Product Catalog & Inventory (`F-02`)
- **Linked Requirements:** `FR-03`, `NFR-02`
- **Component Changes:**
  - Database: `Product` model (`id`, `name`, `description`, `price`, `stock`).
  - API Routes:
    - `GET /api/products`: Public endpoint returning list of active products with stock.
- **Acceptance Criteria (AC):**
  - **AC-04 (Catalog Retrieval):** When `GET /api/products` is called, system returns HTTP 200 with an array of products containing `id`, `name`, `price`, and current `stock`.

---

### Feature Contract 3: Customer Order Placement & Stock Decrement (`F-03`)
- **Linked Requirements:** `FR-04`, `FR-05`, `BR-02`, `BR-03`, `BR-04`, `NFR-03`
- **Component Changes:**
  - Database: `Order` and `OrderItem` models.
  - API Routes:
    - `POST /api/orders`: Authenticated Customer creates order with `{ "productId", "quantity" }`.
    - `GET /api/orders/my-orders`: Authenticated Customer retrieves list of their past orders.
    - `GET /api/orders/:id`: Retrieves order details. Allowed only for order owner or Operator.
- **Acceptance Criteria (AC):**
  - **AC-05 (Successful Order Placement & Atomic Deduction):** Given an authenticated Customer and product with stock $\ge$ requested quantity, when `POST /api/orders` is called, then an `Order` in `PENDING` status is created, stock is decremented by quantity atomically, and HTTP 201 is returned.
  - **AC-06 (Out-of-Stock Boundary Rejection):** Given an order request where `quantity > stock` or `quantity <= 0`, system rejects request with HTTP 400 Bad Request, preserves original stock, and creates no order.
  - **AC-07 (Customer Order Isolation):** When a Customer accesses `GET /api/orders/:id` belonging to a different customer, system returns HTTP 403 Forbidden.

---

### Feature Contract 4: Operator Order Management & Status Transitions (`F-04`)
- **Linked Requirements:** `FR-06`, `FR-07`, `BR-05`, `BR-06`, `NFR-01`
- **Component Changes:**
  - API Routes:
    - `GET /api/operator/orders`: Returns all store orders. Blocked for `CUSTOMER`.
    - `PATCH /api/operator/orders/:id/status`: Updates order status. Allowed transitions: `PENDING` $\rightarrow$ `CONFIRMED` or `CANCELLED`.
- **Acceptance Criteria (AC):**
  - **AC-08 (Operator Order Listing):** Given an authenticated Operator, when `GET /api/operator/orders` is called, system returns HTTP 200 with all orders. When called by a Customer, returns HTTP 403 Forbidden.
  - **AC-09 (Valid Status Transition):** Given an order in `PENDING` status, when Operator patches status to `CONFIRMED`, system updates status and returns HTTP 200.
  - **AC-10 (Invalid Transition Rejection):** Given an order in `CANCELLED` status, attempting to transition to `CONFIRMED` or `SHIPPED` returns HTTP 400 Bad Request with transition violation message.

---

## 2. Software Test Specification (STS)

| Test ID | Linked AC / Rule | Test Level | Preconditions / Input | Action | Expected Outcome |
|---|---|:---:|---|---|---|
| **TEST-01** | AC-01 / FR-01 | Integration | Unique email, password `"password123"` | `POST /api/auth/register` | HTTP 201; User record in DB has `role = CUSTOMER`; password $\neq$ plaintext. |
| **TEST-02** | AC-02 / BR-01 | Integration | Registered user | `POST /api/auth/login` with correct/wrong password | Correct: HTTP 200 + token; Wrong: HTTP 401 Unauthorized; Bcrypt verified. |
| **TEST-03** | AC-03 / FR-02 | Integration | Issued JWT token | `GET /api/auth/me` with/without header | With token: HTTP 200 + user profile; Without token: HTTP 401 Unauthorized. |
| **TEST-04** | AC-04 / FR-03 | Integration | Seeded products in database | `GET /api/products` | HTTP 200; Array length $\ge 1$; each product has `id`, `name`, `price`, `stock`. |
| **TEST-05** | AC-05 / BR-04 | Integration | Product with stock = 10, Customer token | `POST /api/orders` with `{ productId, quantity: 2 }` | HTTP 201; Order created (`PENDING`); Product stock in DB = 8 (Atomic decrement). |
| **TEST-06** | AC-06 / BR-03 | Integration | Product with stock = 2, Customer token | `POST /api/orders` with `{ productId, quantity: 5 }` | HTTP 400 Bad Request; Product stock in DB remains 2; No order created. |
| **TEST-07** | AC-06 / BR-03 | Unit / Logic | Quantity = 0 or -1 | Order creation validation | Throws validation error; HTTP 400 returned. |
| **TEST-08** | AC-07 / BR-02 | Integration | Customer A and Order B (owned by Customer B) | Customer A calls `GET /api/orders/:orderB_id` | HTTP 403 Forbidden; Order details not leaked (Customer isolation). |
| **TEST-09** | AC-07 / FR-05 | Integration | Customer with 2 past orders | `GET /api/orders/my-orders` | HTTP 200; Returns only Customer's own 2 orders. |
| **TEST-10** | AC-08 / FR-06 | Integration | Operator token | Operator calls `GET /api/operator/orders` | HTTP 200; Returns array of all orders across all customers. |
| **TEST-11** | AC-09 / FR-07 | Integration | Order in `PENDING`, Operator token | `PATCH /api/operator/orders/:id/status` `{ status: "CONFIRMED" }` | HTTP 200; Order status in DB = `CONFIRMED`. |
| **TEST-12** | AC-10 / BR-05 | Integration | Order in `CANCELLED`, Operator token | `PATCH /api/operator/orders/:id/status` `{ status: "CONFIRMED" }` | HTTP 400 Bad Request; State transition rejected. |
| **TEST-13** | AC-08 / BR-06 | Integration | Customer token | Customer calls `GET /api/operator/orders` | HTTP 403 Forbidden; Role restriction enforced. |
| **TEST-14** | AC-02, AC-08 / NFR-01 | Integration | No Authorization header | Unauthenticated call to protected endpoints | HTTP 401 Unauthorized; Zero unauthorized access allowed. |
| **TEST-15** | NFR-02 | Performance | Local environment benchmark | Execute catalog listing and order placement API | Response time $\le 500\text{ ms}$. |
| **TEST-16** | NFR-03 | Integration | Created orders and updated inventory | Query DB after server/container restart | Records, order statuses, and decremented stock survive intact. |

---

## 3. Product Definition of Done (DoD) - Sprint 1

A feature or increment is deemed **Done** only when:
1. **Contract Compliance:** All Acceptance Criteria (`AC-01` to `AC-10`) implemented as specified.
2. **Automated Verification:** All Software Test Specifications (`TEST-01` to `TEST-16`) pass 100% in automated test runs.
3. **Security Invariant:** Zero real secrets, tokens, or `.env` credentials in repository code or commits.
4. **Peer Review Invariant:** Implemented on a feature branch, integrated into `staging-sprint-1` through a Pull Request reviewed and approved by the non-author teammate.
5. **Traceability:** Execution evidence (test output, commit SHA) recorded and mapped to requirement IDs for the final Deliverable 1 PDF report.

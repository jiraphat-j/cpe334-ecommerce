# Software Requirements Specification (SRS) - E-Commerce Ordering System

> **Document ID:** SRS-01  
> **Milestone:** Deliverable 1 (Part A)  
> **Course:** CPE 334 Introduction to Software Engineering in the Age of AI Agents  
> **Team:** `jiraphat-j` & `thanapornboont-star`  
> **Theme:** E-Commerce or Ordering System (Customer / Operator)

---

## 1. Context and Stakeholder Problem

Small-to-medium retail vendors frequently encounter operational issues with manual or chat-based order processing, including inventory discrepancy (overselling out-of-stock items), lack of order status visibility for buyers, and absence of role segregation. 

This project engineers an E-Commerce Ordering System that provides:
1. Real-time product availability and automated inventory decrement upon ordering.
2. Distinct, protected portals and capabilities for **Customers** and **Operators**.
3. Strict backend authorization ensuring customers can only access their own orders while operators manage the store-wide fulfillment pipeline.

---

## 2. Actors and Responsibilities

| Actor | Description & Primary Responsibilities |
|---|---|
| **Customer** | End-user purchasing products.<br/>- Registers and logs in to their personal account.<br/>- Views available products, unit prices, and live stock levels.<br/>- Places orders and views instant calculation of totals.<br/>- Views personal order history and order statuses.<br/>- Cancels an order if it is still in `PENDING` status. |
| **Operator** | Store manager / fulfillment staff.<br/>- Logs in to administrative dashboard.<br/>- Monitors all customer orders in the system.<br/>- Manages order lifecycle transitions (`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `SHIPPED` or `CANCELLED`).<br/>- Maintains inventory levels and oversees product catalog. |

---

## 3. Product Scope and Explicit Exclusions

### In-Scope (Sprint 1 to 3)
- Account registration, credential authentication, and session/token validation with role enforcement.
- Product catalog with real-time stock availability.
- Order creation with immediate atomic stock deduction.
- Customer order isolation (a customer only accesses their own records).
- Operator order fulfillment dashboard with status state machine enforcement.
- Automated tests across unit, integration (persistence/auth), and E2E journeys.

### Explicit Exclusions (Out of Scope for Sprint 1)
- Real payment gateway integration (e.g., Stripe, Omise). Sprint 1 uses mock payment confirmation.
- External communication services (SMS, push notifications, third-party email sending).
- Multi-warehouse routing or partial fulfillment.
- Self-service password recovery via email (seeded or admin reset only).

---

## 4. Functional Requirements (FR)

| ID | Title | Description | Target Actor |
|---|---|---|---|
| **FR-01** | User Authentication | System shall allow users to register (Customer) and authenticate (Customer or Operator) using email and password, establishing an authenticated session. | Customer / Operator |
| **FR-02** | User Identity Retrieval | System shall expose current authenticated user details and role via `/api/auth/me`. | Authenticated User |
| **FR-03** | Product Catalog Browsing | System shall list products with name, description, unit price, and available stock. | Customer / Operator |
| **FR-04** | Order Placement | System shall allow authenticated Customers to submit an order containing product ID and quantity, calculating the total price. | Customer |
| **FR-05** | Customer Order History | System shall allow authenticated Customers to list their past orders and check real-time status. | Customer |
| **FR-06** | Operator Order Dashboard | System shall allow authenticated Operators to query all orders placed across all customers. | Operator |
| **FR-07** | Order Status Transition | System shall allow Operators to update an order's status following valid state transitions (`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `SHIPPED` / `CANCELLED`). | Operator |

---

## 5. Business Rules (BR)

| ID | Title | Rule Statement | Enforcement Layer |
|---|---|---|---|
| **BR-01** | Password Hashing | Passwords must be hashed using bcrypt with salt factor $\ge 10$ before storage. Plaintext passwords must never be stored, logged, or returned in API responses. | Backend / Database |
| **BR-02** | Customer Record Isolation | A Customer shall only access, query, or cancel orders associated with their own `customer_id`. Requests attempting to read or mutate another customer's order must be rejected with `403 Forbidden`. | Backend API Authorization |
| **BR-03** | Inventory Integrity | When placing an order, requested quantity must be greater than zero ($> 0$) and less than or equal to current available stock ($\le \text{stock}$). If stock is insufficient, the transaction must fail with an informative error without decrementing stock. | Backend Transaction |
| **BR-04** | Atomic Stock Deduction | Order creation and stock decrement must execute inside a single atomic database transaction. | Database Transaction |
| **BR-05** | Status State Machine | An order cannot transition backward (e.g., `SHIPPED` to `PENDING`). An order in `CANCELLED` status cannot be confirmed or shipped. | Backend Business Logic |
| **BR-06** | Role Access Restriction | Endpoints under `/api/operator/*` must reject unauthenticated requests with `401 Unauthorized` and reject non-operator users (e.g. `CUSTOMER`) with `403 Forbidden`. | Backend Middleware |

---

## 6. Non-Functional Requirements (NFR)

| ID | Target Quality | Measurable Target | Verification Method | Allocated Sprint |
|---|---|---|---|---|
| **NFR-01** | Backend Access Control | 100% of protected routes return `401 Unauthorized` without credentials and `403 Forbidden` on role/ownership mismatch. | Automated API Integration Tests | Sprint 1 |
| **NFR-02** | Transaction Latency | Standard order placement and catalog listing API responses $\le 500\text{ ms}$ on local environment. | Automated Benchmark / Test Timers | Sprint 1 |
| **NFR-03** | Data Persistence | Database records (orders, inventory changes) survive container restart and redeployment without data loss. | Database Volume & Persistence Tests | Sprint 1 & Lab 5 |
| **NFR-04** | Security - Zero Secrets | 0 credentials, keys, or database passwords committed to Git repository or Docker image layers. | Automated Git Secret Scanning & Pre-commit Audit | Sprint 1 |

---

## 7. Assumptions, Decisions, and Resolutions

1. **Architecture Style:** Monolithic repository with separate `client/` (React + Vite) and `server/` (Node.js Express + Prisma ORM) packaged together for cloud runtime compatibility.
2. **Session / Auth Strategy:** HTTP-only JWT cookies or Bearer token authentication to prevent XSS credential theft.
3. **Database Selection:** PostgreSQL 16 managed via Prisma ORM for schema migration and reproducible seeding (`seed.ts`).

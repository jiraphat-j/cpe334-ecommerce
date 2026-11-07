# Feature Inventory and Requirements Traceability Matrix

> **Document ID:** TRACE-01  
> **Milestone:** Deliverable 1 (Part B)  
> **Course:** CPE 334 Introduction to Software Engineering in the Age of AI Agents  
> **Theme:** E-Commerce or Ordering System (Customer / Operator)

---

## 1. Feature Inventory

| Feature ID | Feature Name | Short Description | Linked Requirements | Dependencies | Planned Sprint |
|---|---|---|---|---|:---:|
| **F-01** | User Auth & Role RBAC | Registration, login, logout, password hashing, and role determination (`CUSTOMER` vs `OPERATOR`). | FR-01, FR-02, BR-01, BR-06, NFR-01 | None | Sprint 1 |
| **F-02** | Product Catalog & Inventory | Product display with real-time stock levels and pricing. | FR-03, NFR-02 | None | Sprint 1 |
| **F-03** | Customer Order Placement | Shopping journey: select product, validate stock, atomically deduct inventory, and record order. | FR-04, FR-05, BR-02, BR-03, BR-04, NFR-03 | F-01, F-02 | Sprint 1 |
| **F-04** | Operator Order Management | Store-wide order fulfillment board with status transition controls (`PENDING` $\rightarrow$ `CONFIRMED` $\rightarrow$ `SHIPPED` / `CANCELLED`). | FR-06, FR-07, BR-05, BR-06, NFR-01 | F-01, F-03 | Sprint 1 |
| **F-05** | Product Catalog Management | Operator CRUD actions for adding, editing, and archiving products. | Future extension | F-01, F-02 | Sprint 2 |
| **F-06** | Multi-Item Shopping Cart | Adding multiple distinct items into a single basket with collective checkout. | Future extension | F-02, F-03 | Sprint 2 |
| **F-07** | Customer Order Cancellation | Customer cancellation of orders in `PENDING` state with automated stock restocking. | Future extension | F-03, F-04 | Sprint 2 |
| **F-08** | Order Tracking Timeline & Audit | Step-by-step fulfillment timeline with timestamps and operator activity logs. | Future extension | F-04 | Sprint 3 |
| **F-09** | Mock Payment Gateway Integration | Simulation of credit/promptpay payment with webhook confirmation callback. | Future extension | F-03 | Sprint 3 |

---

## 2. Requirements-to-Feature-to-Sprint Traceability Matrix

| Requirement ID | Type | Linked Feature | Target Sprint | Acceptance Criteria (AC) | Software Test Spec (STS) |
|---|:---:|---|:---:|---|---|
| **FR-01** | FR | F-01 User Auth & Role RBAC | Sprint 1 | AC-01 (Register Customer)<br/>AC-02 (Login Authenticated) | TEST-01 (Register API)<br/>TEST-02 (Login Success/Fail) |
| **FR-02** | FR | F-01 User Auth & Role RBAC | Sprint 1 | AC-03 (Current User Identity) | TEST-03 (`/api/auth/me` check) |
| **FR-03** | FR | F-02 Product Catalog | Sprint 1 | AC-04 (Browse Product List) | TEST-04 (Catalog listing API) |
| **FR-04** | FR | F-03 Customer Order Placement | Sprint 1 | AC-05 (Create Order Normal) | TEST-05 (Order creation & response) |
| **FR-05** | FR | F-03 Customer Order Placement | Sprint 1 | AC-06 (Customer View Own Orders) | TEST-06 (Customer order history query) |
| **FR-06** | FR | F-04 Operator Order Management | Sprint 1 | AC-07 (Operator View All Orders) | TEST-07 (Operator dashboard API) |
| **FR-07** | FR | F-04 Operator Order Management | Sprint 1 | AC-08 (Status State Transition) | TEST-08 (Status update transition API) |
| **BR-01** | BR | F-01 User Auth & Role RBAC | Sprint 1 | AC-02 (Password Hashing) | TEST-02 (Bcrypt verification check) |
| **BR-02** | BR | F-03 Customer Order Placement | Sprint 1 | AC-06 (Customer Record Isolation) | TEST-09 (Cross-customer order access rejection $\rightarrow$ 403) |
| **BR-03** | BR | F-03 Customer Order Placement | Sprint 1 | AC-05 (Out-of-Stock Rejection) | TEST-10 (Order quantity $>$ stock rejection $\rightarrow$ 400) |
| **BR-04** | BR | F-03 Customer Order Placement | Sprint 1 | AC-05 (Atomic Stock Decrement) | TEST-11 (Stock count verification post-order) |
| **BR-05** | BR | F-04 Operator Order Management | Sprint 1 | AC-08 (Invalid Transition Blocked) | TEST-12 (Invalid status change rejection $\rightarrow$ 400) |
| **BR-06** | BR | F-01 / F-04 RBAC Enforcement | Sprint 1 | AC-07 (Role Restriction) | TEST-13 (Customer accessing operator API $\rightarrow$ 403) |
| **NFR-01** | NFR | F-01 / F-04 Access Control | Sprint 1 | AC-02, AC-07 (Zero Unauthorized Pass) | TEST-14 (Unauthenticated request $\rightarrow$ 401) |
| **NFR-02** | NFR | F-02 / F-03 Latency | Sprint 1 | Latency $\le 500\text{ ms}$ | TEST-15 (API execution benchmark) |
| **NFR-03** | NFR | F-03 Persistence | Sprint 1 | Database records survive restart | TEST-16 (Post-restart data query) |
| **NFR-04** | NFR | Infrastructure / Code | Sprint 1 | Zero secret leaks in Git history | Git secret audit & push protection check |

---

## 3. Coverage Analysis and Scope Progression

- **Sprint 1 Coverage:** 100% of baseline FRs (`FR-01` through `FR-07`), all core BRs (`BR-01` through `BR-06`), and all critical NFRs (`NFR-01` through `NFR-04`) are formally covered with concrete AC and executable test specifications.
- **Sprint 2 Coverage:** Product maintenance (`F-05`), cart expansion (`F-06`), and self-cancellation with restock (`F-07`).
- **Sprint 3 Coverage:** Audit log trail (`F-08`), simulated payment gateway (`F-09`), and comprehensive regression hardening.
- **Coverage Gaps:** No unallocated requirements exist in the baseline specification.

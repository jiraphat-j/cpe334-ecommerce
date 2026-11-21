# Sprint 3 Engineering Contracts

## F-08 · Order status timeline and Operator audit

Issue #45. Author: @jiraphat-j. Reviewer: @thanapornboont-star.
Extends FR-05 (order history), FR-07 (Operator status updates), BR-02 (record
isolation), BR-05 (transitions), BR-06 (role enforcement), NFR-01 (access)
and NFR-03 (persistence).

### Deliverable 2 workflow and data

An authenticated Operator confirms a PENDING order through the existing
`PATCH /api/operator/orders/:id/status` with `{ "status": "CONFIRMED" }`.
The existing conditional update and a status event are written atomically.
An event is created only for PENDING to CONFIRMED. Rejected updates,
duplicates and no-op updates create no event. The current status response
and existing transition rules remain in use.

`OrderStatusEvent` stores the order ID, previous status, new status, UTC
timestamp and Operator ID. The new table is additive. An event belongs
to its order and is deleted with that order. If its actor account is
removed, the event still exists with no actor ID. No synthetic history is
inserted for existing orders.

The owner expands View timeline in My Orders, which requests
`GET /api/orders/:id`. The existing response adds
`data.order.timeline`, an array of `{ from_status, to_status, created_at }`
ordered by time ascending with a stable ID tie-breaker. Actor identity is
reserved for the audit surface. The existing order read permissions still
apply: 401 for no session, 403 for another Customer, 404 for an unknown
order. Legacy orders return an empty array and show No status history yet.

### Acceptance criteria and software test specifications

| AC / STS | Layer and expectation |
| --- | --- |
| AC-F08-01 / TEST-F08-01 | API/DB: Operator confirms one PENDING order; the saved state and exactly one event match, including actor and timestamp. |
| AC-F08-02 / TEST-F08-02 | API/DB: repeated confirmation, a rejected transition or a lost concurrent update cannot add duplicate history. If event insertion fails, the order remains PENDING. |
| AC-F08-03 / TEST-F08-03 | API/UI: the owner retrieves persisted history after reload; a different Customer receives 403 and anonymous callers receive 401. The response exposes no actor ID. |
| AC-F08-04 / TEST-F08-04 | API/UI: a legacy order with no persisted events remains readable and has an empty timeline. |

### Remaining Final Delivery workflow

The Operator audit view will show the full transition history for a selected
order, ordered oldest first, with the recorded actor and time. Additional
valid status changes will use the same atomic event mechanism. The audit
read endpoint will be under `GET /api/operator/orders/:id/audit`, returning
event fields including actor ID, with 401/403/404 for no session, wrong role,
or unknown order. Deleted actors are shown as unavailable.

AC-F08-05 / TEST-F08-05 verifies that other supported status transitions
record one event each and rejected/no-op transitions record none.
AC-F08-06 / TEST-F08-06 verifies the Operator audit view, actor visibility
on the protected endpoint and 403 for Customers. Both are planned for
@jiraphat-j by 13 December and depend on the reviewed event model.

Definition of Done for this checkpoint: contract committed before code,
RED/GREEN and regression results tied to commits, PostgreSQL and browser
verification, teammate-reviewed staging PR, and deployment evidence in #47.

## F-09 · Simulated payment gateway and callback behavior

Issue #46. Author: @thanapornboont-star. Reviewer: @jiraphat-j.
Extends FR-04 (order placement), FR-05 (order history), FR-07 (status transitions),
BR-02 (record isolation), BR-03 (inventory integrity), BR-04 (atomic stock updates),
BR-05 (status transitions), BR-06 (role access), NFR-01 (access control),
NFR-03 (persistence & transactions), and NFR-04 (zero secrets).

### Workflow and API

A Customer with an order in `PENDING` status initiates payment checkout.
The simulated payment gateway handles customer payment authorization and sends
an authoritative, asynchronous webhook callback to the backend to confirm or
reject the transaction. The callback updates order status, records the payment
transaction, and restores inventory if payment fails.

#### Endpoints

| Method and path | Caller | Payload / Headers | Success response |
| --- | --- | --- | --- |
| POST `/api/orders/:id/pay` | Customer (owner) | Header: `Authorization: Bearer <token>`<br>Body: `{ "method": "PROMPTPAY" \| "CREDIT_CARD" }` | 200 `{ success: true, data: { paymentSession } }` |
| GET `/api/orders/:id/payment` | Customer (owner) / Operator | Header: `Authorization: Bearer <token>` | 200 `{ success: true, data: { payment } }` |
| POST `/api/webhooks/payment` | Simulated Gateway (public with signature) | Header: `X-Webhook-Secret: <shared_secret>`<br>Body: `{ "eventId", "orderId", "amount", "currency", "status", "gatewayRef", "timestamp" }` | 200 `{ success: true, message: string, data: { orderId, status } }` |

#### Payment Initiation (`POST /api/orders/:id/pay`)
- Requires authentication (401 `UNAUTHORIZED`).
- Only order owner (`CUSTOMER`) can initiate payment. Another Customer receives 403 `FORBIDDEN`.
- Order must exist (404 `ORDER_NOT_FOUND`) and must be in `PENDING` status.
- Non-PENDING orders (`CONFIRMED`, `SHIPPED`, `CANCELLED`) return 409 `INVALID_ORDER_STATUS`.
- Generates a `PaymentTransaction` record with status `PENDING`, amount equal to `order.total_amount`, and payment session token for the customer.

#### Webhook Callback Processing (`POST /api/webhooks/payment`)
- **Authentication & Security:** Webhook requests must provide a valid `X-Webhook-Secret` header matching the environment secret `PAYMENT_WEBHOOK_SECRET`. Missing or mismatched secret returns 401 `INVALID_SIGNATURE` before querying database records.
- **Order Correlation:** The callback correlates directly to an existing `Order` via `orderId`. If the order does not exist, returns 404 `ORDER_NOT_FOUND`.
- **Amount & Currency Validation:** The webhook `amount` must match `order.total_amount` exactly (with 2 decimal places precision) and currency must be `THB`. Mismatched amount returns 422 `AMOUNT_MISMATCH` with no status transition or stock mutation.
- **Payment SUCCESS Callback:**
  - If order is `PENDING`: Atomically transitions order status `PENDING` $\rightarrow$ `CONFIRMED`, updates `PaymentTransaction` status to `SUCCESS` with `gatewayRef`, and records an `OrderStatusEvent` (F-08). Inventory was already decremented during checkout, so stock is unchanged.
  - If order is already `CONFIRMED`: Idempotent operation. Acknowledges with 200 `{ success: true, message: "Order already confirmed" }` without creating duplicate timeline events or mutating stock.
  - If order was already `CANCELLED` (e.g. customer cancelled before payment callback arrived): Late success callback cannot resurrect a cancelled order. Returns 409 `ORDER_ALREADY_CANCELLED` and marks transaction `REFUND_REQUIRED`. Stock remains restored for other customers.
- **Payment FAILED Callback:**
  - If order is `PENDING`: Atomically transitions order status `PENDING` $\rightarrow$ `CANCELLED`, updates `PaymentTransaction` status to `FAILED`, records a cancellation `OrderStatusEvent`, and **restores inventory for all saved `OrderItems`** (using the same product lock order as F-06 and F-07 to prevent deadlocks).
  - If order is already `CANCELLED`: Idempotent. Acknowledges with 200 without duplicate inventory restorations.
- **Concurrency & Idempotency:** Duplicate webhook deliveries (matching `eventId`) are deduplicated via unique constraint on `PaymentTransaction.idempotency_key` or event record.

### Data Model (`PaymentTransaction`)

```prisma
enum PaymentStatus {
  PENDING
  SUCCESS
  FAILED
  REFUND_REQUIRED
}

enum PaymentMethod {
  PROMPTPAY
  CREDIT_CARD
}

model PaymentTransaction {
  id              String        @id @default(cuid())
  order_id        String        @unique
  amount          Float
  currency        String        @default("THB")
  status          PaymentStatus @default(PENDING)
  method          PaymentMethod @default(PROMPTPAY)
  gateway_ref     String?
  idempotency_key String?       @unique
  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt
  order           Order         @relation(fields: [order_id], references: [id], onDelete: Cascade)

  @@map("payment_transactions")
}
```

### Acceptance criteria and software test specifications

| AC / STS | Layer and expectation |
| --- | --- |
| AC-F09-01 / TEST-F09-01 | API/DB: Customer initiates payment on their PENDING order; receives payment session with matching total_amount. Unauthenticated receives 401, stranger Customer receives 403, and non-PENDING order returns 409. |
| AC-F09-02 / TEST-F09-02 | API/DB: Valid webhook callback with `SUCCESS` transitions order to `CONFIRMED`, creates `OrderStatusEvent`, sets payment status `SUCCESS`, and preserves stock counts. |
| AC-F09-03 / TEST-F09-03 | API/DB: Valid webhook callback with `FAILED` transitions order to `CANCELLED`, sets payment status `FAILED`, and restores stock for all multi-item line items atomically. |
| AC-F09-04 / TEST-F09-04 | API: Webhook callback with missing or invalid secret returns 401. Amount mismatch returns 422 with no status or stock modification. Unknown order ID returns 404. |
| AC-F09-05 / TEST-F09-05 | API/DB: Duplicate webhook delivery acknowledges with 200 without duplicate transitions or stock restoration. Success callback on an already-cancelled order returns 409/refund-required without reverting order cancellation. |

### Final Delivery implementation and verification plan

This specification establishes the complete contract for the remaining Sprint 3 baseline scope.
Full implementation, automated test suites (unit mock + live PostgreSQL integration), and UI payment modal are scheduled for Final Delivery:
- **Owner:** @thanapornboont-star
- **Target completion date:** 13 December 2026 (Final Delivery Milestone)
- **Dependencies:** OrderItems schema (F-06), status cancellation logic (F-07), and order timeline event logging (F-08).
- **Execution evidence:** Linked to Final Delivery feature Issue upon completion.


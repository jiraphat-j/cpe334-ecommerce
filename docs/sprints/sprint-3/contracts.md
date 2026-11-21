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

### Workflow and User Interface

#### Customer Payment Interaction Flow
In the Customer "My Orders" view (`/orders`), each order row with status `PENDING` displays an active, primary **"Pay"** button next to "Cancel Order" (F-07) and "View Timeline" (F-08). For orders with status `CONFIRMED`, `SHIPPED`, or `CANCELLED`, the "Pay" button is hidden.

1. **Payment Modal & Method Selection:**
   - Clicking "Pay" opens the Payment Modal displaying the Order ID, creation time, line item count, and formatted total amount (`฿XX.XX`).
   - The user selects a payment method via a segmented control: `PROMPTPAY` (Thai QR code, default) or `CREDIT_CARD`.
   - The modal provides "Confirm Payment" and "Cancel" buttons.
2. **Initiation & Waiting State:**
   - Clicking "Confirm Payment" dispatches `POST /api/orders/:id/pay` with `{ "method": "PROMPTPAY" | "CREDIT_CARD" }`.
   - On receiving 200 with `{ sessionId, amount, currency }`, the modal switches to the Processing / Settlement state:
     - For `PROMPTPAY`: Renders a simulated PromptPay QR code with payment amount and countdown timer.
     - For `CREDIT_CARD`: Renders a simulated secure card gateway processing spinner.
     - Displays notice: "Awaiting payment confirmation... Please do not close this window."
     - The client polls `GET /api/orders/:id/payment` every 2 seconds to detect payment settlement.
3. **Outcome States & UX Transitions:**
   - **On SUCCESS callback:** Polling detects `status: "SUCCESS"`. The modal displays a green checkmark: "Payment Successful! Your order has been confirmed." After 1.5 seconds, the modal auto-dismisses. In the My Orders table, the order badge updates to `CONFIRMED`, "Pay" and "Cancel Order" buttons disappear, and "View Timeline" immediately reflects the payment confirmation transition (`PENDING` -> `CONFIRMED`).
   - **On FAILED callback:** Polling detects `status: "FAILED"`. The modal shows an error alert: "Payment authorization failed. Your order has been cancelled and items returned to stock." A "Close" button allows dismissing the modal. The order status updates to `CANCELLED`.
   - **On Modal Dismissal without payment:** The customer can close the modal before payment authorization. The order remains `PENDING` and unpaid; the "Pay" button remains available.

### Backend Endpoints

| Method and path | Caller | Headers / Payload | Success response | Error codes |
| --- | --- | --- | --- | --- |
| `POST /api/orders/:id/pay` | Customer (owner) | Header: `Authorization: Bearer <token>`<br>Body: `{ "method": "PROMPTPAY" \| "CREDIT_CARD" }` | 200 `{ success: true, data: { paymentSession } }` | 401 `UNAUTHORIZED`<br>403 `FORBIDDEN`<br>404 `ORDER_NOT_FOUND`<br>409 `INVALID_ORDER_STATUS` |
| `GET /api/orders/:id/payment` | Customer (owner) / Operator | Header: `Authorization: Bearer <token>` | 200 `{ success: true, data: { payment } }` | 401 `UNAUTHORIZED`<br>403 `FORBIDDEN`<br>404 `ORDER_NOT_FOUND` |
| `POST /api/webhooks/payment` | Gateway (public + secret) | Header: `X-Webhook-Secret: <secret>`<br>Body: `{ "eventId", "orderId", "sessionId", "gatewayRef", "amount", "currency", "status", "timestamp" }` | 200 `{ success: true, message: string, data?: { orderId, status } }` | 401 `INVALID_SIGNATURE`<br>404 `ORDER_NOT_FOUND`<br>404 `PAYMENT_SESSION_NOT_FOUND`<br>409 `PAYMENT_SESSION_MISMATCH`<br>409 `ORDER_ALREADY_CANCELLED`<br>422 `AMOUNT_MISMATCH` |

#### Payment Initiation (`POST /api/orders/:id/pay`)
- **Authorization:** Requires valid JWT (401 `UNAUTHORIZED`). Caller must be the customer who owns the order (403 `FORBIDDEN`).
- **Preconditions:** Order must exist (404 `ORDER_NOT_FOUND`) and its status must be `PENDING`. Any other status (`CONFIRMED`, `SHIPPED`, `CANCELLED`) returns 409 `INVALID_ORDER_STATUS`.
- **Session Issuance & Idempotent Initiation:**
  - Generates a unique correlation token `sessionId` (e.g. `pay_sess_<uuid>`).
  - **Active Session Reuse:** If a `PaymentTransaction` already exists for this order with `status == PENDING`, the server reuses and returns the active `sessionId` and transaction data rather than generating a new session or overwriting the existing record. This ensures that an in-flight gateway callback referencing the original `sessionId` is not invalidated.
  - **Simultaneous First-Time Initiation:** When two initiation requests arrive concurrently for an order before any transaction exists, both requests are serialized via `SELECT ... FROM orders WHERE id = $1 FOR UPDATE` (or the losing insert catches the `order_id @unique` collision, rolls back, and reloads the winning `PaymentTransaction`). Both simultaneous callers receive HTTP 200 with the exact same winning `sessionId`, and exactly one `PaymentTransaction` row is created in the database.
  - **Replacement & Conflict:** If caller attempts to re-initiate payment when a session is already active, the active session is returned (200 OK). Creating a replacement session is only permitted if the prior transaction reached a terminal failed state without cancelling the order. Settled orders (`CONFIRMED`, `CANCELLED`, `SHIPPED`) reject initiation with 409 `INVALID_ORDER_STATUS`.
  - Returns 200 with `{ sessionId, orderId, amount, currency, method, status: "PENDING" }`.

#### Payment Status Read (`GET /api/orders/:id/payment`)
- **Authorization:** Requires valid JWT (401 `UNAUTHORIZED`). Only the order owner or an `OPERATOR` may read payment details. Stranger customers receive 403 `FORBIDDEN`. Unknown orders return 404 `ORDER_NOT_FOUND`.
- **Before Payment Initiation:** If the order exists in `PENDING` status but no payment checkout has been initiated, returns 200 with `{ success: true, data: { payment: null, status: "UNPAID" } }`.
- **After Payment Initiation / Completion:** Returns 200 with complete transaction fields:
  ```json
  {
    "success": true,
    "data": {
      "payment": {
        "id": "pay_clx123",
        "order_id": "ord_abc456",
        "session_id": "pay_sess_789xyz",
        "amount": 250.00,
        "currency": "THB",
        "status": "PENDING" | "SUCCESS" | "FAILED" | "REFUND_REQUIRED",
        "method": "PROMPTPAY" | "CREDIT_CARD",
        "gateway_ref": "gw_tx_999888",
        "created_at": "2026-11-21T12:00:00.000Z",
        "updated_at": "2026-11-21T12:00:00.000Z"
      }
    }
  }
  ```

#### Webhook Callback Processing (`POST /api/webhooks/payment`)

1. **Authentication & Secret Validation:**
   - Validates `X-Webhook-Secret` header against the server environment secret `PAYMENT_WEBHOOK_SECRET`.
   - Missing or mismatched secret immediately returns 401 `INVALID_SIGNATURE` before querying the database.
2. **Replay Deduplication (Separate from Order State):**
   - The webhook handler queries `PaymentWebhookEvent` for `event_id == payload.eventId`.
   - **If `eventId` has already been processed (Replay):**
     Immediately returns 200 `{ success: true, message: "Event already processed", duplicate: true }`.
     Zero mutations occur: no duplicate status events, no payment record changes, and no stock adjustments.
     **Replay Rule:** This 200 idempotent acknowledgment applies to *all* replayed `eventId` deliveries, including deliveries whose original execution returned 409 (such as a late callback on a cancelled order). This guarantees that the payment gateway receives a reliable 200 receipt and halts retries.
   - **Concurrent Replay Delivery Collision:** If two identical callback deliveries race concurrently past the initial lookup, the insert of `PaymentWebhookEvent(eventId)` will trigger a unique constraint collision on `event_id` (`P2002` in Prisma / `23505` in PostgreSQL). The handler explicitly catches this collision, rolls back the concurrent sub-transaction, and returns 200 `{ success: true, message: "Event already processed", duplicate: true }`.
3. **Correlation to Order & Initiated Payment Session:**
   - **Order Correlation:** Looks up `Order` by `payload.orderId`. If not found, returns 404 `ORDER_NOT_FOUND`. Zero writes.
   - **Payment Session Correlation:** Looks up `PaymentTransaction` by `order_id == payload.orderId`.
     - **Missing Session:** If no `PaymentTransaction` exists for the order (e.g. callback arrives for an order where payment checkout was never initiated), returns 404 `PAYMENT_SESSION_NOT_FOUND` with message `"No payment session found for this order"`. **Zero writes** to payment, order, timeline, or inventory.
     - **Mismatched Session:** If a `PaymentTransaction` exists, but its `session_id` does NOT match `payload.sessionId`, returns 409 `PAYMENT_SESSION_MISMATCH` with message `"Payment session correlation ID mismatch"`. **Zero writes** to payment, order, timeline, or inventory.
4. **Amount and Currency Validation:**
   - Webhook `amount` must match `order.total_amount` exactly (to 2 decimal places) and `currency` must be `"THB"`.
   - Mismatch returns 422 `AMOUNT_MISMATCH`. **Zero writes** to payment, order, timeline, or inventory.
5. **Business Processing, Row-Level Locking, and Race Concurrency:**
   All business mutations, state transitions, stock restorations, and the recording of `PaymentWebhookEvent(eventId)` commit atomically in a single Prisma transaction (`prisma.$transaction`).
   The transaction acquires an atomic row-level lock on the order (`SELECT ... FROM orders WHERE id = $1 FOR UPDATE`).
   - **Concurrency with F-07 Customer Cancellation:**
     Both F-07 cancellation (`POST /api/orders/:id/cancel`) and F-09 callback acquire `FOR UPDATE` on `Order`. F-07's guarded conditional update serializes competing status changes and returns `HTTP 409 INVALID_TRANSITION` (`{ success: false, error: { code: "INVALID_TRANSITION", message: "Only pending orders can be cancelled." } }`) whenever the order is no longer `PENDING`.
     - **If callback locks first:**
       - `SUCCESS` callback wins: order transitions `PENDING` -> `CONFIRMED`. Competing F-07 cancellation fails with **HTTP 409 `INVALID_TRANSITION`**, and **zero stock restoration occurs**.
       - `FAILED` callback wins: order transitions `PENDING` -> `CANCELLED` and restores stock once. Competing F-07 cancellation fails with **HTTP 409 `INVALID_TRANSITION`**, and **zero additional stock restoration occurs** (total: exactly 1 restoration).
     - **If F-07 locks first:**
       - Customer cancellation wins: order transitions `PENDING` -> `CANCELLED` and restores stock once.
       - A competing `SUCCESS` callback sees `order.status == CANCELLED`, enters Path C (flags `REFUND_REQUIRED`, zero stock modification, returns 409 `ORDER_ALREADY_CANCELLED`). Total stock restorations: exactly 1.
       - A competing `FAILED` callback sees `order.status == CANCELLED`, enters Path E (records failure, zero stock modification, returns 200). Total stock restorations: exactly 1.
     - Across all interleaved executions, at most one order status transition takes effect, and inventory stock is restored at most once.
   - **Path A: SUCCESS callback on PENDING order:**
     - Atomically transitions order status `PENDING` -> `CONFIRMED`.
     - Updates `PaymentTransaction`: `status: "SUCCESS"`, `gateway_ref: payload.gatewayRef`.
     - Records `OrderStatusEvent` (F-08): `from_status: "PENDING"`, `to_status: "CONFIRMED"`, `actor_id: null` (system gateway).
     - Inventory: Stock was decremented at checkout; stock remains unchanged.
     - Inserts `PaymentWebhookEvent` with `payload.eventId`.
     - Returns 200 `{ success: true, message: "Payment confirmed and order updated" }`.
   - **Path B: SUCCESS callback on Order Already CONFIRMED by Operator:**
     - When an Operator has previously confirmed the order manually (`PATCH /api/operator/orders/:id/status`), order status is already `CONFIRMED`, but `PaymentTransaction.status` is still `PENDING`.
     - Updates `PaymentTransaction`: `status: "SUCCESS"`, `gateway_ref: payload.gatewayRef`.
     - Order status is already `CONFIRMED`; **no duplicate `OrderStatusEvent`** is created and no invalid status transition is attempted.
     - Inserts `PaymentWebhookEvent` with `payload.eventId`.
     - Inventory remains unchanged.
     - Returns 200 `{ success: true, message: "Payment recorded successfully; order already confirmed" }`.
   - **Path C: SUCCESS callback on Order Already CANCELLED (Late Callback):**
     - Customer cancelled order under F-07 before payment callback arrived. Cannot resurrect a cancelled order.
     - Updates `PaymentTransaction`: `status: "REFUND_REQUIRED"`, `gateway_ref: payload.gatewayRef`.
     - Order remains `CANCELLED`; no timeline resurrection event; stock remains restored for other buyers.
     - Inserts `PaymentWebhookEvent` with `payload.eventId`.
     - Returns 409 `ORDER_ALREADY_CANCELLED` `{ success: false, code: "ORDER_ALREADY_CANCELLED", message: "Order is already cancelled; payment flagged for refund" }`.
     *(Note: Any subsequent replay of this `eventId` is caught by Step 2 and returns 200 idempotent acknowledgment).*
   - **Path D: FAILED callback on PENDING order:**
     - Atomically transitions order status `PENDING` -> `CANCELLED`.
     - Updates `PaymentTransaction`: `status: "FAILED"`, `gateway_ref: payload.gatewayRef`.
     - Records `OrderStatusEvent`: `from_status: "PENDING"`, `to_status: "CANCELLED"`, `actor_id: null`.
     - **Inventory Restoration:** Atomically increments `stock` for all saved `OrderItems`, locking product rows in ascending ID order (`ORDER BY id ASC`) to eliminate deadlocks (`40P01`) consistent with F-06 and F-07.
     - Inserts `PaymentWebhookEvent` with `payload.eventId`.
     - Returns 200 `{ success: true, message: "Payment failure recorded and stock restored" }`.
   - **Path E: FAILED callback on Order Already CANCELLED & Settled State Rules:**
     - **Settled State Protection:** If `PaymentTransaction` has already reached `REFUND_REQUIRED` (from Path C), a subsequent `FAILED` callback for the same session MUST NOT overwrite `REFUND_REQUIRED` to `FAILED`. The status `REFUND_REQUIRED` is strictly preserved, stock is not modified, and the server acknowledges with 200 `{ success: true, message: "Payment already settled as refund required" }`.
     - If `PaymentTransaction` is in `PENDING`, updates `PaymentTransaction`: `status: "FAILED"`.
     - Order is already `CANCELLED` and stock already restored; zero duplicate restorations or events.
     - Inserts `PaymentWebhookEvent` with `payload.eventId`.
     - Returns 200 `{ success: true, message: "Payment failure recorded" }`.

### Data Model (`schema.prisma` additions)

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
  session_id      String        @unique // unique correlation token issued to client & gateway
  amount          Float
  currency        String        @default("THB")
  status          PaymentStatus @default(PENDING)
  method          PaymentMethod @default(PROMPTPAY)
  gateway_ref     String?       // settlement reference issued by payment gateway
  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt
  order           Order         @relation(fields: [order_id], references: [id], onDelete: Cascade)

  @@map("payment_transactions")
}

model PaymentWebhookEvent {
  id              String        @id @default(cuid())
  event_id        String        @unique // gateway delivery event ID for deduplication/replay
  order_id        String
  session_id      String
  status          String
  gateway_ref     String?
  created_at      DateTime      @default(now())

  @@index([order_id])
  @@map("payment_webhook_events")
}
```

### Acceptance criteria and software test specifications

| AC / STS | Layer and expectation |
| --- | --- |
| AC-F09-01 / TEST-F09-01 | API/DB (PostgreSQL): Customer initiates payment (`POST /api/orders/:id/pay`) on their PENDING order; receives and persists unique `session_id` and `PaymentTransaction(PENDING)`. Two simultaneous first-time requests (`Promise.all`) serialize and both return HTTP 200 with the identical `sessionId` and create exactly one `PaymentTransaction` row. Subsequent repeated initiation reuses and returns the existing active `sessionId` without breaking in-flight callbacks. Unauthenticated receives 401, stranger Customer receives 403, and non-PENDING order returns 409. |
| AC-F09-02 / TEST-F09-02 | API/DB: Payment status read (`GET /api/orders/:id/payment`). Returns 200 with `payment: null` for order without initiated payment session. Returns 200 with full payment fields after initiation. Anonymous caller receives 401, stranger Customer receives 403, unknown order returns 404. |
| AC-F09-03 / TEST-F09-03 | API/DB: Valid webhook `SUCCESS` callback on PENDING order. Transitions order to `CONFIRMED`, creates `OrderStatusEvent`, updates payment status to `SUCCESS` with `gatewayRef`, preserves inventory stock, and commits `PaymentWebhookEvent`. |
| AC-F09-04 / TEST-F09-04 | API/DB: Valid webhook `FAILED` callback on PENDING order. Transitions order to `CANCELLED`, creates cancellation `OrderStatusEvent`, updates payment status to `FAILED`, and restores stock for all multi-item line items in sorted product ID order. |
| AC-F09-05 / TEST-F09-05 | API/DB: Webhook session correlation validation. Webhook referencing order with no initiated payment returns 404 `PAYMENT_SESSION_NOT_FOUND`. Webhook with mismatched `sessionId` returns 409 `PAYMENT_SESSION_MISMATCH`. Both scenarios guarantee zero writes to payment, order, timeline, or inventory. |
| AC-F09-06 / TEST-F09-06 | API: Webhook security and payload validation. Missing or invalid secret header returns 401 `INVALID_SIGNATURE`. Unknown `orderId` returns 404 `ORDER_NOT_FOUND`. Amount or currency mismatch returns 422 `AMOUNT_MISMATCH` with zero writes. |
| AC-F09-07 / TEST-F09-07 | API/DB: Replay deduplication rules. Replaying any already-processed `eventId` immediately returns 200 `{ duplicate: true }` without database mutations. Replaying an `eventId` whose original run returned 409 (late callback on cancelled order) also acknowledges with 200. |
| AC-F09-08 / TEST-F09-08 | API/DB: Webhook `SUCCESS` callback on Operator-confirmed order. When order was already confirmed by Operator, callback updates `PaymentTransaction` from `PENDING` -> `SUCCESS` with `gatewayRef`, does not create duplicate order timeline events, and returns 200. |
| AC-F09-09 / TEST-F09-09 | API/DB: Late webhook `SUCCESS` on customer-cancelled order. Updates `PaymentTransaction` status to `REFUND_REQUIRED`, preserves order `CANCELLED` status and restored stock, records `PaymentWebhookEvent`, and returns 409 `ORDER_ALREADY_CANCELLED`. |
| AC-F09-10 / TEST-F09-10 | UI/E2E: Customer payment workflow in My Orders. Displays "Pay" button only for `PENDING` orders. Launches modal to select `PROMPTPAY` vs `CREDIT_CARD`. Shows processing state while polling `GET /api/orders/:id/payment`. On success, dismisses modal, updates order badge to `CONFIRMED`, removes "Pay" and "Cancel" buttons, and updates timeline. |
| AC-F09-11 / TEST-F09-11 | API/DB (PostgreSQL): Concurrent webhook replay race. Two simultaneous requests with identical `eventId` execute; unique constraint collision on `PaymentWebhookEvent(eventId)` is caught and the losing request returns 200 `{ duplicate: true }` with zero duplicate mutations. |
| AC-F09-12 / TEST-F09-12 | API/DB (PostgreSQL): Webhook callback racing with F-07 customer cancellation. Competing requests serialize on the order's atomic guard/lock. When `SUCCESS` callback wins, order transitions to `CONFIRMED`, cancellation receives HTTP 409 `INVALID_TRANSITION`, and zero stock restoration occurs. When cancellation wins against `SUCCESS`, order transitions to `CANCELLED` and restores stock once, and callback sets `REFUND_REQUIRED` with 409 and zero additional restoration (total: 1 restoration). When `FAILED` callback races with cancellation, whichever wins cancels the order and restores stock once; the loser receives HTTP 409 `INVALID_TRANSITION` (cancellation) or 200 (callback Path E) with zero additional restoration (total: 1 restoration). |
| AC-F09-13 / TEST-F09-13 | API/DB: Settled payment state preservation. When payment is `REFUND_REQUIRED`, a subsequent `FAILED` event with distinct `eventId` preserves `REFUND_REQUIRED` (does not overwrite to `FAILED`), leaves stock untouched, and returns 200. |

### Final Delivery implementation and verification plan

This specification establishes the complete contract for the remaining Sprint 3 baseline scope.
Full implementation, automated test suites (unit mock + live PostgreSQL integration), and UI payment modal are scheduled for Final Delivery:
- **Owner:** @thanapornboont-star
- **Target completion date:** 13 December 2026 (Final Delivery Milestone)
- **Dependencies:** OrderItems schema (F-06), status cancellation logic (F-07), and order timeline event logging (F-08).
- **Execution evidence:** Linked to Final Delivery feature Issue upon completion.


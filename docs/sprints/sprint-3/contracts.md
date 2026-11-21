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
   - Clicking "Pay" opens the Payment Modal displaying Order ID, created timestamp, line item summary, and formatted total amount (`฿XX.XX`).
   - If an active `PaymentTransaction` already exists in `PENDING` status for this order, the modal pre-selects the stored `method` from that session. Otherwise, it defaults to `PROMPTPAY`.
   - The user can select between `PROMPTPAY` (Thai QR code standard) and `CREDIT_CARD`.
   - The modal provides "Confirm Payment" and "Cancel" buttons.
2. **Initiation & Waiting State:**
   - Clicking "Confirm Payment" dispatches `POST /api/orders/:id/pay` with `{ "method": "PROMPTPAY" | "CREDIT_CARD" }`.
   - On receiving 200 with `{ sessionId, orderId, amount, currency, method, status: "PENDING" }`, the modal switches to the Processing / Settlement state:
     - For `PROMPTPAY`: Renders a simulated PromptPay QR code with payment amount and countdown timer.
     - For `CREDIT_CARD`: Renders a simulated secure card gateway processing spinner.
     - Displays notice: "Awaiting payment confirmation... Please do not close this window."
     - The client polls `GET /api/orders/:id/payment` every 2 seconds to detect payment settlement.
3. **Runnable Simulated Gateway Controls (Testing & Dev Mode):**
   - **Zero Client Secrets (NFR-04):** Neither the browser bundle nor browser network requests ever contain or transmit `PAYMENT_WEBHOOK_SECRET`.
   - In development / test environments (`NODE_ENV !== 'production'`), the modal exposes two interactive testing actions: **"Simulate Gateway Success"** and **"Simulate Gateway Failure"**.
   - Clicking either action calls an authenticated, dev-only backend endpoint: `POST /api/orders/:id/simulate-payment` with `{ "outcome": "SUCCESS" | "FAILED" }`.
   - The backend validates the caller's session and order ownership, constructs the callback payload, signs it with the server's private `PAYMENT_WEBHOOK_SECRET`, and dispatches it directly to `POST /api/webhooks/payment` server-side.
   - In production builds (`NODE_ENV === 'production'`), simulation controls are disabled / excluded from the UI, and the dev simulator route returns 404.
   - Automated integration tests drive `POST /api/webhooks/payment` directly from the test runner using the server environment secret.
4. **Outcome States & Polling Termination:**
   - The client polls `GET /api/orders/:id/payment` and `GET /api/orders/:id` every 2 seconds to inspect both payment settlement and order progression.
   - **On SUCCESS callback:** Polling detects `status: "SUCCESS"`. Polling ceases immediately. The modal displays a green checkmark: "Payment Successful! Your order has been confirmed." After 1.5 seconds, the modal auto-dismisses. In the My Orders table, the order badge updates to `CONFIRMED` (or reflects `SHIPPED` if already dispatched), "Pay" and "Cancel Order" buttons disappear, and "View Timeline" immediately reflects the payment confirmation transition (`PENDING` -> `CONFIRMED`).
   - **On FAILED callback:** Polling detects `status: "FAILED"`. Polling ceases immediately.
     - **If order is CANCELLED (`order.status === "CANCELLED"`):** Order badge displays `CANCELLED`. Modal displays: "Payment authorization failed. Your order has been cancelled and items returned to stock." Next step: A "Close" button dismisses the modal. "Pay" and "Cancel Order" buttons are removed.
     - **If order is CONFIRMED (`order.status === "CONFIRMED"`):** Order badge remains `CONFIRMED`. Modal displays: "Payment authorization failed, but your order has been confirmed by our team. Please contact customer support to arrange an alternate payment method." Next step: A "Contact Support" button/link and a "Close" button. The modal does NOT offer a "Retry" button (as non-PENDING orders reject `/pay`), and "Pay" is hidden.
     - **If order is SHIPPED (`order.status === "SHIPPED"`):** Order badge remains `SHIPPED`. Modal displays: "Payment authorization failed, but your order has already shipped. Please contact customer support immediately to resolve your balance." Next step: A "Contact Support" button/link and a "Close" button. "Pay" is hidden.
   - **On REFUND_REQUIRED (Late Callback):** Polling detects `status: "REFUND_REQUIRED"`. Polling ceases immediately. The modal displays: "Order was cancelled prior to payment completion. Your payment has been received and flagged for refund." The modal closes and the order reflects `CANCELLED (Refund Flagged)`.
   - **On Timeout (5 Minutes):** If polling runs for 5 minutes without settlement, polling ceases. The modal displays: "Payment session timed out. If you were charged, your order status will update automatically. You can retry payment from My Orders." A "Close" button dismisses the modal while the order remains `PENDING`.
   - **On Modal Dismissal without payment:** The customer can close the modal before payment authorization. The order remains `PENDING` and unpaid; the "Pay" button remains available.

### Backend Endpoints

| Method and path | Caller | Headers / Payload | Success response | Error codes |
| --- | --- | --- | --- | --- |
| `POST /api/orders/:id/pay` | Customer (owner) | Header: `Authorization: Bearer <token>`<br>Body: `{ "method": "PROMPTPAY" \| "CREDIT_CARD" }` | 200 `{ success: true, data: { sessionId, orderId, amount, currency, method, status } }` | 400 `INVALID_PAYMENT_METHOD`<br>401 `UNAUTHORIZED`<br>403 `FORBIDDEN`<br>404 `ORDER_NOT_FOUND`<br>409 `INVALID_ORDER_STATUS` |
| `GET /api/orders/:id/payment` | Customer (owner) / Operator | Header: `Authorization: Bearer <token>` | 200 `{ success: true, data: { payment } }` | 401 `UNAUTHORIZED`<br>403 `FORBIDDEN`<br>404 `ORDER_NOT_FOUND` |
| `POST /api/webhooks/payment` | Gateway (public + secret) | Header: `X-Webhook-Secret: <secret>`<br>Body: `{ "eventId", "orderId", "sessionId", "gatewayRef", "amount", "currency", "status", "timestamp" }` | 200 `{ success: true, message: string, data?: { orderId, status } }` | 400 `INVALID_PAYMENT_STATUS`<br>401 `INVALID_SIGNATURE`<br>404 `ORDER_NOT_FOUND`<br>404 `PAYMENT_SESSION_NOT_FOUND`<br>409 `PAYMENT_SESSION_MISMATCH`<br>409 `ORDER_ALREADY_CANCELLED`<br>409 `ORDER_ALREADY_CONFIRMED`<br>409 `ORDER_ALREADY_SHIPPED`<br>409 `PAYMENT_ALREADY_SETTLED`<br>422 `AMOUNT_MISMATCH` |

#### Payment Initiation (`POST /api/orders/:id/pay`)
- **Authorization:** Requires valid JWT (401 `UNAUTHORIZED`). Caller must be the customer who owns the order (403 `FORBIDDEN`).
- **Preconditions:** Order must exist (404 `ORDER_NOT_FOUND`) and its status must be `PENDING`. Any other status (`CONFIRMED`, `SHIPPED`, `CANCELLED`) returns 409 `INVALID_ORDER_STATUS`.
- **Payload Validation:** `method` must be either `"PROMPTPAY"` or `"CREDIT_CARD"`. Unsupported or missing values reject immediately with 400 `INVALID_PAYMENT_METHOD` (`{ "success": false, "error": { "code": "INVALID_PAYMENT_METHOD", "message": "Method must be one of: PROMPTPAY, CREDIT_CARD" } }`).
- **Session Issuance & Idempotent Initiation:**
  - Generates a unique correlation token `sessionId` (e.g. `pay_sess_<uuid>`).
  - **Active Session Reuse:** If a `PaymentTransaction` already exists for this order with `status == PENDING`, the server reuses and returns the active `sessionId` and transaction data rather than generating a new session or overwriting the existing record. If the existing session is returned, the UI renders the stored `method`.
  - **Simultaneous First-Time Initiation:** When two initiation requests arrive concurrently for an order before any transaction exists, both requests are serialized via `SELECT ... FROM orders WHERE id = $1 FOR UPDATE` (or the losing insert catches the `order_id @unique` collision, rolls back, and reloads the winning `PaymentTransaction`). Both simultaneous callers receive HTTP 200 with the exact same winning `sessionId`, and exactly one `PaymentTransaction` row is created in the database.
  - **Replacement & Transaction Guard:** Creating a replacement session is only permitted if the prior transaction reached a terminal failed state without cancelling the order. Session replacement executes under the same atomic row lock as settlement (`FOR UPDATE`), ensuring that any in-flight callback targeting a superseded session evaluates against the newly committed `session_id` and fails correlation with 409 `PAYMENT_SESSION_MISMATCH` with zero writes.
  - Returns 200 with:
    ```json
    {
      "success": true,
      "data": {
        "sessionId": "pay_sess_clx123",
        "orderId": "ord_abc456",
        "amount": 250.00,
        "currency": "THB",
        "method": "PROMPTPAY",
        "status": "PENDING"
      }
    }
    ```

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
2. **Payload Validation:**
   - `status` must be either `"SUCCESS"` or `"FAILED"`. Any other value returns 400 `INVALID_PAYMENT_STATUS` (`{ "success": false, "error": { "code": "INVALID_PAYMENT_STATUS", "message": "Status must be one of: SUCCESS, FAILED" } }`).
   - Webhook `amount` must match `order.total_amount` exactly (to 2 decimal places) and `currency` must be `"THB"`. Mismatch returns 422 `AMOUNT_MISMATCH`. Zero writes.
3. **Replay Deduplication (Separate from Order State):**
   - The webhook handler queries `PaymentWebhookEvent` for `event_id == payload.eventId`.
   - **If `eventId` has already been processed (Replay):**
     Immediately returns 200 `{ success: true, message: "Event already processed", duplicate: true }`.
     Zero mutations occur: no duplicate status events, no payment record changes, and no stock adjustments.
     **Replay Rule:** This 200 idempotent acknowledgment applies to *all* replayed `eventId` deliveries, including deliveries whose original execution returned 409 (such as a late callback on a cancelled order). This guarantees that the payment gateway receives a reliable 200 receipt and halts retries.
   - **Concurrent Replay Delivery Collision:** If two identical callback deliveries race concurrently past the initial lookup, the insert of `PaymentWebhookEvent(eventId)` will trigger a unique constraint collision on `event_id` (`P2002` in Prisma / `23505` in PostgreSQL). The handler explicitly catches this collision, rolls back the concurrent sub-transaction, and returns 200 `{ success: true, message: "Event already processed", duplicate: true }`.
4. **Correlation to Order & Initiated Payment Session:**
   - **Order Correlation:** Looks up `Order` by `payload.orderId`. If not found, returns 404 `ORDER_NOT_FOUND`. Zero writes.
   - **Payment Session Correlation:** Looks up `PaymentTransaction` by `order_id == payload.orderId`.
     - **Missing Session:** If no `PaymentTransaction` exists for the order (e.g. callback arrives for an order where payment checkout was never initiated), returns 404 `PAYMENT_SESSION_NOT_FOUND` with message `"No payment session found for this order"`. **Zero writes** to payment, order, timeline, or inventory.
     - **Mismatched / Superseded Session:** If a `PaymentTransaction` exists, but its `session_id` does NOT match `payload.sessionId`, returns 409 `PAYMENT_SESSION_MISMATCH` with message `"Payment session correlation ID mismatch"`. **Zero writes** to payment, order, timeline, or inventory.
5. **Settlement Matrix and State Machine:**
   All mutations, status updates, stock restorations, and event receipts execute atomically inside `prisma.$transaction` guarded by an atomic row lock on `Order` (`SELECT ... FOR UPDATE`).
   The matrix below specifies the exact outcomes across all combinations of order and payment states:

| Order Status | Payment Status | Callback Status | Payment Next | Order Next | Timeline Event | Stock Restoration | Response |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PENDING` | `PENDING` | `SUCCESS` | `SUCCESS` (`gatewayRef`) | `CONFIRMED` | Yes (`PENDING` $\rightarrow$ `CONFIRMED`) | 0 (already deducted at checkout) | 200 OK |
| `PENDING` | `PENDING` | `FAILED` | `FAILED` (`gatewayRef`) | `CANCELLED` | Yes (`PENDING` $\rightarrow$ `CANCELLED`) | Exactly 1 restoration (`stock_restored = true`) | 200 OK |
| `CONFIRMED` (Operator) | `PENDING` | `SUCCESS` | `SUCCESS` (`gatewayRef`) | `CONFIRMED` (unchanged) | None (already confirmed) | 0 | 200 OK |
| `CONFIRMED` (Operator) | `PENDING` | `FAILED` | `FAILED` (`gatewayRef`) | `CONFIRMED` (unchanged) | None | 0 (Operator confirmed order) | 409 `ORDER_ALREADY_CONFIRMED` |
| `CONFIRMED` | `SUCCESS` | `SUCCESS` (new evt) | `SUCCESS` (preserved) | `CONFIRMED` (unchanged) | None | 0 | 200 OK (settled receipt) |
| `CONFIRMED` | `SUCCESS` | `FAILED` (new evt) | `SUCCESS` (immutable) | `CONFIRMED` (unchanged) | None | 0 | 409 `PAYMENT_ALREADY_SETTLED` |
| `SHIPPED` | `PENDING` | `SUCCESS` | `SUCCESS` (`gatewayRef`) | `SHIPPED` (unchanged) | None | 0 | 200 OK |
| `SHIPPED` | `PENDING` | `FAILED` | `FAILED` (`gatewayRef`) | `SHIPPED` (unchanged) | None | 0 (goods already dispatched) | 409 `ORDER_ALREADY_SHIPPED` |
| `SHIPPED` | `SUCCESS` | `SUCCESS` (new evt) | `SUCCESS` (preserved) | `SHIPPED` (unchanged) | None | 0 | 200 OK (settled receipt) |
| `SHIPPED` | `SUCCESS` | `FAILED` (new evt) | `SUCCESS` (immutable) | `SHIPPED` (unchanged) | None | 0 | 409 `PAYMENT_ALREADY_SETTLED` |
| `SHIPPED` | `FAILED` | `SUCCESS` (new evt) | `SUCCESS` (`gatewayRef`) | `SHIPPED` (unchanged) | None | 0 (goods already dispatched) | 200 OK |
| `CANCELLED` | `PENDING` | `SUCCESS` (late) | `REFUND_REQUIRED` | `CANCELLED` (unchanged) | None | 1 if `stock_restored == false`; 0 if `true` | 409 `ORDER_ALREADY_CANCELLED` |
| `CANCELLED` | `PENDING` | `FAILED` | `FAILED` | `CANCELLED` (unchanged) | None | 1 if `stock_restored == false`; 0 if `true` | 200 OK |
| `CANCELLED` | `REFUND_REQUIRED` | `FAILED` (new evt) | `REFUND_REQUIRED` (immutable) | `CANCELLED` (unchanged) | None | 0 | 200 OK |
| `CANCELLED` | `FAILED` | `SUCCESS` (new evt) | `REFUND_REQUIRED` | `CANCELLED` (unchanged) | None | 0 | 409 `ORDER_ALREADY_CANCELLED` |

- **Default for Unlisted Reachable State Pairs:** For any other unlisted combination where an incoming event with a distinct `eventId` conflicts with a settled terminal payment (`SUCCESS`, `REFUND_REQUIRED`): the existing payment status, order status, and inventory stock are strictly preserved (immutable, zero mutations), and the endpoint returns 409 `PAYMENT_ALREADY_SETTLED`. Replay of the *exact same* `eventId` continues to return 200 OK under the separate deduplication receipt rule (Step 3).

6. **Stock Restoration Tracking and Rollback Behavior:**
   - **Stock Restoration Tracking (`order.stock_restored`):**
     - Customer cancellation (F-07) and F-09 failure on `PENDING` order (Path D) restore stock once and set `stock_restored = true`.
     - Legacy Operator Cancel (`PATCH /api/operator/orders/:id/status` CANCELLED) sets status `CANCELLED` but leaves `stock_restored = false`.
     - When a callback encounters an already `CANCELLED` order (Paths C and E), it inspects `order.stock_restored`:
       - If `order.stock_restored == false`: Atomically restores stock for all saved `OrderItems` in ascending product ID order and sets `stock_restored = true`.
       - If `order.stock_restored == true`: Bypasses restocking (zero duplicate restorations).
   - **Concurrency with F-07 Customer Cancellation:**
     Both F-07 cancellation (`POST /api/orders/:id/cancel`) and F-09 callback acquire `FOR UPDATE` on `Order`. F-07's guarded conditional update serializes competing status changes and returns `HTTP 409 INVALID_TRANSITION` (`{ success: false, error: { code: "INVALID_TRANSITION", message: "Only pending orders can be cancelled." } }`) whenever the order is no longer `PENDING`.
     - **If callback locks first:**
       - `SUCCESS` callback wins: order transitions `PENDING` -> `CONFIRMED`. Competing F-07 cancellation fails with **HTTP 409 `INVALID_TRANSITION`**, and **zero stock restoration occurs**.
       - `FAILED` callback wins: order transitions `PENDING` -> `CANCELLED` and restores stock once. Competing F-07 cancellation fails with **HTTP 409 `INVALID_TRANSITION`**, and **zero additional stock restoration occurs** (total: exactly 1 restoration).
     - **If F-07 locks first:**
       - Customer cancellation wins: order transitions `PENDING` -> `CANCELLED` and restores stock once (`stock_restored = true`).
       - A competing `SUCCESS` callback sees `order.status == CANCELLED`, enters Path C (flags `REFUND_REQUIRED`, sees `stock_restored == true`, zero stock modification, returns 409 `ORDER_ALREADY_CANCELLED`). Total stock restorations: exactly 1.
       - A competing `FAILED` callback sees `order.status == CANCELLED`, enters Path E (records failure, sees `stock_restored == true`, zero stock modification, returns 200). Total stock restorations: exactly 1.
     - Across all interleaved executions, at most one order status transition takes effect, and inventory stock is restored at most once.
   - **Rollback Behavior:**
     All database mutations, row locks, stock increments, and receipt logs commit inside a single atomic Prisma transaction. If any query fails (e.g. database error, lock timeout, constraint violation), the entire transaction rolls back completely (zero partial writes) and returns 500 `SERVER_ERROR`.

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

// Additive field on Order model
model Order {
  // ... existing fields ...
  stock_restored  Boolean       @default(false)
  payment         PaymentTransaction?
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
| AC-F09-02 / TEST-F09-02 | API/DB: Payment status read (`GET /api/orders/:id/payment`). Returns 200 with `payment: null, status: "UNPAID"` for order without initiated payment session. Returns 200 with full payment fields after initiation. Anonymous caller receives 401, stranger Customer receives 403, unknown order returns 404. |
| AC-F09-03 / TEST-F09-03 | API/DB: Valid webhook `SUCCESS` callback on PENDING order. Transitions order to `CONFIRMED`, creates `OrderStatusEvent`, updates payment status to `SUCCESS` with `gatewayRef`, preserves inventory stock, and commits `PaymentWebhookEvent`. |
| AC-F09-04 / TEST-F09-04 | API/DB: Valid webhook `FAILED` callback on PENDING order. Transitions order to `CANCELLED`, creates cancellation `OrderStatusEvent`, updates payment status to `FAILED`, sets `stock_restored = true`, and restores stock for all multi-item line items in sorted product ID order. |
| AC-F09-05 / TEST-F09-05 | API/DB: Webhook session correlation validation. Webhook referencing order with no initiated payment returns 404 `PAYMENT_SESSION_NOT_FOUND`. Webhook with mismatched `sessionId` returns 409 `PAYMENT_SESSION_MISMATCH`. Callback targeting a superseded session cannot settle a replacement session. All scenarios guarantee zero writes to payment, order, timeline, or inventory. |
| AC-F09-06 / TEST-F09-06 | API: Webhook security and payload validation. Missing or invalid secret header returns 401 `INVALID_SIGNATURE`. Unknown `orderId` returns 404 `ORDER_NOT_FOUND`. Amount or currency mismatch returns 422 `AMOUNT_MISMATCH`. Unsupported payment method or status value returns 400. Zero writes across all invalid requests. |
| AC-F09-07 / TEST-F09-07 | API/DB: Replay deduplication rules. Replaying any already-processed `eventId` immediately returns 200 `{ duplicate: true }` without database mutations. Replaying an `eventId` whose original run returned 409 (late callback on cancelled order) also acknowledges with 200. |
| AC-F09-08 / TEST-F09-08 | API/DB: Webhook callback on Operator-confirmed order. When order was already confirmed by Operator, a `SUCCESS` callback updates payment to `SUCCESS` (200) without duplicate timeline events. A `FAILED` callback updates payment to `FAILED` and returns 409 `ORDER_ALREADY_CONFIRMED` leaving the order `CONFIRMED`. |
| AC-F09-09 / TEST-F09-09 | API/DB: Late webhook `SUCCESS` on customer-cancelled order. Updates `PaymentTransaction` status to `REFUND_REQUIRED`, preserves order `CANCELLED` status and restored stock, records `PaymentWebhookEvent`, and returns 409 `ORDER_ALREADY_CANCELLED`. |
| AC-F09-10 / TEST-F09-10 | UI/E2E: Customer payment workflow in My Orders. Displays "Pay" button only for `PENDING` orders. Launches modal to select `PROMPTPAY` vs `CREDIT_CARD`. Shows processing state while polling `GET /api/orders/:id/payment` and `GET /api/orders/:id`. Client bundle and browser requests contain zero webhook secrets (NFR-04). In dev/test mode, modal uses authenticated dev-only endpoint `POST /api/orders/:id/simulate-payment` to dispatch server-side callbacks; disabled in production. Polling inspects payment and order state: on SUCCESS, displays green confirmation and updates badge; on FAILED for cancelled order, displays cancellation and stock return; on FAILED for Operator-confirmed order, keeps CONFIRMED badge and displays contact support without retry button; on FAILED for shipped order, keeps SHIPPED badge and displays contact support without retry button; on REFUND_REQUIRED, displays flagged for refund; on 5-minute timeout, terminates with retry option. |
| AC-F09-11 / TEST-F09-11 | API/DB (PostgreSQL): Concurrent webhook replay race. Two simultaneous requests with identical `eventId` execute; unique constraint collision on `PaymentWebhookEvent(eventId)` is caught and the losing request returns 200 `{ duplicate: true }` with zero duplicate mutations. |
| AC-F09-12 / TEST-F09-12 | API/DB (PostgreSQL): Webhook callback racing with F-07 customer cancellation. Competing requests serialize on the order's atomic guard/lock. When `SUCCESS` callback wins, order transitions to `CONFIRMED`, cancellation receives HTTP 409 `INVALID_TRANSITION`, and zero stock restoration occurs. When cancellation wins against `SUCCESS`, order transitions to `CANCELLED` and restores stock once, and callback sets `REFUND_REQUIRED` with 409 and zero additional restoration (total: 1 restoration). When `FAILED` callback races with cancellation, whichever wins cancels the order and restores stock once; the loser receives HTTP 409 `INVALID_TRANSITION` (cancellation) or 200 (callback Path E) with zero additional restoration (total: 1 restoration). |
| AC-F09-13 / TEST-F09-13 | API/DB: Settled payment state preservation and matrix consistency. When payment is `REFUND_REQUIRED`, a subsequent `FAILED` event with distinct `eventId` preserves `REFUND_REQUIRED` (does not overwrite to `FAILED`), leaves stock untouched, and returns 200. When payment is settled `SUCCESS` (on either `CONFIRMED` or `SHIPPED` order), a subsequent `FAILED` callback with distinct `eventId` returns 409 `PAYMENT_ALREADY_SETTLED` without corrupting payment or order state, while duplicate `SUCCESS` with distinct `eventId` returns 200. When order is `SHIPPED` with `FAILED` payment, a subsequent `SUCCESS` callback updates payment to `SUCCESS` (200). Unlisted conflicting events on settled states return 409 `PAYMENT_ALREADY_SETTLED`. |
| AC-F09-14 / TEST-F09-14 | API/DB (PostgreSQL): Operator-cancelled order stock handling & transaction rollback. When a late callback arrives for an order cancelled by an Operator (`stock_restored == false`), the transaction restores stock for all order items once and sets `stock_restored = true`. If stock restoration encounters an unhandled error, the entire transaction rolls back completely (zero mutations) and returns 500. |
| AC-F09-15 / TEST-F09-15 | API/DB: Webhook callback on `SHIPPED` order. When order is `SHIPPED` with `PENDING` payment, a `SUCCESS` callback transitions payment status to `SUCCESS` (`gatewayRef`), leaves order `SHIPPED`, mutates no stock, and returns 200. A `FAILED` callback on a `SHIPPED` order transitions payment to `FAILED`, leaves order `SHIPPED`, mutates no stock, and returns 409 `ORDER_ALREADY_SHIPPED`. A subsequent `SUCCESS` callback on a `SHIPPED/FAILED` order settles payment to `SUCCESS` and returns 200. |

### Final Delivery implementation and verification plan

This specification establishes the complete contract for the remaining Sprint 3 baseline scope.
Full implementation, automated test suites (unit mock + live PostgreSQL integration), and UI payment modal are scheduled for Final Delivery:
- **Owner:** @thanapornboont-star
- **Target completion date:** 13 December 2026 (Final Delivery Milestone)
- **Dependencies:** OrderItems schema (F-06), status cancellation logic (F-07), and order timeline event logging (F-08).
- **Execution evidence:** Linked to Final Delivery feature Issue upon completion.


# Sprint 2 Engineering Contracts

## F-05 · Operator catalog management

Issue #37. Author: @jiraphat-j. Reviewer: @thanapornboont-star.
Extends FR-03 (catalog), BR-03 (inventory integrity), BR-06 (role access),
NFR-01 (backend access control), and NFR-03 (persistence).

### Workflow and API

An Operator signs in, opens Product Management, and lists, creates, edits,
adjusts stock, or archives a product. Existing products start active. Each
successful write returns `{ success: true, data: { product } }`, including
`id`, `name`, `description`, `price`, `stock`, and `archived_at`. Listing
returns `data.products` and includes archived items. Failures follow the
existing `{ success: false, error: { code, message } }` format.

| Method and path under `/api/operator/products` | Input | Success |
| --- | --- | --- |
| GET `/` | None | 200 list |
| POST `/` | `name`, optional nullable `description`, `price`, `stock` | 201 product |
| PATCH `/:id` | At least one of `name`, `description`, `price` | 200 product |
| PATCH `/:id/stock` | `stock`, `expectedStock` | 200 product |
| POST `/:id/archive` | None | 200 product, including repeated requests |

All Operator routes require authentication and the Operator role (401/403).
Names are trimmed and nonempty. Description is a string or null. Price is a
finite positive THB amount with at most two decimal places. Stock and
expectedStock are integers in the PostgreSQL integer range, including zero.
Malformed fields return 400. Unknown products return 404. Editing or adjusting
an archived product returns 409 `PRODUCT_ARCHIVED`. A stale stock edit returns
409 `STOCK_CHANGED` and the UI reloads the current list before retry.

The public catalog includes only products with a null `archived_at`. Order
placement checks availability in the guarded inventory decrement within its
transaction. Archived products return 409 `PRODUCT_ARCHIVED` without creating an
order or changing stock. Order history uses saved unit prices and totals.
The migration retains all product rows and order relationships. Re-running
product seeding inserts missing defaults and preserves existing data.

### Acceptance criteria and software test specifications

| AC / STS | Scope and expected result |
| --- | --- |
| AC-F05-01 / TEST-F05-01 | Operator creates a product, edits details, and reloads the list. The stored values appear. |
| AC-F05-02 / TEST-F05-02 | Stock zero succeeds. A stale edit returns 409. Negative/fractional stock and invalid prices return 400 without mutation. |
| AC-F05-03 / TEST-F05-03 | Archive hides the product in the public catalog. A checkout whose guarded decrement sees an archived product returns 409 and creates no order. Historical order and line prices remain readable. |
| AC-F05-04 / TEST-F05-04 | Each new route rejects unauthenticated and Customer sessions before touching storage. |
| AC-F05-05 / TEST-F05-05 | On PostgreSQL, modify and archive a seeded item, re-run migration and seed, restart, and check that price, stock and archive state persist. Repeat the check on the integrated release. |

F-06 integration contract: checkout rejects an archived cart line with
`PRODUCT_ARCHIVED` and rolls back the whole order. The cart should tell the
customer to remove the unavailable item. F-05 implements the existing
single-item path.

Definition of Done: contract precedes implementation, RED/GREEN and regression
results identify commits, Operator and Customer UI journeys are checked, the
teammate reviews the staging PR, and deployed verification is recorded at release.

## F-06 · Atomic multi-item checkout

Issue #38. Author: @thanapornboont-star. Reviewer: @jiraphat-j.
Extends FR-04 (order placement), FR-05 (order calculation), BR-02 (order status),
BR-03 (inventory integrity), BR-04 (total calculation), BR-06 (role access),
NFR-01 (backend access control), and NFR-03 (persistence & transactions).

### Workflow and API

A Customer adds products to a shopping cart, adjusts quantities, and checks out.
The checkout request is processed atomically: if all items are active and have
sufficient stock, an Order in `PENDING` status is created with corresponding
`OrderItem` rows, stock is decremented for each product, and the total amount is
authoritatively calculated on the server using database prices. If any item is
invalid, archived, or lacks stock, the entire transaction rolls back; no order is
created and no stock is mutated.

| Method and path | Payload | Success response |
| --- | --- | --- |
| POST `/api/orders` | `{ "items": [{ "productId": string, "quantity": number }] }` or backward-compatible `{ "productId": string, "quantity": number }` | 201 `{ success: true, data: { order } }` |
| GET `/api/orders/my-orders` | None | 200 `{ success: true, data: { orders } }` |
| GET `/api/orders/:id` | None | 200 `{ success: true, data: { order } }` |

Validation and error behavior:
- All `/api/orders` endpoints require authentication. Unauthenticated requests receive 401 `UNAUTHORIZED`.
- Only `CUSTOMER` role may place orders. `OPERATOR` requests receive 403 `FORBIDDEN`.
- Empty cart payload (`items: []` or missing `items` without `productId`) returns 400 `INVALID_ORDER`.
- Quantities must be positive integers ($\ge 1$ and $\le 2,147,483,647$). Non-integers, zero, negative quantities, or malformed product IDs return 400 `INVALID_QUANTITY` or `INVALID_PRODUCT`.
- Duplicate product IDs in `items`: aggregated by summing quantities before validation and decrement.
- Prices in cart: client-provided prices are ignored. Authoritative prices from `Product.price` in the database are used to compute `unit_price` and `total_amount`. Stale prices displayed in the client do not affect the backend calculation.
- Missing product returns 404 `PRODUCT_NOT_FOUND`.
- Archived product (`archived_at != null`) returns 409 `PRODUCT_ARCHIVED` and rolls back the entire checkout.
- Insufficient stock for any item returns 400 `INSUFFICIENT_STOCK` and rolls back all stock decrements.
- Atomicity: executed inside a Prisma database transaction (`prisma.$transaction`). Either all lines succeed and decrement stock, or none do.
- Existing single-item format `{ productId, quantity }` remains fully supported (normalized to a single item line) to preserve Sprint 1 continuity and regression compatibility (AC-F06-05).

### Acceptance criteria and software test specifications

| AC / STS | Scope and expected result |
| --- | --- |
| AC-F06-01 / TEST-F06-01 | Checkout with two distinct in-stock products creates one PENDING order, stores both OrderItems with unit prices, calculates total_amount on the server, and decrements each product's stock by the exact quantity. |
| AC-F06-02 / TEST-F06-02 | An empty cart, zero/negative/fractional quantity, missing product, archived product, or insufficient stock for any line is rejected with actionable error (400/404/409). The transaction rolls back completely: no order is created and no stock is changed. |
| AC-F06-03 / TEST-F06-03 | Concurrent checkout cannot oversell inventory. If two requests race for the remaining stock, guarded decrement ensures only the valid purchase succeeds; the losing transaction receives 400 without inconsistent stock. |
| AC-F06-04 / TEST-F06-04 | The customer can reload and retrieve the placed order with its line items. Another Customer receives 403 when trying to access the order. Unauthenticated callers receive 401 and Operators receive 403 from order placement. |
| AC-F06-05 / TEST-F06-05 | The original Sprint 1 single-item purchase payload `{ productId, quantity }` continues to work seamlessly on the candidate. |

Integration contract with F-07: Order items stored in `OrderItem` provide the authoritative `product_id` and `quantity` for restocking when a Customer cancels a `PENDING` order.

Definition of Done: contract committed before implementation, automated tests capture RED on pre-change code, GREEN on the fix, regression suite passes, UI cart flow supports multi-item checkout, and teammate review is conducted on the PR into `staging-sprint-2`.

## F-07 · Customer cancellation and stock restoration

Issue #39. Author: @jiraphat-j. Reviewer: @thanapornboont-star.
Extends FR-05 (order history), BR-02 (record isolation), BR-03 (inventory),
BR-04 (atomic stock updates), BR-05 (order transitions), NFR-01 and NFR-03.

### Workflow and API

`POST /api/orders/:id/cancel` has no request body. A Customer uses Cancel
Order in My Orders and confirms before sending the request. Success returns
200 with `{ success: true, data: { order } }` and the stored CANCELLED order
and its line items. My Orders and the catalog are refreshed.

The API returns 401 without authentication, 403 for an Operator or a
different Customer, and 404 for an unknown order ID. Only PENDING orders
can be cancelled. Non-PENDING orders and lost races return 409
`INVALID_TRANSITION` with no stock changes.

The status write is conditional on ownership and PENDING. In the same
transaction, restore each saved OrderItem quantity, including archived
products, using the same product lock order as F-06. Keep saved prices,
quantities and totals. If a restoration would exceed the database stock
range, roll back the entire change and return 409 `STOCK_LIMIT`.
The existing Operator status route compares the previously read status
when writing, so a concurrent confirmation cannot overwrite a customer
cancellation. A lost Operator update returns 409. The existing direct
Operator status actions retain their inventory behavior.

### Acceptance criteria and verification

| AC / STS | Expected result |
| --- | --- |
| AC-F07-01 / TEST-F07-01 | Owner cancels a PENDING order, all saved quantities are restored, and a fresh GET shows CANCELLED with unchanged prices. |
| AC-F07-02 / TEST-F07-02 | Unauthenticated requests return 401, forbidden role or ownership returns 403, and no order or stock changes. Unknown order returns 404. |
| AC-F07-03 / TEST-F07-03 | Non-PENDING, sequential retries and overlapping cancellation requests cannot restore inventory again. A stock overflow rolls back both status and stock. |
| AC-F07-04 / TEST-F07-04 | On PostgreSQL, overlapping cancellation and Operator confirmation produce one successful transition, and final inventory reflects the winner. |
| AC-F07-05 / TEST-F07-05 | Cancellation works for orders created by the Sprint 1 single-item and Sprint 2 multi-item checkout paths. |

Definition of Done: commit the contract before code, capture RED and GREEN,
verify API and UI journeys with PostgreSQL, and obtain teammate review
before staging merge. Deployment verification is tracked in #40.


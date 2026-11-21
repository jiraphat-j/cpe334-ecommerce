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

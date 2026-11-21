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

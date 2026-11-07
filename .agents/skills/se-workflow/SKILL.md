---
name: se-workflow
description: Enforces CPE 334 software engineering workflow loop, rules verification, pair-work role rotation, TDD contracts, and milestone evidence tracking.
---

# CPE 334 Software Engineering Workflow & Enforcement Skill

This skill enforces engineering discipline, team participation balance, and milestone compliance for the CPE 334 course project.

## Team & Project Context
- Project: E-Commerce / Ordering System (ระบบสั่งซื้อสินค้า)
- Actors & Roles: `Customer` and `Operator`
- Teammates:
  - User 1: `jiraphat-j`
  - User 2: `thanapornboont-star`
- Tech Stack: Node.js, Express, React (Vite), PostgreSQL (Prisma), Docker, GitHub Actions, GCP Cloud Run, GCP Cloud SQL.

---

## The 5-Step Execution Loop

Every task, feature, or bug fix must cycle through these 5 checkpoints in order. Do not skip steps.

```
[Start Work]
   │
   ▼
[Step 1: Pre-Flight Check] ──> Milestone context, assign Author/Reviewer, branch from staging-sprint-<N>
   │
   ▼
[Step 2: Contract Definition] ─> Define FR/BR/AC/STS before writing any implementation code
   │
   ▼
[Step 3: TDD & Security Gate] ─> Write test -> Verify Red (Fail) -> Write code -> Verify Green (Pass)
   │
   ▼
[Step 4: Evidence Capture] ────> Capture screenshots, test output, commit SHA for final PDF report
   │
   ▼
[Step 5: Review & Merge Gate] ─> Generate PR Title & Description -> PR into staging -> Non-author approves -> Merge -> Release PR to main
   │
   ▼
[Task Complete]
```

---

### Step 1: Pre-Flight Check
Before touching any files or creating branches:
1. Identify the current milestone:
   - Deliverable 1 (Sprint 1) - Localhost baseline & core slice
   - Lab 5 - Docker, CI/CD, GCP Cloud Run & Cloud SQL
   - Deliverable 2 (Sprint 2 + 3 WIP) - Core expansion on GCP
   - Final Delivery - Full system, UAT fixes, video
2. Assign roles for this task:
   - Author: Opens Issue, writes contract, writes code/tests, creates PR.
   - Reviewer: Reviews code, checks evidence, approves PR (Authors NEVER approve their own PR).
   - Ensure role rotation: If `jiraphat-j` was Author on the last task, `thanapornboont-star` should author the next one where feasible.
3. Git branch check:
   - Create branch from active sprint integration branch (e.g., `staging-sprint-1` for Sprint 1, `staging-sprint-2` for Sprint 2). Never branch directly off `main` for regular features.
   - Branch naming convention: `feat/<feature-name>`, `fix/<issue-id>`, or `ci/<purpose>`.

---

### Step 2: Contract & Specification Check
No implementation code can be written without a formal contract.
1. Assign stable IDs:
   - Functional Requirements: `FR-01`, `FR-02`, ...
   - Business Rules: `BR-01`, `BR-02`, ...
   - Acceptance Criteria: `AC-01`, `AC-02`, ...
   - Software Test Specs: `TEST-01`, `TEST-02`, ...
2. Contract template must include:
   - Target Actor (`Customer` or `Operator`)
   - Pre-conditions
   - Action / API Endpoint / Input payload
   - Business rule / validation check
   - Expected response & database state changes
   - Negative / boundary behavior (e.g., ordering out of stock, unauthorized access)

---

### Step 3: TDD & Security Gate
1. Test-Driven Development (TDD):
   - Write automated test first matching the STS.
   - Run the test suite: It MUST fail first (Red). Record evidence of failure if required for report.
   - Implement minimal business logic to make test pass.
   - Run test suite: It MUST pass (Green).
2. Security Invariants (Zero Leaks):
   - Never commit `.env` with real credentials. Only update `.env.example` with dummy values.
   - Never commit API keys, service account JSON files, or database connection strings.
   - Verify secrets are read via environment variables (`process.env`).

---

### Step 4: Evidence Capture
Every feature must produce traceable evidence for the final submission report:
1. Capture terminal test run output showing passing test names and counts.
2. Capture screenshot of UI workflow (if applicable) with clear labels:
   - Normal path (e.g., Customer creates order, stock reduced)
   - Rejection path (e.g., Ordering empty cart or out of stock)
   - Access control rejection (e.g., Customer accessing operator route or other user's order -> 403 Forbidden)
3. Record git commit SHA for the tested increment.

---

### Step 5: Peer Review & Merge Gate
1. Push branch to remote and prepare Pull Request into `staging-sprint-<N>` (e.g. `staging-sprint-1`).
2. **Mandatory PR Template Generation:** The AI assistant MUST ALWAYS generate a complete, copy-paste ready PR Title and Markdown Description whenever prompting the user to open a PR. The description must contain:
   - Summary of changes mapped to rubric parts
   - Linked Issue keyword (`Closes #<id>` or `Part of #<id>`)
   - Detailed list of modified/created files
   - Clear Reviewer Checklist & verification instructions for the teammate
3. Review protocol:
   - The assigned Reviewer inspects diff, tests, and contracts.
   - Reviewer leaves meaningful review comment (e.g., noting security check, test coverage, or edge cases).
   - Reviewer approves. Author does not merge without review approval.
4. Merge into `staging-sprint-<N>`.
5. For release milestones, open Release PR from `staging-sprint-<N>` into `main`. Verify CI checks pass before merging.

---

## Milestone Checkpoints & Deadlines

- Deliverable 1 (Sprint 1): Due 15 Nov 2026, 23:59 (80 pts)
  - Working vertical slice on Localhost.
  - Auth with `Customer` and `Operator` roles.
  - Domain transaction with persistence and business rule validation.
  - Automated tests + PDF report (Parts A-F).
- Lab 5 (Cloud CI/CD): Due 15 Nov 2026, 23:59 (100 pts)
  - Dockerize Sprint 1 code.
  - Set up GitHub Actions (`ci-docker.yml`, `deploy.yml`) with WIF.
  - Deploy to Cloud Run + Cloud SQL.
  - Ruleset protection on `main`.
  - Pause Cloud SQL when idle to prevent billing.

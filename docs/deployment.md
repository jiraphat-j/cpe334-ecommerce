# TokTickIT E-Commerce Deployment & Operations Guide

This guide documents the architecture, configuration parameters, repeatable release process, manual rollback procedure, and cost control operations for the CPE 334 TokTickIT E-Commerce application deployed on Google Cloud Platform (GCP).

---

## 1. System Architecture & Components

The application is deployed as a cloud-native, containerized multi-tier service running on Google Cloud Platform (`asia-southeast1`):

- **Compute Runtime:** Google Cloud Run (Fully managed, serverless container service named `toktickit`).
- **Database:** Google Cloud SQL for PostgreSQL 16 (Enterprise edition, instance `toktickit-pg`, database `toktickit`).
- **Container Registry:** Google Artifact Registry (Docker repository `toktickit`).
- **Secrets Management:** Google Secret Manager (Stores generated database credentials `toktickit-db-password` and administrative credentials `toktickit-admin-password`).
- **CI/CD & Authentication:** GitHub Actions with Keyless Workload Identity Federation (WIF) — no long-lived service account JSON keys.

---

## 2. Environment Variables & Secret Configuration (R-02)

All configuration settings and credentials are read strictly from runtime environment variables. In adherence to Course Rule R-02 and Zero-Secret Invariants, **no credentials, passwords, or connection strings are ever committed to the repository**.

| Variable Name | Environment / Scope | Purpose & Usage | Committed / Secret Policy |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Container Runtime | Sets Node.js execution mode (`production` or `development`) | Safe non-secret string |
| `PORT` | Container Runtime | Web listening port (`3000` locally, injected dynamically by Cloud Run) | Safe non-secret integer |
| `DATABASE_URL` | Container Runtime | PostgreSQL connection URL including credentials and Cloud SQL socket | **Strict Secret:** Injected via Cloud Run Secret Manager reference |
| `JWT_SECRET` | Container Runtime | Secret key used for signing and verifying JSON Web Tokens | **Strict Secret:** Injected via Secret Manager |
| `ADMIN_PASSWORD`| Seed & Container | Initial administrative password for the Operator account | **Strict Secret:** Injected via Secret Manager |
| `GCP_PROJECT_ID`| GitHub Actions (`demo`) | GCP Project Identifier (`cpe334-ecommerce`) | Safe configuration variable |
| `GCP_REGION` | GitHub Actions (`demo`) | Deployment target region (`asia-southeast1`) | Safe configuration variable |
| `WIF_PROVIDER` | GitHub Actions (`demo`) | Full resource name of the Workload Identity Provider | Safe configuration variable |
| `WIF_SERVICE_ACCOUNT` | GitHub Actions (`demo`) | Deployer Service Account email (`toktickit-deployer@...`) | Safe configuration variable |

---

## 3. Repeatable Release Procedure (R-07, R-08, Check C-06)

Every release follows a strict, traceable 5-step peer-reviewed promotion process through staging into main:

1. **Feature Implementation:**
   - Create a dedicated feature branch from `staging-sprint-1` (e.g., `feat/<name>`).
   - Implement functionality, write tests, and verify locally via Docker.
2. **Peer Review into Staging:**
   - Open Pull Request targeting `staging-sprint-1`.
   - CI workflow `ci-docker.yml` executes automated tests and Docker builds.
   - Non-author team member conducts thorough code review and approves PR.
   - PR is merged into `staging-sprint-1`.
3. **Release Promotion into Main:**
   - Open Release PR from `staging-sprint-1` into `main`.
   - GitHub branch protection ruleset `protect-main` mandates approval and passing `test-and-docker` status check.
   - Reviewer approves, and Author merges the Release PR.
4. **Automated CD Deployment:**
   - Merge into `main` automatically triggers `.github/workflows/deploy.yml`.
   - The runner authenticates to GCP keylessly via Workload Identity Federation (WIF).
   - Docker image is built and tagged with the 40-character commit SHA (`IMAGE_TAG`).
   - Image is pushed to Google Artifact Registry:  
     `asia-southeast1-docker.pkg.dev/<PROJECT_ID>/toktickit/toktickit:<SHA>`
   - Cloud Run migration job `toktickit-migrate` runs Prisma database migrations.
   - Cloud Run service `toktickit` updates traffic to the new revision.
   - Automated smoke test (`deploy/smoke_test.py`) verifies health, readiness, and catalog endpoints.

---

## 4. Rollback Procedure (R-04, Check C-05)

If an issue occurs in a release, the system supports instant zero-downtime rollback without rebuilding:

1. Navigate to GitHub Repository -> **Actions** -> **Deploy demo** workflow.
2. Click **Run workflow** on branch `main`.
3. In the input field `image_tag`, enter the full 40-character commit SHA of a previous known-healthy image (e.g., `afe5a3c...`).
4. Click **Run workflow**:
   - The workflow detects the existing image in Artifact Registry.
   - Build, offline tests, and migrations are safely skipped.
   - Cloud Run points 100% traffic back to the specified revision immediately.
   - Automated smoke test runs against the restored revision to ensure service availability.
   - Database records in Cloud SQL remain completely intact throughout the rollback.

---

## 5. Cost Control & Resource Pausing (Episode 9)

To avoid continuous hourly charges against the GCP Free Trial credit:

### Pause Resources (When Not Testing or Grading):
Run in Google Cloud Shell:
```bash
# 1. Stop Cloud SQL PostgreSQL instance to eliminate hourly VM charges
gcloud sql instances patch toktickit-pg --activation-policy=NEVER

# 2. Restrict Cloud Run public access
gcloud run services remove-iam-policy-binding toktickit \
  --region=asia-southeast1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

### Resume Resources (When Resuming Work or TA Demonstration):
```bash
# 1. Start Cloud SQL PostgreSQL instance (takes ~2 minutes)
gcloud sql instances patch toktickit-pg --activation-policy=ALWAYS

# 2. Restore public access to Cloud Run service
gcloud run services add-iam-policy-binding toktickit \
  --region=asia-southeast1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

# Admin Panel Audit — Project 4

## Scope and evidence

This audit covers `frontend_admin`, the Express backend in `backend_service`, the checked-in SQL migrations, `digital.sql`, `README.md`, and `Project_4_Digital_Marketplace_Database_Backend_Plan.md`. The two project documents were read in full. The audit reconciles the plan against the repository migrations and model/controller code; it does not claim that a live PostgreSQL database was introspected. No database connection or migration was run.

The worktree already contained extensive uncommitted changes before this task, including changes to the admin table, license/DMCA interfaces, backend routes, payment code, migrations `039`–`044`, and several user-facing pages. Those edits were treated as existing work and were not reverted. The targeted admin files were read before modification.

## Architecture and schema reconciliation

The actual backend is an Express application using Sequelize models and PostgreSQL through `pg`; its existing layering is mostly route/controller/service/model rather than the plan's proposed Prisma structure. It should not be replaced.

Current schema names are application-specific, including `"UserAccounts"`, `"UserInfo"`, `"UsersRoles"`, `"UserAccountRoles"`, `"Products"`, `"Storefronts"`, `"Orders"`, `"OrderItems"`, `"Payments"`, `"Downloads"`, `"Licenses"`, `"LicenseActivations"`, `"ActivityLogs"`, and the `LegalPolicy*` tables. The current schema uses PostgreSQL enum/status values and quoted PascalCase identifiers, not the plan's proposed lowercase `users`, `orders`, and `activity_logs` names. `"Permissions"` and `"RolePermissions"` are present in migration `001`, but the admin API does not expose permission assignment/management.

| Domain | Evidence in current migrations | Reconciliation / gap |
|---|---|---|
| Identity and RBAC | Users, roles, user-role links, permissions, role-permission links, OAuth accounts | Role-based access checks exist, but role permissions are not used by the admin endpoints as granular authorization. |
| Creators and storefronts | Creator profiles, storefronts, creator payout information | Payout information exists; a creator earnings or payout transaction ledger does not. |
| Products and delivery | Categories, products, files, versions, previews, version assets/licenses, downloads and delivery records | Core catalog entities exist. Several admin tables previously displayed fabricated rows; only selected list endpoints existed. |
| Orders and payments | Orders, order items, payments | Present and used by commerce admin endpoints. Refund monitoring is not a configured provider refund workflow. |
| Licenses and DRM | License types, licenses, activations, encrypted key handling, license audit/validation/revocation events, DRM policy | More detailed than the plan's draft model. License keys must not be returned in plaintext. |
| Reviews and rights | Reviews, moderation cases, DMCA reports/takedowns, and later DMCA workflow/case history tables | Workflows and schema exist, but central activity-log coverage is not comprehensive. |
| Policies | Policies, versions, policy audit records | Present with policy-specific APIs and auditing. |
| Affiliates/promotions/earnings | No affiliate, coupon, bundle, commission, earnings, or payout-ledger tables found in checked-in migrations | These planned domains cannot be made database-driven without a schema/API design and migrations. |
| Activity | `"ActivityLogs"` stores actor, action, entity, IP, user agent, metadata and timestamp | No dedicated device column; device identifiers can be included in metadata. No database-level append-only protection is present. |

`digital.sql` is not a safe source of truth for an existing database: it starts by dropping core user tables with `CASCADE`, and its old account status definition differs from the later migration-based enum schema. Do not apply it to a populated database. The current `run-migrations.ts` sorts and executes every SQL file on every invocation; it has no migration ledger, and early migrations contain non-idempotent `CREATE TABLE` statements. It therefore is not safe to use as an incremental production migration runner without first reconciling how the deployed database was initialized. In addition, the backend package includes a `remigrate` script that drops and recreates the database; it must not be used for this task.

## Admin UI and API audit

| Module | Existing implementation before this task | Current status / remaining gap |
|---|---|---|
| Dashboard and analytics | Dashboard used hardcoded KPI totals, hand-drawn chart bars, category shares, orders and activity. A backend dashboard query already existed. Revenue groups by currency. | Dashboard now fetches `/admin/dashboard` and displays returned summary, revenue, category, order and activity data. Currency totals are kept separate. Backend dashboard totals/filters still need domain review and test against production-like data. |
| Users | Sequelize-backed list/create/update/delete and pagination; account/role/status validation. Superadmin protections exist. | User create/update/delete now write actor-attributed audit events in the same transaction. No integration test against PostgreSQL was available. |
| Roles and permissions | Role list/create/update/delete APIs exist. Superadmin role is protected. Roles show user counts. | Role create/update/delete now write audit events transactionally. Permission assignment is not implemented; role membership is not equivalent to granular permission enforcement. |
| Creators/storefronts | Creator and storefront list queries existed through `/admin/data/:resource`. | Admin tables now fetch these records with server-side search, status filter and pagination. Approve/reject/suspend controls are not provided by this generic table. |
| Products | Product creation endpoints/forms exist; the admin product list used sample rows or had a narrow list request. | Product list now queries PostgreSQL through `/admin/data/products`; create navigation is retained. Product edit/delete/publish workflows are not complete through the admin list. |
| Files, versions, previews | List queries existed for files, versions and preview assets. | Admin list views now consume those database queries rather than mock records. Upload/replace/moderation actions are not all available in the admin UI. |
| Orders, payments, refunds, revenue | `AdminCommerceTable` already called backend commerce endpoints. Refund UI is monitoring-only where provider refund processing is not configured. | Left on the existing database-backed path. A real refund action requires provider integration and authorization and is not claimed here. |
| Downloads and download links | Database list resources existed. | Admin tables now use the server-side list endpoints. Access revocation/resend operations are not part of this table. |
| Activity log | Backend list/detail/export endpoints existed, but admin list/detail UI rendered sample identities, IP addresses, before/after stories, dates and URLs. | List/detail now fetch PostgreSQL records. Search, action/module, date, outcome, sorting, pagination and authenticated CSV export are implemented. Detail shows only recorded before/after metadata; it no longer invents absent values. |
| License types/keys/activations | License/activation APIs and a customized license-management UI are present in existing changes. Keys are encrypted by later migrations. | Not rewritten in this pass. Verify the customized pages against their endpoint responses and ensure no key-reveal path bypasses its existing OTP/authorization controls. |
| Reviews/moderation/DMCA | Review/moderation/DMCA tables and workflows exist, including newer workflow migrations and routes. | Existing specialized pages were preserved. A source scan still found sample moderation cases in `ReviewerModerationPages.tsx`; those are not real records and remain to be integrated. |
| Affiliates, coupons, creator earnings/payouts, system settings | No corresponding complete business tables/API workflows found in migrations and routes. `CreatorPayoutInfo` is account information, not a payout ledger. | Not implemented. Existing admin navigation must not imply operational CRUD for these domains until schema, endpoints, permissions and workflows exist. |
| Policies | Database-backed policy CRUD/version/audit entities and routes exist. | Preserved; verify with the current policy editor and API integration tests. |

### Static data and non-functional interactions found

- The admin dashboard and activity detail/list contained sample totals, dates, people, events, IPs, before/after details and hand-built charts. Those sources were replaced with database fetches.
- `AdminTablePage.tsx` contained fixed records across several modules, along with placeholder action links/buttons. It now renders API-backed rows for configured resources and reports an explicit “no database-backed view” message for unsupported modules instead of inventing records.
- `AdminDataPage.tsx` was an unreferenced duplicate mock-data component and was removed after confirming there were no imports/usages.
- `ReviewerModerationPages.tsx` still contains fixed moderation cases (for example, sample product titles/statuses). This is an outstanding mock-data removal item.
- Generic admin module tables are now primarily read-only. Real create/update/delete/approve/reject/publish operations remain missing for several modules; placeholder actions were removed rather than reporting false success.

## Authentication, authorization, logging and security

- Admin requests use a bearer token resolved to a database user. `requireAdmin` permits `admin`/`superadmin`; some sensitive user/role operations require `requireSuperAdmin`. The client-side admin shell also checks role, but this is not relied on as the security boundary.
- `req.userId` is assigned by backend authentication middleware. New user/role audit records use this server-derived actor, include request IP/user agent, and store before/after values without passwords or credential fields.
- The activity writer redacts metadata keys matching password/token/secret/credential/card/private-key patterns. Device identifiers, when supplied as `x-device-id`, are stored in metadata rather than a new database column.
- Existing license/DMCA routes have some operation-specific log inserts; comprehensive centralized logging for login/logout, payment outcomes, product operations, downloads, moderation and other business flows is still incomplete. Existing failed security events are not comprehensively recorded.
- Activity read APIs are admin-protected and there are no activity update/delete APIs, but database-level append-only protection is not installed. The current `ActivityLogs.UserId` foreign key uses `ON DELETE SET NULL`, which also affects historical actor attribution when an account is removed.
- No live authorization tests or database integration tests were run. The review did not attempt payment-provider operations or modify a database.

## UI consistency

Both frontends use Inter/Noto Sans Khmer typography, Tailwind, and a shared orange/navy palette. The admin shell reuses the dashboard header and has a 264px sidebar and responsive content region. The existing frontend styles were inspected directly; the revised dashboard and table views retain the admin's typography, colors, spacing and table conventions rather than introducing a new design system.

## Changes delivered in this pass

- Replaced dashboard mock metrics, chart, category breakdown, orders and activity with `/admin/dashboard` data.
- Added PostgreSQL product listing and creator verification status resources; wired configured generic admin lists to `/admin/data/:resource` with server-side search, status filters and pagination.
- Removed mock list/detail content from the activity log and added filtered, sorted, paginated, authenticated CSV export.
- Added transactional audit entries for admin user and role create/update/delete operations; actor identity comes from authenticated server context.
- Removed the unused duplicate static `AdminDataPage`.
- No migrations were applied and no live user data was changed.

## Verification and outstanding work

- Backend TypeScript build: passed.
- Targeted ESLint on changed admin UI files: passed.
- Admin production build: passed. Next.js reported “Skipping validation of types”; the independent `tsc --noEmit` check below is therefore still significant.
- Full frontend typecheck: blocked by a pre-existing syntax error in the modified `frontend_admin/src/components/products/AddProductForm.tsx` around line 70 (`TS1005`, `TS1382`, `TS1381`). That file was not changed in this task.
- Full frontend lint: failed with 21 errors and 16 warnings across the repository. Errors include the pre-existing JSX-escaping issue in `frontend_admin/src/app/marketplace/__unused_productSlug/ProductDetailClient.tsx`, `react-hooks/set-state-in-effect` findings in existing components, `no-explicit-any` findings in dashboard components, and the `AddProductForm.tsx` parsing error. Targeted lint on the changed admin UI files passes.
- No PostgreSQL integration test, API request test, production frontend build, permission matrix test, or migration execution was possible without risking the existing database and because the frontend currently does not typecheck.

Remaining priority work: remove remaining reviewer/moderation mock records; implement and test the missing affiliate/promotion/earnings/payout schema and APIs; complete CRUD/workflow actions across products, creators, files, licenses, reviews and DMCA; centralize activity logging for all successful and failed business/security operations; enforce append-only audit storage while preserving actor history; expose/manage granular permissions; repair the existing frontend syntax/lint blockers; and run integration/build/security verification against a disposable PostgreSQL database.

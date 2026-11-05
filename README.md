# Digital Products Downloads Marketplace

A digital products marketplace project with a Next.js frontend and an Express backend service.

## Project Overview

This project is a digital marketplace platform designed for buying and selling downloadable digital products such as e-books, software licenses, design templates, music, stock photos, and online courses. The platform brings together creators, buyers, administrators, affiliates, and reviewers in a secure and scalable e-commerce environment. It focuses on digital product delivery, licensing enforcement, user management, payment processing, moderation, and revenue tracking.

The system is built to support a real-world marketplace workflow where creators can publish products, buyers can purchase and download digital items, administrators can manage platform operations, and affiliates can generate additional sales through referral channels. The application is structured to provide both a smooth user experience and a strong backend foundation for secure transactions and controlled digital access.

## Objectives

The main objectives of the system are to:

- provide a secure digital marketplace for downloadable products
- support multiple user roles with role-based access control
- allow creators to manage storefronts and product listings
- enable secure product purchasing and digital delivery
- manage license rules, access control, and download limits
- support order processing, payment tracking, and financial reporting
- allow moderation, DMCA handling, and content review workflows
- support affiliate commissions and creator payouts
- maintain activity logs and audit records for operational transparency

## Core Features

### 1. User Management and Roles

The system supports multiple roles, including Super Admin, Creator, Buyer, Affiliate, and Content Reviewer. Each role has specific permissions and restrictions to ensure secure access to platform features. User registration, login, account management, and authorization are enforced on the backend to protect sensitive actions and data.

### 2. Creator and Storefront Management

Creators can create seller profiles, manage storefronts, upload products, and customize branding elements such as profile information, logos, banners, and content descriptions. Storefront management allows sellers to present products professionally and maintain a consistent identity on the marketplace.

### 3. Product Catalog and Asset Management

The marketplace supports product listings with descriptions, pricing, categories, preview content, versions, downloadable assets, and license options. Digital products can be maintained as versioned files with controlled access and secure distribution.

### 4. Licensing and Digital Rights Protection

Because the platform sells downloadable products, licensing is a critical part of the system. The project supports license validation, activation limits, restricted access, expiration rules, and revocation workflows. These features help protect digital goods from unauthorized sharing and ensure compliance with licensing policies.

### 5. Orders and Payments

The system handles purchase flows, order records, and payment processing. Buyers can browse products, place orders, and gain access to purchased items after successful payment. Transactions are stored for tracking, auditing, and reporting.

### 6. Downloads and Access Control

Purchased products are delivered through secure access mechanisms. The platform can track downloads, enforce re-download limits, validate active licenses, and restrict access based on user entitlement and product rules.

### 7. Moderation and Review

The platform includes review and moderation capabilities so admins and reviewers can manage content quality, detect suspicious listings, handle abuse reports, and process DMCA or content-policy cases.

### 8. Affiliate and Commission System

Affiliate users can promote products and earn commissions. The system supports referral tracking, commission calculations, and payout-related reporting, creating an additional monetization channel for the marketplace.

### 9. Payout Management and Revenue Tracking

Creators and sellers can view their sales histories, earnings, and payout states. This allows the platform to manage revenue sharing, commission deductions, and secure payout processing in a transparent and organized manner.

### 10. Activity Logging and Audit Trail

The platform maintains logs for critical platform actions such as user logins, role updates, payment activity, moderation events, and product changes. This helps improve accountability and supports operational analysis and compliance monitoring.

## System Architecture

The recommended architecture for the system is:

- Frontend: Next.js with React and TypeScript
- Backend: Node.js with Express
- Database: PostgreSQL
- API: RESTful backend services
- Authentication: secure session or token-based authentication with RBAC enforcement
- Storage: media and downloadable assets stored securely in the application infrastructure or cloud storage

This architecture is suitable for a marketplace that requires relational data integrity, transaction management, user authorization, reporting, and secure file delivery.

## Database Design

The database is structured around major marketplace domains, including:

- Identity and role management
- Creator and storefront management
- Products and files
- Licenses and DRM
- Orders and payments
- Downloads
- Reviews and moderation
- Affiliates
- Coupons and promotions
- Creator earnings and payouts
- Activity and audit tracking

Core database entities include users, roles, permissions, creator profiles, storefronts, products, product versions, licenses, orders, payments, reviews, affiliate records, and activity logs.

## Security Considerations

Security is a key requirement of this platform. The system must protect user accounts, payments, product delivery, and administrative workflows. Important measures include password hashing, role-based permissions, input validation, secure authentication flows, protected download endpoints, secure storage of sensitive data, and audit trails for critical actions.

## Role of the Project

This project demonstrates a realistic and commercially relevant digital commerce system. It goes beyond a simple product catalog by integrating licensing control, secure access, financial tracking, creator monetization, and moderation workflows. It represents a modern marketplace model suitable for digital content businesses and can be extended with more advanced features such as analytics, automated moderation, and international payment support.

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript
- Backend: Node.js, Express, CORS
- Tooling: ESLint, Tailwind CSS, concurrently

## Project Structure

- `frontend/` - Next.js application
- `backend_service/` - Express API server
- `package.json` - root package scripts and shared dev dependency
- `frontend/package.json` - frontend dependencies and scripts
- `backend_service/package.json` - backend dependencies and scripts

## Installation

From the project root, install dependencies for both frontend and backend:

```bash
npm install
npm install --prefix frontend
npm install --prefix backend_service
```

> If you prefer a single command, install root dependencies first and then install packages for each workspace.

## Running Locally

### Start both frontend and backend together

```bash
npm run dev
```

This runs:
- `npm run dev --prefix frontend` (starts the Next.js frontend)
- `npm run dev --prefix backend_service` (starts the Express backend)

### Run frontend only

```bash
npm run dev --prefix frontend
```

The frontend default port is `3000`.

### Run backend only

```bash
npm run dev --prefix backend_service
```

The backend server runs on port `5000`.

### Google sign-in setup

The backend starts Google sign-in at `http://localhost:5000/api/auth/google`. In Google Cloud Console, create an OAuth client with application type **Web application** and add this exact value under **Authorized redirect URIs**:

```text
http://localhost:5000/api/auth/google/callback
```

The value must match `GOOGLE_CALLBACK_URL` in `backend_service/.env` character-for-character. If the OAuth consent screen is in **Testing**, add the Google account being used to **Test users**. A missing redirect URI or non-test account produces Google’s `Error 400: invalid_request` policy page before the backend receives any request.

For a deployed environment, use HTTPS and register the deployed callback URL in Google Cloud Console; do not reuse the localhost callback.

## Build & Production

### Frontend build

```bash
npm run build --prefix frontend
```

### Start backend in production mode

```bash
npm start --prefix backend_service
```

## API Endpoints

The backend exposes the following endpoints:

- `GET /` - health check endpoint
- `GET /api/products` - returns a sample list of digital products

Example response from `/api/products`:

```json
[
  {
    "id": 1,
    "name": "Website Template",
    "price": 15
  },
  {
    "id": 2,
    "name": "E-Book",
    "price": 10
  }
]
```

## Notes

- The frontend currently uses `next`, `react`, `react-dom`, and Tailwind CSS.
- The backend is a minimal Express app with CORS enabled.
- You can extend the project by adding product management, user authentication, payment integration, and database storage.

## License

This project is currently unlicensed.

## Create the first Superadmin account

There is no default or backup admin account. Create an account with the email and password you want, then promote it to Superadmin:

1. Make sure the backend database migrations have been run. The default roles, including `Superadmin`, are seeded by the migrations.
2. Register the account using `POST http://localhost:5000/api/auth/register` with a JSON body like this. Choose your own name, username, email, and a strong password; registration requires a password of at least 8 characters and a username of 3-30 letters, numbers, or underscores.

   ```json
   {
     "name": "Marketplace Admin",
     "username": "marketsuperadmin",
     "email": "superadmin@example.com",
     "password": "12345678"
   }
   ```

   The registration endpoint creates a regular Buyer account and stores the password as a hash. Do not put a real password in this README, source control, or a shared terminal history.
3. Connect to the PostgreSQL database configured for `backend_service` and run the SQL below. Replace `admin@example.com` with the email used during registration.
4. Sign in at `http://localhost:3001/login` with that email and password.

```sql
BEGIN;

DO $$
DECLARE
    account_id INT;
    superadmin_role_id INT;
BEGIN
    SELECT account."UserId"
    INTO account_id
    FROM "UserAccounts" account
    JOIN "UserInfo" info ON info."UserInfoId" = account."UserInfoId"
    WHERE lower(info."Email") = lower('superadmin@example.com')
    FOR UPDATE OF account;

    IF account_id IS NULL THEN
        RAISE EXCEPTION 'No account found for that email. Register it first.';
    END IF;

    SELECT "UserRoleId"
    INTO superadmin_role_id
    FROM "UsersRoles"
    WHERE lower("RoleName") = 'superadmin';

    IF superadmin_role_id IS NULL THEN
        RAISE EXCEPTION 'Superadmin role not found. Run the database migrations first.';
    END IF;

    UPDATE "UserAccounts"
    SET "RoleId" = superadmin_role_id,
        "Status" = 'active',
        "UpdatedAt" = CURRENT_TIMESTAMP
    WHERE "UserId" = account_id;

    INSERT INTO "UserAccountRoles" ("UserId", "UserRoleId")
    VALUES (account_id, superadmin_role_id)
    ON CONFLICT ("UserId", "UserRoleId") DO NOTHING;
END $$;

COMMIT;
```
$body = @{
    name = "Marketplace Admin"
    username = "marketsuperadmin"
    email = "superadmin@example.com"
    password = "12345678"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "http://localhost:5000/api/auth/register" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
# Project Memory

## Core
Multi-tenant barbershop SaaS. Dark theme with gold (#C8A96E) accents. Playfair Display headings, DM Sans body.
Supabase with RLS per tenant_id. Roles in separate user_roles table (never on profiles).
Roles: cliente, barbeiro, admin_barbearia, super_admin. Portuguese UI.
Freemium model: Free (50 ags/mês), Pro (R$99), Enterprise (R$299). Plan on barbershops table.

## Memories
- [Data model](mem://features/data-model) — Barbershops, user_roles, profiles tables with RLS policies
- [Freemium plans](mem://features/freemium-plans) — Plans, limits, paywall, monthly reset cron
- [Design tokens](mem://design/tokens) — Gold/dark palette, font choices, button variants

---
name: Data model
description: Barbershops, user_roles, profiles, services, availability, appointments tables with RLS
type: feature
---
## Tables
- **barbershops** — tenants with branding, subdomain, approval status
- **profiles** — user profile data linked to auth.users
- **user_roles** — per-tenant roles (cliente, barbeiro, admin_barbearia, super_admin)
- **services** — per-barbershop services with name, duration_minutes, price, barber_id
- **availability** — per-barber time slots (date, start_time, end_time, status: livre/ocupado/folga)
- **appointments** — bookings linking client, barber, service, date/time, status (scheduled/completed/cancelled/no_show)
- **storage: logos** — public bucket for barbershop logo uploads

## RLS
- Services: public read for approved barbershops; barbers/admins manage own
- Availability: public read for approved; barbers own, admins all in barbershop
- Appointments: clients see own; barbers/admins see barbershop's
- Realtime enabled on availability and appointments

## Tenant Resolution
- `useBarbershop()` context resolves barbershopId from subdomain (hostname)
- Falls back to DEFAULT_BARBERSHOP_ID in src/lib/constants.ts
- `BarbershopProvider` wraps app at __root.tsx level
- `TenantThemeApplier` applies CSS vars from barbershop colors

## Routes
- /servicos — service listing
- /agendar — booking calendar with real-time availability
- /agenda — admin/barber schedule management
- /configuracoes — barbershop branding settings (logo, colors)

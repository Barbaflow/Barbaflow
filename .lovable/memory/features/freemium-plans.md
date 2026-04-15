---
name: Freemium plans
description: Free/Pro/Enterprise plans with appointment limits, paywall, and monthly reset cron
type: feature
---
- Plans table: free (50 ags/mês, R$0), pro (unlimited, R$99), enterprise (unlimited, R$299)
- Plan linked to barbershops (plan_id FK), not users
- appointments_this_month counter on barbershops, incremented by trigger on appointment insert
- RLS policy blocks appointment insert when free plan limit reached
- Monthly reset via pg_cron calling /hooks/reset-monthly-appointments on 1st of month
- Realtime subscription on barbershops table for live counter updates
- PlanCard component in BarberDashboard, PlanPaywallModal in BookingCalendar
- /upgrade page with tier cards (payment integration pending)

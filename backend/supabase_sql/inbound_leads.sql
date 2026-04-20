-- Run in Supabase SQL Editor (once). Backend uses service_role or a key with insert/update on public.inbound_leads.

create table if not exists public.inbound_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  company_name text not null,
  role text not null,
  revenue_range text not null,
  invoice_volume text not null,
  pain_area text not null,
  source text not null default 'web_form',
  heard_about text,
  call_triggered boolean not null default false,
  call_triggered_at timestamptz,
  vapi_call_id text,
  created_at timestamptz not null default now()
);

create index if not exists inbound_leads_created_at_idx on public.inbound_leads (created_at desc);
create index if not exists inbound_leads_email_idx on public.inbound_leads (email);

comment on table public.inbound_leads is 'Website demo requests; optional VAPI outbound speed-to-lead.';

-- Ombor schema for Supabase
-- Run this in Supabase SQL Editor.

create table if not exists public.products (
  id bigint generated always as identity primary key,
  model text not null,
  variant text not null,
  lookup_key text not null unique,
  qty numeric(14,2) not null default 0,
  buy_price numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  model text not null,
  variant text not null,
  qty numeric(14,2) not null,
  buy_price numeric(14,2) not null,
  sell_price numeric(14,2) not null,
  cost numeric(14,2) not null,
  sales numeric(14,2) not null,
  profit numeric(14,2) not null
);

create index if not exists idx_products_lookup_key on public.products (lookup_key);
create index if not exists idx_sales_created_at on public.sales (created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

alter table public.products enable row level security;
alter table public.sales enable row level security;

-- Backend service role key bypasses RLS.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY in browser/mobile client.

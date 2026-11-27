-- ERP bill reference columns — stamped after a successful push to Zoho / QuickBooks.
-- NULL means the invoice has not yet been synced to that ERP.
-- 'duplicate' means it already existed in the ERP when we tried to push.
alter table invoices
  add column if not exists erp_zoho_bill_id text,
  add column if not exists erp_qbo_bill_id  text;

comment on column invoices.erp_zoho_bill_id is 'Zoho Books bill_id after successful push; NULL = not yet synced';
comment on column invoices.erp_qbo_bill_id  is 'QuickBooks Online Bill.Id after successful push; NULL = not yet synced';

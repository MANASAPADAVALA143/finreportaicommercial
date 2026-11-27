-- ERP vendor reference columns — stamped after a successful pull from Zoho / QuickBooks.
alter table vendors
  add column if not exists erp_zoho_contact_id text,
  add column if not exists erp_qbo_vendor_id   text,
  add column if not exists email               text,
  add column if not exists phone               text,
  add column if not exists website             text,
  add column if not exists tax_id              text;

comment on column vendors.erp_zoho_contact_id is 'Zoho Books contact_id from vendor pull';
comment on column vendors.erp_qbo_vendor_id   is 'QuickBooks Online Vendor.Id from vendor pull';

DELETE FROM user_page_permission
WHERE page_key IN (
  '/mall/records',
  '/mall/orders',
  '/mall/invoices',
  '/mall/redeem',
  '/merchant/accounts',
  '/merchant/proxies',
  '/merchant/orders',
  '/studio/video',
  '/studio/image',
  '/studio/text'
);

DELETE FROM role_page_permission
WHERE page_key IN (
  '/mall/records',
  '/mall/orders',
  '/mall/invoices',
  '/mall/redeem',
  '/merchant/accounts',
  '/merchant/proxies',
  '/merchant/orders',
  '/studio/video',
  '/studio/image',
  '/studio/text'
);

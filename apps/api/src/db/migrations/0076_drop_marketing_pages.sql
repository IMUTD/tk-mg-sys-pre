DELETE FROM user_page_permission
WHERE page_key IN ('/marketing/dashboard', '/marketing/accounts', '/marketing/nodes');

DELETE FROM role_page_permission
WHERE page_key IN ('/marketing/dashboard', '/marketing/accounts', '/marketing/nodes');

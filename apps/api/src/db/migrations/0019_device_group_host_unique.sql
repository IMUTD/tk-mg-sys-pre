create unique index device_group_host_unique on device (group_id, lower(trim(host)));

create index execution_task_device_open_idx
  on execution_task (device_id)
  where executor_key = 'box-agent'
    and status in ('queued', 'dispatching', 'ood')
    and cancel_requested_at is null;

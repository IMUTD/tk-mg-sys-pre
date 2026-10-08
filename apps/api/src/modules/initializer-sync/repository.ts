import { randomUUID } from "node:crypto"
import type { Sql } from "postgres"
import { type InitializerSnapshot, SnapshotSchema } from "./source"

const unassignedGroup = "00000000-0000-4000-8000-000000000001"
export class InitializerConflictError extends Error {
  constructor() {
    super("Initializer identity conflicts with an existing business identity")
    this.name = "InitializerConflictError"
  }
}

export const applyInitializerSnapshot = async (
  database: Sql,
  sourceKey: string,
  input: InitializerSnapshot,
): Promise<void> => {
  const snapshot = SnapshotSchema.parse(input)
  await database.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('initializer-sync'), hashtext(${sourceKey}))`
    const administrators = new Map<string, { groupId: string; userId: string }>()
    for (const admin of snapshot.admins) {
      const mappings = await tx<{ userId: string; groupId: string }[]>`
        select user_id as "userId", group_id as "groupId" from init_admin_mapping
        where source_key = ${sourceKey} and source_id = ${admin.id}
      `
      let mapping = mappings[0]
      const conflicts = await tx`
        select id from app_user where lower(email) = ${admin.email}
          and (${mapping?.userId ?? null}::uuid is null or id <> ${mapping?.userId ?? null}::uuid)
      `
      if (conflicts.length > 0) throw new InitializerConflictError()
      if (mapping === undefined) {
        mapping = { userId: randomUUID(), groupId: randomUUID() }
        await tx`insert into access_group(id, name)
          values (${mapping.groupId}, ${`init:${sourceKey}:${admin.id}`})`
        await tx`insert into app_user(id, email, display_name, password_hash, role, enabled, provisioned_by)
          values (${mapping.userId}, ${admin.email}, ${admin.username}, ${admin.passwordHash},
            'administrator', ${admin.enabled}, 'init-tool')`
        await tx`insert into user_group(user_id, group_id) values (${mapping.userId}, ${mapping.groupId})`
        await tx`insert into init_admin_mapping(source_key, source_id, user_id, group_id)
          values (${sourceKey}, ${admin.id}, ${mapping.userId}, ${mapping.groupId})`
      } else {
        const changed = await tx`
          update app_session set revoked_at = now() where user_id = ${mapping.userId}
            and revoked_at is null and exists (
              select 1 from app_user where id = ${mapping.userId}
                and (password_hash <> ${admin.passwordHash} or email <> ${admin.email}
                  or enabled <> ${admin.enabled})
            ) returning id
        `
        void changed
        const updated =
          await tx`update app_user set email = ${admin.email}, display_name = ${admin.username},
          password_hash = ${admin.passwordHash}, enabled = ${admin.enabled}
          where id = ${mapping.userId} and provisioned_by = 'init-tool' and role = 'administrator'
          returning id`
        if (updated.length !== 1) throw new InitializerConflictError()
      }
      if (admin.enabled) administrators.set(admin.id, mapping)
    }
    const absent = await tx<{ userId: string }[]>`
      select user_id as "userId" from init_admin_mapping
      where source_key = ${sourceKey} and not (source_id = any(${snapshot.admins.map((admin) => admin.id)}::text[]))
    `
    for (const { userId } of absent) {
      await tx`update app_user set enabled = false where id = ${userId} and provisioned_by = 'init-tool'`
      await tx`update app_session set revoked_at = now() where user_id = ${userId} and revoked_at is null`
    }
    const seen = snapshot.boxes.map((box) => box.id)
    const removed = await tx<{ externalId: string }[]>`
      select external_id as "externalId" from init_box_mapping
      where source_key = ${sourceKey} and not (external_id = any(${seen}::text[]))
    `
    const boxes = [
      ...snapshot.boxes.map((box) => ({ box, present: true })),
      ...removed.map(({ externalId }) => ({
        box: {
          id: externalId,
          ip: "",
          type: "",
          firmware: "",
          memory: "",
          memoryPct: 0,
          disk: "",
          diskPct: 0,
          online: false,
          lastSeenAt: null,
          adminId: null,
        },
        present: false,
      })),
    ]
    for (const { box, present } of boxes) {
      const owner = box.adminId === null ? undefined : administrators.get(box.adminId)
      const groupId = owner?.groupId ?? unassignedGroup
      const mapped = await tx<{ deviceId: string }[]>`
        select device_id as "deviceId" from init_box_mapping
        where source_key = ${sourceKey} and external_id = ${box.id}
      `
      let deviceId = mapped[0]?.deviceId
      if (deviceId === undefined) {
        if ((await tx`select id from device where external_id = ${box.id}`).length > 0) {
          throw new InitializerConflictError()
        }
        deviceId = randomUUID()
        await tx`insert into device(id, group_id, external_id, host, name, model, assignee_user_id)
          values (${deviceId}, ${groupId}, ${box.id}, ${box.ip}, ${box.id}, ${box.type}, ${owner?.userId ?? null})`
        await tx`insert into init_box_mapping(source_key, external_id, device_id)
          values (${sourceKey}, ${box.id}, ${deviceId})`
      }
      const current = (
        await tx<{ groupId: string; assignee: string | null; pending: boolean }[]>`
        select group_id as "groupId", assignee_user_id as assignee, assignment_pending as pending
        from device where id = ${deviceId} for update
      `
      )[0]
      if (current === undefined) throw new InitializerConflictError()
      const changing = current.groupId !== groupId || current.assignee !== (owner?.userId ?? null)
      if (changing || !present) {
        await tx`update device set assignment_pending = true, assignee_user_id = null
          where id = ${deviceId}`
        await tx`delete from device_watch where device_id = ${deviceId}`
        // Only cancel work that has never been dispatched; uncertain work must be reconciled.
        await tx`update execution_task_step set status = 'cancelled', finished_at = now()
          where task_id in (select t.id from execution_task t
            where device_id = ${deviceId} and (
              (t.status = 'queued' and t.started_at is null) or
              (t.executor_key = 'box-agent' and t.status in ('queued','ood')
                and not exists (select 1 from execution_task_run r
                  where r.task_id = t.id and r.status in ('claimed','running')))
            ))
            and status in ('pending','held')`
        await tx`update execution_task set status = 'cancelled', finished_at = now(), updated_at = now()
          where device_id = ${deviceId} and (
            (status = 'queued' and started_at is null) or
            (executor_key = 'box-agent' and status in ('queued','ood')
              and not exists (select 1 from execution_task_run r
                where r.task_id = execution_task.id and r.status in ('claimed','running')))
          )`
        await tx`update execution_task_device_lease set released_at = now(), recovery_reason = 'confirmed_between_steps'
          where device_id = ${deviceId} and released_at is null
            and task_id in (select id from execution_task where device_id = ${deviceId} and status = 'cancelled')`
        await tx`update execution_task set cancel_requested_at = coalesce(cancel_requested_at, now())
          where device_id = ${deviceId} and status in ('dispatching', 'running', 'ood', 'queued')`
        const active = await tx`
          select 1 from execution_task where device_id = ${deviceId}
            and status in ('queued','dispatching','running','ood','cancel_requested','retry_waiting','needs_reconciliation')
          union all select 1 from execution_task_device_lease where device_id = ${deviceId} and released_at is null
          union all select 1 from device_command where device_id = ${deviceId} and status in ('queued','running')
        `
        if (active.length > 0) continue
      }
      await tx`update device set group_id = ${groupId}, assignee_user_id = ${owner?.userId ?? null},
        assignment_pending = false, enabled = ${present}, host = case when ${present} then ${box.ip} else host end,
        model = case when ${present} then ${box.type} else model end,
        box_type = case when ${present} then ${box.type} else box_type end,
        firmware = ${box.firmware}, memory = ${box.memory}, memory_pct = ${box.memoryPct},
        disk = ${box.disk}, disk_pct = ${box.diskPct}, last_seen_at = greatest(last_seen_at, ${box.lastSeenAt}::timestamptz),
        status = case when exists (select 1 from device_agent a where a.device_id = device.id
          and a.last_heartbeat_at > now() - interval '45 seconds') then status
          else ${box.online ? "online" : "offline"} end, updated_at = now(),
        remark_id = case when ${changing} then null else remark_id end,
        box_group_id = case when ${changing} then null else box_group_id end
        where id = ${deviceId}`
    }
    await tx`insert into init_sync_state(source_key) values (${sourceKey})
      on conflict(source_key) do update set last_success_at = now()`
  })
}

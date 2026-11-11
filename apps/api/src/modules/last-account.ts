import type { Sql, TransactionSql } from "postgres"

type Query = Sql | TransactionSql

const uuidText = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && /^[0-9a-f-]{36}$/i.test(value) ? value : null

export const rememberDrawnAccount = async (
  sql: Query,
  accountId: string | null,
  textId: string | null | undefined,
  imageId: string | null | undefined,
  videoId: string | null | undefined,
): Promise<void> => {
  const account = uuidText(accountId)
  if (account === null) return
  const text = uuidText(textId)
  if (text !== null) {
    await sql`
      update operation_resource set last_account_id = ${account}::uuid
      where id = ${text}::uuid
    `
  }
  const image = uuidText(imageId)
  const video = uuidText(videoId)
  if (image !== null) {
    await sql`
      update box_share_entry set last_account_id = ${account}::uuid
      where id = ${image}::uuid and bucket <> 'backup'
    `
  }
  if (video !== null) {
    await sql`
      update box_share_entry set last_account_id = ${account}::uuid
      where id = ${video}::uuid and bucket <> 'backup'
    `
  }
}

export const rememberAccountRemark = async (
  sql: Query,
  groupId: string,
  accountId: string,
  note: string,
): Promise<void> => {
  const names = note
    .split("\u001e")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (names.length === 0) return
  await sql`
    update business_label
    set last_account_id = ${accountId}::uuid
    where scope = 'account' and kind = 'remark' and name = any(${names}::text[])
      and administrator_id in (
        select a.id from app_user a
        join user_group ug on ug.user_id = a.id
        where ug.group_id = ${groupId}::uuid and a.role = 'administrator'
      )
  `
}

export const clearLastAccount = async (sql: Query, accountIds: readonly string[]): Promise<void> => {
  if (accountIds.length === 0) return
  await sql`update business_label set last_account_id = null where last_account_id = any(${accountIds}::uuid[])`
  await sql`update operation_resource set last_account_id = null where last_account_id = any(${accountIds}::uuid[])`
  await sql`update box_share_entry set last_account_id = null where last_account_id = any(${accountIds}::uuid[])`
}

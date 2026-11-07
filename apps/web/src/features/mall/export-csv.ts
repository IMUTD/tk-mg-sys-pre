/** 表格软件会把 = + - @ 开头的内容当公式执行，导出前要转义。 */
const safeCell = (value: string): string => {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded
}

export const toCsv = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const lines = [headers, ...rows].map((row) => row.map(safeCell).join(","))
  // 开头的 BOM 让 Excel 按 UTF-8 打开，中文不乱码。
  return `﻿${lines.join("\r\n")}\r\n`
}

export const downloadCsv = (fileName: string, csv: string): void => {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

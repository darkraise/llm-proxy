export function exportToCsv<TData extends Record<string, unknown>>(
  data: TData[],
  filename: string,
  columns: Array<{ key: keyof TData; header: string }>,
) {
  const header = columns.map((c) => c.header).join(",")
  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key]
        const str = String(val ?? "")
        return str.includes(",") || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str
      })
      .join(","),
  )

  const csv = [header, ...rows].join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

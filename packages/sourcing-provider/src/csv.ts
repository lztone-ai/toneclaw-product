/** RFC-4180-style reader for the P0 comma-delimited sourcing catalog. */

export function stripUtf8Bom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

export function parseCsvRecords(text: string): string[][] {
  const normalized = stripUtf8Bom(text)
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  const pushField = () => {
    record.push(field)
    field = ''
  }
  const pushRecord = () => {
    pushField()
    if (record.length !== 1 || record[0] !== '') records.push(record)
    record = []
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    if (quoted) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"'
          index += 1
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      pushField()
    } else if (char === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1)
      pushRecord()
    } else {
      field += char
    }
  }
  if (field !== '' || record.length > 0) pushRecord()
  return records
}

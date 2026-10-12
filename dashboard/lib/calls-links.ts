/**
 * Where a logged call note points: the record page of the contact it was
 * logged against, else the property, else nowhere. Ids are the raw form
 * values, so anything that is not a positive integer is ignored.
 */
export function noteRecordHref(
  contactId: string | number | null | undefined,
  propertyId: string | number | null | undefined,
): string | null {
  const id = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v).trim();
    return /^[1-9]\d*$/.test(s) ? s : null;
  };
  const contact = id(contactId);
  if (contact) return `/calls/record/contact/${contact}`;
  const property = id(propertyId);
  if (property) return `/calls/record/property/${property}`;
  return null;
}

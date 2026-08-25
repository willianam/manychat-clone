import type { PrismaClient } from "@prisma/client";
import type { FieldValueType } from "../lib/field-values";
import { inferFieldType } from "../lib/field-usage";
import { ensureCustomField } from "./custom-fields";

/**
 * The one way to write a contact field.
 *
 * Besides the upsert itself, a write registers the key (so /campos lists it)
 * — every site in the runner that used to upsert ContactField directly now
 * goes through here, so a new write site cannot forget either.
 *
 * `type` is the declared type when the writer knows it (an action node's
 * `valueType`); a free-text answer has none and gets a guess from the value.
 */
export async function saveContactField(
  db: PrismaClient,
  contactId: string,
  key: string,
  value: string,
  type?: FieldValueType,
): Promise<void> {
  await db.contactField.upsert({
    where: { contactId_key: { contactId, key } },
    create: { contactId, key, value },
    update: { value },
  });
  await ensureCustomField(db, key, type ?? inferFieldType(value));
}

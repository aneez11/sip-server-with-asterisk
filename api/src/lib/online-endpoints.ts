import type { AmiClient } from "../ami/client.js";

interface EndpointAddress {
  extension: string;
  isActive?: boolean;
}

/** Return only active endpoints with a current PJSIP contact. Fail closed if AMI is unavailable. */
export async function onlineEndpoints<T extends EndpointAddress>(
  ami: AmiClient,
  endpoints: T[],
): Promise<T[]> {
  const contacts = await ami
    .pjsipShowContacts()
    .catch(() => new Map<string, { uri: string; userAgent: string }>());
  return endpoints.filter(
    (endpoint) =>
      endpoint.isActive !== false && contacts.has(endpoint.extension),
  );
}

/**
 * The device's own locale and timezone, which `init` used to hardcode as
 * `'en-US'` and `'UTC'`.
 *
 * Both values are STORED on the contact (`contacts.locale`,
 * `contacts.timezone`) and branched on — help-centre language negotiation,
 * workflow locale conditions, the agent-visible local time, and the
 * device-recognition hash. So the old literals were not a placeholder: they
 * asserted, on every native visitor, something the server had no way to
 * doubt.
 *
 * `Intl` rather than a native module, because React Native ships Hermes with
 * `Intl` enabled on both platforms and a native module would mean a linking
 * step for two strings. Both are wrapped: `Intl` is absent on an old Hermes
 * built without it, and `resolvedOptions()` can throw on a device with no
 * configured region. Returning undefined there is correct — the field is
 * optional server-side, and an absent locale is honest where `'en-US'` was
 * not.
 */
export function deviceLocale(): string | undefined {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export function deviceTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** US state names and postal abbreviations. A fixed, known set, so it is a
 *  lookup table and never a judgment. DC is included because land sells there
 *  nowhere, but a typo should still resolve rather than fail oddly. */
export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const BY_NAME = new Map(
  Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]),
);

/** Resolves "NV", "nv", "Nevada" or "nevada" to { abbr, name }, else null. */
export function lookupState(input: string): { abbr: string; name: string } | null {
  const t = input.trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (US_STATES[upper]) return { abbr: upper, name: US_STATES[upper] };
  const abbr = BY_NAME.get(t.toLowerCase());
  return abbr ? { abbr, name: US_STATES[abbr] } : null;
}

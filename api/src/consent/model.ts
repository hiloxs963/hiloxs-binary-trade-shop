export const CONSENT_POLICIES = ["privacy-policy", "terms-of-use"] as const;
export type ConsentPolicy = (typeof CONSENT_POLICIES)[number];

export const PRIVACY_POLICY_VERSION = "privacy-policy-v1";
export const TERMS_OF_USE_VERSION = "terms-of-use-v1";

// Every policy a new account must accept before it is created. Re-consent is
// recorded as a new row once a version here is bumped.
export const REGISTRATION_CONSENT_POLICIES = [
  { policy: "privacy-policy", version: PRIVACY_POLICY_VERSION },
  { policy: "terms-of-use", version: TERMS_OF_USE_VERSION },
] as const;

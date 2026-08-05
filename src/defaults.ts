import type { Settings } from "./types.js";

export const defaultSettings: Settings = {
  enabled: false,
  cadence: "daily",
  timezone: "America/New_York",
  firstTime: "09:00",
  secondTime: "16:00",
  authorName: "Legends DTF Prints",
  wordCountMin: 900,
  wordCountMax: 1400,
  facts: [
    "Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.",
    "Services include custom DTF transfers, gang sheets, embroidery, UV DTF, neck labels, and finished apparel.",
    "Standard DTF turnaround is generally 1–2 business days; embroidery is generally 1–5 business days.",
    "Do not promise same-day completion, exact pricing, free shipping, or guaranteed deadlines.",
    "Business production days are Monday through Friday; do not count Saturday or Sunday as production days.",
    "Customers should use the current website product pages for live prices, sizes, options, and availability."
  ],
  contentPillars: [
    "DTF printing education",
    "gang sheet planning and artwork preparation",
    "heat press instructions and transfer care",
    "DTF versus vinyl, sublimation, or screen printing",
    "embroidery and branded apparel",
    "school, team, and spirit wear",
    "small-business branding and merchandise",
    "seasonal ordering guidance",
    "Warner Robins and Middle Georgia custom apparel",
    "product and service spotlights"
  ]
};
